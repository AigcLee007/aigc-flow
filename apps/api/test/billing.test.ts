import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { BillingService, createPgPool, withTenantTransaction } from "@aigc-flow/db";

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
    queueHealthService: {
      async close() {
        return;
      },
    } as never,
    workflowRunsService: {
      async cancelWorkflowRun() {
        throw new Error("not used");
      },
      async createWorkflowRun() {
        throw new Error("not used");
      },
      async getWorkflowRun() {
        throw new Error("not used");
      },
      async getWorkflowRunStatus() {
        throw new Error("not used");
      },
      isTerminalWorkflowRunStatus() {
        return false;
      },
      async listWorkflowRunEvents() {
        throw new Error("not used");
      },
    } as never,
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

async function seedTenantBilling(
  pool: ReturnType<typeof createPgPool>,
  input: {
    billableCents?: number;
    eventType?: string;
    modality?: string;
    rawCost?: string;
    tenantId: string;
    userId: string;
    workflowRunId?: string | null;
  },
) {
  const billingService = new BillingService({ pool });
  const usageEvent = await billingService.recordUsageEvent(
    { tenantId: input.tenantId, userId: input.userId },
    {
      billableCents: input.billableCents ?? 0,
      eventType: input.eventType ?? "ai.text.generate",
      idempotencyKey: `usage:${input.tenantId}:${randomUUID()}`,
      modality: input.modality ?? "text",
      rawCost: input.rawCost ?? "0.10000000",
      workflowRunId: input.workflowRunId ?? null,
    },
  );

  await billingService.settleUsage(
    { tenantId: input.tenantId, userId: input.userId },
    {
      amountCents: input.billableCents ?? 0,
      idempotencyKey: `settle:${usageEvent.id}`,
      usageEventId: usageEvent.id,
    },
  );

  return usageEvent;
}

describeWithDatabase("billing api", () => {
  test("billing summary requires auth", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({ connectionString: await createAppDatabaseUrl() });

        const api = buildTestApp(appPool);
        const response = await api.inject({
          method: "GET",
          url: "/api/v2/billing/summary",
        });

        expect(response.statusCode).toBe(401);
        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("viewer can read summary and tenant-scoped lists only return current tenant rows", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({ connectionString: await createAppDatabaseUrl() });

        const api = buildTestApp(appPool);
        const tenantA = await registerOwner(api, "billing-a@example.com", "Billing Tenant A");
        const tenantB = await registerOwner(api, "billing-b@example.com", "Billing Tenant B");

        await seedTenantBilling(appPool, {
          modality: "text",
          tenantId: tenantA.currentTenant.id,
          userId: tenantA.user.id,
        });
        await seedTenantBilling(appPool, {
          modality: "image",
          tenantId: tenantB.currentTenant.id,
          userId: tenantB.user.id,
        });

        const viewerUserId = randomUUID();
        const viewerPassword = "ViewerPass123!";
        const viewerPasswordHash = await hashPassword(viewerPassword);

        await withTenantTransaction(
          { tenantId: tenantA.currentTenant.id, userId: viewerUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [viewerUserId, "billing-viewer@example.com", "Billing Viewer", viewerPasswordHash],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'viewer', 'active', now(), now())
              `,
              [tenantA.currentTenant.id, viewerUserId],
            );
          },
          appPool,
        );

        const viewerLogin = await api.inject({
          method: "POST",
          payload: {
            email: "billing-viewer@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });

        expect(viewerLogin.statusCode).toBe(200);

        const summary = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/billing/summary",
        });
        expect(summary.statusCode).toBe(200);
        expect(summary.json().usageTotals.eventCount).toBe(1);

        const usageEvents = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/billing/usage-events?limit=10&page=1",
        });
        expect(usageEvents.statusCode).toBe(200);
        expect(usageEvents.json().items).toHaveLength(1);
        expect(usageEvents.json().items[0].tenantId).toBe(tenantA.currentTenant.id);
        expect(JSON.stringify(usageEvents.json())).not.toContain(tenantB.currentTenant.id);

        const ledger = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/billing/ledger?limit=10&page=1",
        });
        expect(ledger.statusCode).toBe(200);
        expect(ledger.json().items).toHaveLength(1);
        expect(JSON.stringify(ledger.json())).not.toContain(tenantB.currentTenant.id);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("user without billing:read gets 403", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({ connectionString: await createAppDatabaseUrl() });

        const api = buildTestApp(appPool);
        const owner = await registerOwner(api, "billing-owner@example.com", "Billing Owner");

        const restrictedUserId = randomUUID();
        const restrictedPassword = "RestrictedPass123!";
        const restrictedPasswordHash = await hashPassword(restrictedPassword);
        const restrictedRoleId = randomUUID();

        await withTenantTransaction(
          { tenantId: owner.currentTenant.id, userId: restrictedUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO roles (id, tenant_id, key, name)
                VALUES ($1::uuid, $2::uuid, 'no_billing_read', 'No Billing Read')
              `,
              [restrictedRoleId, owner.currentTenant.id],
            );
            await client.query(
              `
                INSERT INTO role_permissions (role_id, permission_key)
                SELECT $1::uuid, permission_key
                FROM role_permissions rp
                JOIN roles r
                  ON r.id = rp.role_id
                WHERE r.key = 'viewer'
                  AND r.tenant_id IS NULL
                  AND permission_key <> 'billing:read'
              `,
              [restrictedRoleId],
            );
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [
                restrictedUserId,
                "billing-restricted@example.com",
                "Billing Restricted",
                restrictedPasswordHash,
              ],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'no_billing_read', 'active', now(), now())
              `,
              [owner.currentTenant.id, restrictedUserId],
            );
          },
          appPool,
        );

        const login = await api.inject({
          method: "POST",
          payload: {
            email: "billing-restricted@example.com",
            password: restrictedPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(login.statusCode).toBe(200);

        const summary = await api.inject({
          headers: {
            authorization: `Bearer ${login.json().accessToken}`,
          },
          method: "GET",
          url: "/api/v2/billing/summary",
        });

        expect(summary.statusCode).toBe(403);
        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
