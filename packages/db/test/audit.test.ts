import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import {
  createPgPool,
  listAuditLogs,
  recordAuditLog,
  withTenantTransaction,
} from "../src/index.js";
import { runMigrations } from "../src/migrator.js";
import {
  hasDatabaseEnv,
  withAppContextTransaction,
  withDatabase,
} from "./helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describeWithDatabase("audit logs", () => {
  test("migration creates audit_logs and records the new schema migration", async () => {
    await withDatabase(async ({ databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();

      try {
        const result = await runMigrations(pool);
        expect(result.appliedMigrations).toContain("000009_audit_observability.sql");

        const tableCheck = await pool.query<{ exists: boolean }>(
          `
            SELECT EXISTS (
              SELECT 1
              FROM information_schema.tables
              WHERE table_schema = 'public'
                AND table_name = 'audit_logs'
            ) AS exists
          `,
        );

        expect(tableCheck.rows[0]?.exists).toBe(true);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant A cannot read tenant B audit logs and no tenant context sees none", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const tenantAId = randomUUID();
        const tenantBId = randomUUID();
        const userAId = randomUUID();
        const userBId = randomUUID();

        for (const [tenantId, userId, slug] of [
          [tenantAId, userAId, "audit-tenant-a"],
          [tenantBId, userBId, "audit-tenant-b"],
        ] as const) {
          await withTenantTransaction({ tenantId, userId }, async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name)
                VALUES ($1::uuid, $2, $3)
              `,
              [userId, `${slug}@example.com`, slug],
            );
            await client.query(
              `
                INSERT INTO tenants (id, name, slug, updated_at)
                VALUES ($1::uuid, $2, $3, now())
              `,
              [tenantId, slug, slug],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
              `,
              [tenantId, userId],
            );
          }, appPool);
        }

        await recordAuditLog(
          {
            action: "workflow.run.create",
            actorUserId: userAId,
            metadata: {
              accessToken: "should-redact",
              routeKey: "default-text",
            },
            requestId: "req-a",
            resourceId: "run-a",
            resourceType: "workflow_run",
            tenantId: tenantAId,
            traceId: "trace-a",
          },
          appPool,
        );
        await recordAuditLog(
          {
            action: "asset.delete",
            actorUserId: userBId,
            metadata: {
              secret: "should-redact-too",
            },
            requestId: "req-b",
            resourceId: "asset-b",
            resourceType: "asset",
            tenantId: tenantBId,
            traceId: "trace-b",
          },
          appPool,
        );

        const tenantAList = await listAuditLogs(
          { tenantId: tenantAId, userId: userAId },
          {},
          appPool,
        );
        expect(tenantAList.items).toHaveLength(1);
        expect(tenantAList.items[0]).toMatchObject({
          action: "workflow.run.create",
          requestId: "req-a",
          resourceId: "run-a",
          tenantId: tenantAId,
          traceId: "trace-a",
        });
        expect(tenantAList.items[0]?.metadata).toEqual({
          accessToken: "[REDACTED]",
          routeKey: "default-text",
        });

        const tenantBReadFromTenantA = await withTenantTransaction(
          { tenantId: tenantAId, userId: userAId },
          async (client) => {
            const result = await client.query<{ total: number }>(
              `
                SELECT COUNT(*)::int AS total
                FROM audit_logs
                WHERE tenant_id = $1::uuid
              `,
              [tenantBId],
            );
            return result.rows[0]?.total ?? 0;
          },
          appPool,
        );
        expect(tenantBReadFromTenantA).toBe(0);

        const noTenantRead = await withAppContextTransaction(
          appPool,
          {
            tenantId: null,
            userId: userAId,
          },
          async (client) => {
            const result = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM audit_logs",
            );
            return result.rows[0]?.total ?? 0;
          },
        );
        expect(noTenantRead).toBe(0);
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("audit logs stay append-only for normal tenant roles", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const tenantId = randomUUID();
        const userId = randomUUID();

        await withTenantTransaction({ tenantId, userId }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userId, "append-only@example.com", "Append Only"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, $2, $3, now())
            `,
            [tenantId, "Append Only Tenant", "append-only-tenant"],
          );
          await client.query(
            `
              INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
              VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
            `,
            [tenantId, userId],
          );
        }, appPool);

        const created = await recordAuditLog(
          {
            action: "auth.login",
            actorUserId: userId,
            resourceId: userId,
            resourceType: "user",
            tenantId,
          },
          appPool,
        );

        await withTenantTransaction({ tenantId, userId }, async (client) => {
          await client.query(
            `
              UPDATE audit_logs
              SET action = 'tampered'
              WHERE id = $1::uuid
            `,
            [created.id],
          );
          await client.query(
            "DELETE FROM audit_logs WHERE id = $1::uuid",
            [created.id],
          );
        }, appPool);

        const stillPresent = await withTenantTransaction(
          { tenantId, userId },
          async (client) => {
            const result = await client.query<{
              action: string;
              total: number;
            }>(
              `
                SELECT action, COUNT(*) OVER ()::int AS total
                FROM audit_logs
                WHERE id = $1::uuid
              `,
              [created.id],
            );
            return result.rows[0];
          },
          appPool,
        );

        expect(stillPresent?.action).toBe("auth.login");
        expect(stillPresent?.total).toBe(1);
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
