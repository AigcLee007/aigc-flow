import { afterAll, describe, expect, test } from "vitest";

import { createPgPool } from "@aigc-flow/db";

import type { ApiEnv } from "../src/config/env.js";
import { buildApp } from "../src/app.js";
import type { QueueHealthService } from "../src/modules/queues/queues.service.js";
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

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

function createFakeQueueHealthService(): QueueHealthService {
  return {
    async close() {
      return;
    },
    async getHealth() {
      return {
        queues: [
          {
            counts: {
              active: 0,
              completed: 0,
              delayed: 0,
              failed: 0,
              paused: 0,
              waiting: 1,
            },
            name: "workflow.start",
          },
          {
            counts: {
              active: 1,
              completed: 2,
              delayed: 0,
              failed: 0,
              paused: 0,
              waiting: 0,
            },
            name: "node.execute",
          },
        ],
        redis: {
          status: "ok" as const,
        },
      };
    },
  } as QueueHealthService;
}

describeWithDatabase("queue health api", () => {
  test("queue health endpoint requires auth", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const app = buildApp({
          env: testEnv,
          logger: false,
          pool: appPool,
          queueHealthService: createFakeQueueHealthService(),
        });

        const response = await app.inject({
          method: "GET",
          url: "/api/v2/admin/queues/health",
        });

        expect(response.statusCode).toBe(401);
        await app.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("user without admin:system gets 403", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const app = buildApp({
          env: testEnv,
          logger: false,
          pool: appPool,
          queueHealthService: createFakeQueueHealthService(),
        });

        const register = await app.inject({
          method: "POST",
          payload: {
            email: "owner-queue@example.com",
            password: "StrongPass123!",
            tenantName: "Queue Tenant",
          },
          url: "/api/v2/auth/register",
        });
        const registerBody = register.json();

        const response = await app.inject({
          headers: {
            authorization: `Bearer ${registerBody.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/queues/health",
        });

        expect(response.statusCode).toBe(403);
        await app.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("system admin gets queue counts without exposing REDIS_URL", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const app = buildApp({
          env: testEnv,
          logger: false,
          pool: appPool,
          queueHealthService: createFakeQueueHealthService(),
        });

        const register = await app.inject({
          method: "POST",
          payload: {
            email: "admin-queue@example.com",
            password: "StrongPass123!",
            tenantName: "Admin Queue Tenant",
          },
          url: "/api/v2/auth/register",
        });
        const registerBody = register.json();

        await adminPool.query(
          `
            UPDATE tenant_memberships
            SET role_key = 'system_admin', updated_at = now()
            WHERE tenant_id = $1::uuid
              AND user_id = $2::uuid
          `,
          [registerBody.currentTenant.id, registerBody.user.id],
        );

        const login = await app.inject({
          method: "POST",
          payload: {
            email: "admin-queue@example.com",
            password: "StrongPass123!",
            tenantId: registerBody.currentTenant.id,
          },
          url: "/api/v2/auth/login",
        });
        expect(login.statusCode).toBe(200);
        const loginBody = login.json();
        expect(loginBody.permissions).toContain("admin:system");

        const response = await app.inject({
          headers: {
            authorization: `Bearer ${loginBody.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/admin/queues/health",
        });

        expect(response.statusCode).toBe(200);
        const body = response.json();
        expect(body.redis).toEqual({ status: "ok" });
        expect(body.queues).toHaveLength(2);
        expect(body.queues[0]).toMatchObject({
          counts: {
            waiting: 1,
          },
          name: "workflow.start",
        });
        expect(body.redisUrl).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain("redis://");

        await app.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
