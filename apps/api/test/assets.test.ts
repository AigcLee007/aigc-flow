import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type { StorageProvider } from "@aigc-flow/storage";

import type { ApiEnv } from "../src/config/env.js";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { runMigrations } from "../../../packages/db/src/migrator.js";
import { hasDatabaseEnv, withDatabase } from "../../../packages/db/test/helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

const testEnv: ApiEnv = {
  accessTokenTtlSeconds: 60 * 15,
  credentialKeyVersion: "v1",
  credentialMasterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  jwtAccessSecret: "test_access_secret_1234567890",
  jwtRefreshSecret: "test_refresh_secret_1234567890",
  nodeEnv: "test",
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  s3AccessKeyId: "test-access",
  s3Bucket: "test-bucket",
  s3Endpoint: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Region: "us-east-1",
  s3SecretAccessKey: "test-secret",
};

class MemoryStorageProvider implements StorageProvider {
  readonly deletedKeys: string[] = [];
  readonly headRequests: Array<{ bucket: string; key: string }> = [];
  readonly objects = new Map<string, {
    contentLength: number | null;
    contentType: string | null;
    metadata: Record<string, string>;
  }>();

  async putObject(): Promise<void> {}

  async headObject(input: { bucket: string; key: string }) {
    this.headRequests.push(input);
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (!object) {
      throw new Error("Object not found");
    }

    return {
      contentLength: object.contentLength,
      contentType: object.contentType,
      eTag: "etag-test",
      lastModified: new Date().toISOString(),
      metadata: object.metadata,
    };
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    this.deletedKeys.push(`${input.bucket}/${input.key}`);
  }

  async createPresignedPutUrl(input: {
    bucket: string;
    contentLength?: number | null;
    contentType?: string | null;
    expiresInSeconds: number;
    key: string;
    metadata?: Record<string, string>;
  }) {
    this.objects.set(`${input.bucket}/${input.key}`, {
      contentLength: input.contentLength ?? null,
      contentType: input.contentType ?? null,
      metadata: input.metadata ?? {},
    });

    return {
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: input.contentType ? { "content-type": input.contentType } : {},
      method: "PUT" as const,
      url: `memory://put/${input.bucket}/${input.key}`,
    };
  }

  async createPresignedGetUrl(input: {
    bucket: string;
    expiresInSeconds: number;
    key: string;
    responseContentDisposition?: string | null;
    responseContentType?: string | null;
  }) {
    return {
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: {},
      method: "GET" as const,
      url: `memory://get/${input.bucket}/${input.key}?contentType=${encodeURIComponent(input.responseContentType ?? "")}&disposition=${encodeURIComponent(input.responseContentDisposition ?? "")}`,
    };
  }
}

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

function buildTestApp(
  pool: ReturnType<typeof createPgPool>,
  storageProvider: StorageProvider,
) {
  return buildApp({
    env: testEnv,
    logger: false,
    pool,
    storageProvider,
  });
}

async function registerOwner(
  api: ReturnType<typeof buildTestApp>,
  email: string,
  tenantName: string,
) {
  const response = await api.inject({
    method: "POST",
    payload: {
      email,
      password: "StrongPass123!",
      tenantName,
    },
    url: "/api/v2/auth/register",
  });

  expect(response.statusCode).toBe(201);
  return response.json();
}

describeWithDatabase("assets v2", () => {
  test("asset:create can create a presigned upload and a viewer cannot", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const storageProvider = new MemoryStorageProvider();
        const api = buildTestApp(appPool, storageProvider);

        const owner = await registerOwner(api, "owner-assets@example.com", "Owner Assets");

        const createUpload = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            kind: "image",
            mimeType: "image/png",
            originalFilename: "sample image.png",
            sizeBytes: 128,
          },
          url: "/api/v2/assets/presigned-upload",
        });

        expect(createUpload.statusCode).toBe(201);
        expect(createUpload.json()).toMatchObject({
          asset: {
            bucket: "test-bucket",
            kind: "image",
            mimeType: "image/png",
            originalFilename: "sample image.png",
            status: "uploading",
            tenantId: owner.currentTenant.id,
          },
          upload: {
            method: "PUT",
          },
        });

        const viewerUserId = randomUUID();
        const viewerPassword = "ViewerPass123!";
        const viewerPasswordHash = await hashPassword(viewerPassword);

        await withTenantTransaction(
          { tenantId: owner.currentTenant.id, userId: viewerUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [viewerUserId, "viewer-assets@example.com", "Viewer Assets", viewerPasswordHash],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'viewer', 'active', now(), now())
              `,
              [owner.currentTenant.id, viewerUserId],
            );
          },
          appPool,
        );

        const viewerLogin = await api.inject({
          method: "POST",
          payload: {
            email: "viewer-assets@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(viewerLogin.statusCode).toBe(200);

        const forbiddenCreate = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "POST",
          payload: {
            kind: "image",
            mimeType: "image/png",
            originalFilename: "forbidden.png",
          },
          url: "/api/v2/assets/presigned-upload",
        });
        expect(forbiddenCreate.statusCode).toBe(403);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("complete-upload HEADs the object, metadata is readable, download url is scoped, and deleted assets cannot be downloaded", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const storageProvider = new MemoryStorageProvider();
        const api = buildTestApp(appPool, storageProvider);

        const tenantAOwner = await registerOwner(api, "tenant-a-assets@example.com", "Tenant A Assets");
        const tenantBOwner = await registerOwner(api, "tenant-b-assets@example.com", "Tenant B Assets");

        const created = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            kind: "image",
            metadata: {
              source: "manual-upload",
            },
            mimeType: "image/png",
            originalFilename: "hero.png",
            sizeBytes: 512,
          },
          url: "/api/v2/assets/presigned-upload",
        });
        expect(created.statusCode).toBe(201);
        const createdBody = created.json();

        const complete = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            width: 1024,
          },
          url: `/api/v2/assets/${createdBody.asset.id}/complete-upload`,
        });
        expect(complete.statusCode).toBe(200);
        expect(storageProvider.headRequests).toHaveLength(1);
        expect(complete.json()).toMatchObject({
          id: createdBody.asset.id,
          mimeType: "image/png",
          sizeBytes: 512,
          status: "available",
          width: 1024,
        });

        const getAsset = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/assets/${createdBody.asset.id}`,
        });
        expect(getAsset.statusCode).toBe(200);
        expect(getAsset.json()).toMatchObject({
          id: createdBody.asset.id,
          metadata: {
            source: "manual-upload",
          },
          status: "available",
        });
        expect(getAsset.json()).not.toHaveProperty("publicUrl");

        const download = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/assets/${createdBody.asset.id}/download-url`,
        });
        expect(download.statusCode).toBe(200);
        expect(download.json()).toMatchObject({
          method: "GET",
        });
        expect(download.json().url).toContain(`memory://get/test-bucket/${createdBody.asset.objectKey}`);

        const crossTenantGet = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/assets/${createdBody.asset.id}`,
        });
        expect(crossTenantGet.statusCode).toBe(404);

        const crossTenantDownload = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/assets/${createdBody.asset.id}/download-url`,
        });
        expect(crossTenantDownload.statusCode).toBe(404);

        const deleted = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "DELETE",
          url: `/api/v2/assets/${createdBody.asset.id}`,
        });
        expect(deleted.statusCode).toBe(200);

        const deletedDownload = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/assets/${createdBody.asset.id}/download-url`,
        });
        expect(deletedDownload.statusCode).toBe(404);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
