import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type { StorageProvider } from "@aigc-flow/storage";

import type { ApiEnv } from "../src/config/env.js";
import { buildApp } from "../src/app.js";
import { WorkflowRunsService } from "../src/modules/workflow-runs/workflow-runs.service.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { runMigrations } from "../../../packages/db/src/migrator.js";
import {
  hasDatabaseEnv,
  withDatabase,
} from "../../../packages/db/test/helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

const testEnv: ApiEnv = {
  accessTokenTtlSeconds: 60 * 15,
  credentialKeyVersion: "v1",
  credentialMasterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  jwtAccessSecret: "test_access_secret_1234567890",
  jwtRefreshSecret: "test_refresh_secret_1234567890",
  nodeEnv: "test",
  queuePrefix: "test-prefix",
  redisUrl: "redis://localhost:6379",
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
      contentLength: 128,
      contentType: "image/png",
      eTag: "etag-test",
      lastModified: new Date().toISOString(),
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

function createFakeNodeExecuteQueue() {
  const jobs: Array<{ data: unknown; name: string }> = [];
  return {
    jobs,
    queue: {
      async add(name: string, data: unknown) {
        jobs.push({ data, name });
        return { id: `job-${jobs.length}` };
      },
      async close() {
        return;
      },
    },
  };
}

function createQueueHealthService() {
  return {
    async close() {
      return;
    },
    async getHealth() {
      return {
        queues: [
          {
            counts: {
              active: 1,
              completed: 2,
              delayed: 0,
              failed: 0,
              paused: 0,
              waiting: 3,
            },
            name: "node.execute",
          },
        ],
        redis: {
          status: "ok" as const,
        },
      };
    },
  };
}

function buildTestApp(pool: ReturnType<typeof createPgPool>) {
  const fakeQueue = createFakeNodeExecuteQueue();
  return {
    api: buildApp({
      env: testEnv,
      logger: false,
      pool,
      queueHealthService: createQueueHealthService() as never,
      storageProvider: new MemoryStorageProvider(),
      workflowRunsService: new WorkflowRunsService({
        nodeExecuteQueue: fakeQueue.queue,
        pool,
      }),
    }),
    fakeQueue,
  };
}

async function registerUser(
  api: ReturnType<typeof buildTestApp>["api"],
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
  expect(response.headers["x-request-id"]).toBeTruthy();
  expect(response.headers["x-trace-id"]).toBeTruthy();
  return response.json();
}

async function createPublishedFlow(
  api: ReturnType<typeof buildTestApp>["api"],
  accessToken: string,
) {
  const project = await api.inject({
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "POST",
    payload: {
      name: "Audit Workflow Project",
    },
    url: "/api/v2/projects",
  });
  expect(project.statusCode).toBe(201);

  const flow = await api.inject({
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "POST",
    payload: {
      title: "Audit Workflow Flow",
    },
    url: `/api/v2/projects/${project.json().id}/flows`,
  });
  expect(flow.statusCode).toBe(201);

  const publish = await api.inject({
    headers: {
      authorization: `Bearer ${accessToken}`,
    },
    method: "POST",
    payload: {
      graph: {
        edges: [
          { source: "input", target: "text" },
          { source: "text", target: "output" },
        ],
        nodes: [
          { id: "input", type: "input", data: { inputKey: "prompt" } },
          { id: "text", type: "text.generate", data: { routeKey: "default-text" } },
          { id: "output", type: "output" },
        ],
      },
    },
    url: `/api/v2/flows/${flow.json().id}/publish`,
  });
  expect(publish.statusCode).toBe(201);

  return flow.json();
}

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describeWithDatabase("audit and observability", () => {
  test("audit logs require auth, reject users without audit:read, and stay tenant-scoped", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const { api } = buildTestApp(appPool);
        const tenantAOwner = await registerUser(api, "audit-a@example.com", "Audit A");
        const tenantBOwner = await registerUser(api, "audit-b@example.com", "Audit B");

        const noAuth = await api.inject({
          method: "GET",
          url: "/api/v2/audit/logs",
        });
        expect(noAuth.statusCode).toBe(401);

        const provider = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            key: "audit-openai-compatible",
            kind: "openai-compatible",
            name: "Audit Provider",
          },
          url: "/api/v2/admin/ai/providers",
        });
        expect(provider.statusCode).toBe(201);

        const model = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            displayName: "Audit Model",
            modality: "text",
            modelKey: "audit-model",
            providerId: provider.json().id,
          },
          url: "/api/v2/admin/ai/models",
        });
        expect(model.statusCode).toBe(201);

        const createdCredential = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Audit Credential",
            providerId: provider.json().id,
            secret: "sk-audit-secret-1234",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(createdCredential.statusCode).toBe(201);

        const rotatedCredential = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            secret: "sk-audit-rotated-5678",
          },
          url: `/api/v2/admin/credentials/${createdCredential.json().id}/rotate`,
        });
        expect(rotatedCredential.statusCode).toBe(200);

        const route = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            credentialId: createdCredential.json().id,
            modality: "text",
            modelId: model.json().id,
            providerId: provider.json().id,
            routeKey: "audit-route",
          },
          url: "/api/v2/admin/ai/routes",
        });
        expect(route.statusCode).toBe(201);

        const flow = await createPublishedFlow(api, tenantAOwner.accessToken);
        const workflowRun = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            input: {
              prompt: "audit workflow run",
            },
          },
          url: `/api/v2/flows/${flow.id}/runs`,
        });
        expect(workflowRun.statusCode).toBe(201);

        const presignedUpload = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            kind: "image",
            mimeType: "image/png",
            originalFilename: "audit.png",
            sizeBytes: 128,
          },
          url: "/api/v2/assets/presigned-upload",
        });
        expect(presignedUpload.statusCode).toBe(201);
        const assetId = presignedUpload.json().asset.id;

        const completedUpload = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "POST",
          payload: {},
          url: `/api/v2/assets/${assetId}/complete-upload`,
        });
        expect(completedUpload.statusCode).toBe(200);

        const deletedAsset = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "DELETE",
          url: `/api/v2/assets/${assetId}`,
        });
        expect(deletedAsset.statusCode).toBe(200);

        const tenantBCredential = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Tenant B Credential",
            providerId: provider.json().id,
            secret: "sk-tenant-b-secret",
          },
          url: "/api/v2/admin/credentials",
        });
        expect(tenantBCredential.statusCode).toBe(201);

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
              [viewerUserId, "audit-viewer@example.com", "Audit Viewer", viewerPasswordHash],
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
            email: "audit-viewer@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(viewerLogin.statusCode).toBe(200);

        const viewerList = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/audit/logs",
        });
        expect(viewerList.statusCode).toBe(403);

        const ownerList = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/audit/logs?limit=50&page=1",
        });
        expect(ownerList.statusCode).toBe(200);
        const ownerListBody = ownerList.json();
        expect(ownerListBody.page).toBe(1);
        expect(ownerListBody.pageSize).toBe(50);
        expect(ownerListBody.items.some((item: { action: string }) => item.action === "credential.create")).toBe(true);
        expect(ownerListBody.items.some((item: { action: string }) => item.action === "credential.rotate")).toBe(true);
        expect(ownerListBody.items.some((item: { action: string }) => item.action === "workflow.run.create")).toBe(true);
        expect(ownerListBody.items.some((item: { action: string }) => item.action === "asset.complete_upload")).toBe(true);
        expect(ownerListBody.items.some((item: { action: string }) => item.action === "asset.delete")).toBe(true);
        expect(JSON.stringify(ownerListBody)).not.toContain("sk-audit-secret-1234");
        expect(JSON.stringify(ownerListBody)).not.toContain("sk-audit-rotated-5678");
        expect(JSON.stringify(ownerListBody)).not.toContain("password_hash");
        expect(JSON.stringify(ownerListBody)).not.toContain("token_hash");

        const credentialAudit = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/audit/logs?action=credential.rotate&resourceType=credential",
        });
        expect(credentialAudit.statusCode).toBe(200);
        expect(credentialAudit.json().items).toHaveLength(1);
        expect(credentialAudit.json().items[0].metadata.maskedSecret).toMatch(/\*{4}/);

        const tenantASeesTenantB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/audit/logs?action=credential.create",
        });
        const serialized = JSON.stringify(tenantASeesTenantB.json());
        expect(serialized).not.toContain("Tenant B Credential");

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("admin health and metrics require admin:system and do not expose secrets", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const { api } = buildTestApp(appPool);
        const owner = await registerUser(api, "obs-owner@example.com", "Observability Tenant");

        const ownerHealth = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/health",
        });
        expect(ownerHealth.statusCode).toBe(403);

        const ownerMetrics = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/metrics",
        });
        expect(ownerMetrics.statusCode).toBe(403);

        await withTenantTransaction(
          {
            tenantId: owner.currentTenant.id,
            userId: owner.user.id,
          },
          async (client) => {
            await client.query(
              `
                UPDATE tenant_memberships
                SET role_key = 'system_admin', updated_at = now()
                WHERE tenant_id = $1::uuid
                  AND user_id = $2::uuid
              `,
              [owner.currentTenant.id, owner.user.id],
            );
          },
          appPool,
        );

        const adminLogin = await api.inject({
          method: "POST",
          payload: {
            email: owner.user.email,
            password: "StrongPass123!",
          },
          url: "/api/v2/auth/login",
        });
        expect(adminLogin.statusCode).toBe(200);

        const adminHealth = await api.inject({
          headers: {
            authorization: `Bearer ${adminLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/health",
        });
        expect(adminHealth.statusCode).toBe(200);
        expect(adminHealth.json()).toMatchObject({
          database: {
            status: "ok",
          },
          redis: {
            status: "ok",
          },
          status: "ok",
        });

        const adminMetrics = await api.inject({
          headers: {
            authorization: `Bearer ${adminLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/metrics",
        });
        expect(adminMetrics.statusCode).toBe(200);
        expect(adminMetrics.json()).toMatchObject({
          process: {
            pid: expect.any(Number),
            uptimeSeconds: expect.any(Number),
          },
          queueCounts: [
            {
              counts: {
                active: 1,
                waiting: 3,
              },
              name: "node.execute",
            },
          ],
          workflowRuns: {
            failed: expect.any(Number),
            total: expect.any(Number),
          },
        });

        const combined = JSON.stringify({
          health: adminHealth.json(),
          metrics: adminMetrics.json(),
        });
        expect(combined).not.toContain("redis://");
        expect(combined).not.toContain("test-secret");
        expect(combined).not.toContain("authorization");

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
