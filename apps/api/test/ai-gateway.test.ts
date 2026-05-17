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
  async putObject(): Promise<void> {}
  async headObject() {
    return {
      contentLength: null,
      contentType: null,
      eTag: null,
      lastModified: null,
      metadata: {},
    };
  }
  async deleteObject(): Promise<void> {}
  async createPresignedPutUrl() {
    return {
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      headers: {},
      method: "PUT" as const,
      url: "memory://put",
    };
  }
  async createPresignedGetUrl() {
    return {
      expiresAt: new Date(Date.now() + 900000).toISOString(),
      headers: {},
      method: "GET" as const,
      url: "memory://get",
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

function buildTestApp(pool: ReturnType<typeof createPgPool>) {
  return buildApp({
    env: testEnv,
    logger: false,
    pool,
    storageProvider: new MemoryStorageProvider(),
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

describeWithDatabase("ai gateway admin API", () => {
  test("credential create stores only encrypted data and GET returns maskedSecret", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);
        const owner = await registerOwner(api, "gateway-owner@example.com", "Gateway Owner");

        const provider = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            key: "openai-compatible",
            kind: "openai-compatible",
            name: "OpenAI Compatible",
          },
          url: "/api/v2/admin/ai/providers",
        });
        expect(provider.statusCode).toBe(201);
        const providerBody = provider.json();

        const createdCredential = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Primary Key",
            providerId: providerBody.id,
            secret: "sk-primary-secret-abcd",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(createdCredential.statusCode).toBe(201);
        expect(createdCredential.json()).toMatchObject({
          name: "Primary Key",
          providerId: providerBody.id,
          status: "active",
        });
        expect(createdCredential.json().maskedSecret).toMatch(/^.{1,3}\*{4}.+$/);
        expect(createdCredential.json()).not.toHaveProperty("secret");
        expect(createdCredential.json()).not.toHaveProperty("encrypted_secret");
        expect(createdCredential.json()).not.toHaveProperty("nonce");
        expect(createdCredential.json()).not.toHaveProperty("auth_tag");

        const dbCredential = await adminPool.query<{
          auth_tag_hex: string;
          encrypted_secret_b64: string;
          nonce_hex: string;
          rotated_at: string | null;
        }>(
          `
            SELECT
              encode(encrypted_secret, 'base64') AS encrypted_secret_b64,
              encode(nonce, 'hex') AS nonce_hex,
              encode(auth_tag, 'hex') AS auth_tag_hex,
              rotated_at::text AS rotated_at
            FROM api_credentials
            WHERE id = $1::uuid
          `,
          [createdCredential.json().id],
        );
        expect(dbCredential.rows[0]?.encrypted_secret_b64).toBeTruthy();
        expect(dbCredential.rows[0]?.encrypted_secret_b64).not.toContain("sk-primary-secret-abcd");
        expect(dbCredential.rows[0]?.nonce_hex).toBeTruthy();
        expect(dbCredential.rows[0]?.auth_tag_hex).toBeTruthy();
        expect(dbCredential.rows[0]?.rotated_at).toBeNull();

        const listedCredentials = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/credentials",
        });
        expect(listedCredentials.statusCode).toBe(200);
        expect(listedCredentials.json()).toMatchObject([
          {
            id: createdCredential.json().id,
            maskedSecret: expect.any(String),
            name: "Primary Key",
          },
        ]);
        expect(listedCredentials.json()[0]).not.toHaveProperty("encrypted_secret");
        expect(listedCredentials.json()[0]).not.toHaveProperty("nonce");
        expect(listedCredentials.json()[0]).not.toHaveProperty("auth_tag");

        const beforeRotate = await adminPool.query<{
          encrypted_secret_b64: string;
        }>(
          `
            SELECT encode(encrypted_secret, 'base64') AS encrypted_secret_b64
            FROM api_credentials
            WHERE id = $1::uuid
          `,
          [createdCredential.json().id],
        );

        const rotatedCredential = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            secret: "sk-rotated-secret-wxyz",
          },
          url: `/api/v2/admin/credentials/${createdCredential.json().id}/rotate`,
        });
        expect(rotatedCredential.statusCode).toBe(200);
        expect(rotatedCredential.json().maskedSecret).not.toBe(createdCredential.json().maskedSecret);

        const afterRotate = await adminPool.query<{
          encrypted_secret_b64: string;
          rotated_at: string | null;
        }>(
          `
            SELECT
              encode(encrypted_secret, 'base64') AS encrypted_secret_b64,
              rotated_at::text AS rotated_at
            FROM api_credentials
            WHERE id = $1::uuid
          `,
          [createdCredential.json().id],
        );
        expect(afterRotate.rows[0]?.encrypted_secret_b64).not.toBe(
          beforeRotate.rows[0]?.encrypted_secret_b64,
        );
        expect(afterRotate.rows[0]?.rotated_at).toBeTruthy();

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("provider/model/route management honors permissions and tenant isolation", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);
        const tenantAOwner = await registerOwner(api, "tenant-a-gateway@example.com", "Tenant A Gateway");
        const tenantBOwner = await registerOwner(api, "tenant-b-gateway@example.com", "Tenant B Gateway");

        const provider = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            key: "provider-a",
            kind: "openai-compatible",
            name: "Provider A",
          },
          url: "/api/v2/admin/ai/providers",
        });
        expect(provider.statusCode).toBe(201);
        const providerBody = provider.json();

        const model = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            displayName: "Model A",
            modality: "text",
            modelKey: "model-a",
            providerId: providerBody.id,
          },
          url: "/api/v2/admin/ai/models",
        });
        expect(model.statusCode).toBe(201);
        const modelBody = model.json();

        const credentialA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Tenant A Credential",
            providerId: providerBody.id,
            secret: "sk-tenant-a-credential",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(credentialA.statusCode).toBe(201);
        const credentialABody = credentialA.json();

        const systemRoute = await adminPool.query<{ id: string }>(
          `
            INSERT INTO ai_routes (
              tenant_id,
              provider_id,
              model_id,
              route_key,
              modality
            )
            VALUES (
              NULL,
              $1::uuid,
              $2::uuid,
              'system-default',
              'text'
            )
            RETURNING id::text AS id
          `,
          [providerBody.id, modelBody.id],
        );
        expect(systemRoute.rows[0]?.id).toBeTruthy();

        const routeA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            credentialId: credentialABody.id,
            modality: "text",
            modelId: modelBody.id,
            providerId: providerBody.id,
            routeKey: "tenant-a-route",
          },
          url: "/api/v2/admin/ai/routes",
        });
        expect(routeA.statusCode).toBe(201);
        const routeABody = routeA.json();

        const credentialB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Tenant B Credential",
            providerId: providerBody.id,
            secret: "sk-tenant-b-credential",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(credentialB.statusCode).toBe(201);
        const credentialBBody = credentialB.json();

        const routeB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            credentialId: credentialBBody.id,
            modality: "text",
            modelId: modelBody.id,
            providerId: providerBody.id,
            routeKey: "tenant-b-route",
          },
          url: "/api/v2/admin/ai/routes",
        });
        expect(routeB.statusCode).toBe(201);

        const listCredentialsA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/credentials",
        });
        expect(listCredentialsA.statusCode).toBe(200);
        expect(listCredentialsA.json().map((item: { name: string }) => item.name)).toEqual([
          "Tenant A Credential",
        ]);

        const listRoutesA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/ai/routes",
        });
        expect(listRoutesA.statusCode).toBe(200);
        expect(listRoutesA.json().map((item: { routeKey: string }) => item.routeKey)).toEqual([
          "system-default",
          "tenant-a-route",
        ]);

        const crossTenantCredentialUpdate = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "PATCH",
          payload: {
            name: "No Access",
          },
          url: `/api/v2/admin/credentials/${credentialBBody.id}`,
        });
        expect(crossTenantCredentialUpdate.statusCode).toBe(404);

        const crossTenantRouteUpdate = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "PATCH",
          payload: {
            priority: 50,
          },
          url: `/api/v2/admin/ai/routes/${routeB.json().id}`,
        });
        expect(crossTenantRouteUpdate.statusCode).toBe(404);

        const systemRouteUpdate = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "PATCH",
          payload: {
            priority: 50,
          },
          url: `/api/v2/admin/ai/routes/${systemRoute.rows[0]?.id}`,
        });
        expect(systemRouteUpdate.statusCode).toBe(404);

        const viewerUserId = randomUUID();
        const viewerPassword = "ViewerPass123!";
        const viewerPasswordHash = await hashPassword(viewerPassword);

        await withTenantTransaction(
          { tenantId: tenantAOwner.currentTenant.id, userId: viewerUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [viewerUserId, "viewer-ai@example.com", "Viewer AI", viewerPasswordHash],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'viewer', 'active', now(), now())
              `,
              [tenantAOwner.currentTenant.id, viewerUserId],
            );
          },
          appPool,
        );

        const viewerLogin = await api.inject({
          method: "POST",
          payload: {
            email: "viewer-ai@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(viewerLogin.statusCode).toBe(200);

        const forbiddenCredentialManage = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Forbidden Credential",
            providerId: providerBody.id,
            secret: "sk-forbidden",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(forbiddenCredentialManage.statusCode).toBe(403);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
