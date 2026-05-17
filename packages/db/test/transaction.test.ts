import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool } from "../src/db.js";
import { runMigrations } from "../src/migrator.js";
import { withTenantTransaction } from "../src/transaction.js";
import { hasDatabaseEnv, insertUser, withDatabase } from "./helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describeWithDatabase("withTenantTransaction", () => {
  test("sets app.tenant_id and app.user_id and commits on success", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(pool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const tenantId = randomUUID();
        const userId = await insertUser(pool, {
          email: "tx-success@example.com",
          id: randomUUID(),
        });

        const settings = await withTenantTransaction(
          { tenantId, userId },
          async (client) => {
            const current = await client.query<{
              tenant_id: string | null;
              user_id: string | null;
            }>(
              `
                SELECT
                  app.current_tenant_id()::text AS tenant_id,
                  app.current_user_id()::text AS user_id
              `,
            );

            await client.query(
              `
                INSERT INTO tenants (id, name, slug)
                VALUES ($1, $2, $3)
              `,
              [tenantId, "Committed Tenant", "committed-tenant"],
            );

            return current.rows[0];
          },
          appPool,
        );

        expect(settings).toEqual({
          tenant_id: tenantId,
          user_id: userId,
        });

        const committed = await withTenantTransaction(
          { tenantId, userId },
          async (client) => {
            const result = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM tenants WHERE id = $1::uuid",
              [tenantId],
            );
            return result.rows[0].total;
          },
          appPool,
        );

        expect(committed).toBe(1);
      } finally {
        await appPool.end();
        await pool.end();
      }
    });
  });

  test("rolls back on error", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(pool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const tenantId = randomUUID();

        await expect(
          withTenantTransaction(
            { tenantId, userId: null },
            async (client) => {
              await client.query(
                `
                  INSERT INTO tenants (id, name, slug)
                  VALUES ($1, $2, $3)
                `,
                [tenantId, "Rolled Back Tenant", "rolled-back-tenant"],
              );
              throw new Error("rollback-me");
            },
            appPool,
          ),
        ).rejects.toThrow("rollback-me");

        const visible = await withTenantTransaction(
          { tenantId, userId: null },
          async (client) => {
            const result = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM tenants WHERE id = $1::uuid",
              [tenantId],
            );
            return result.rows[0].total;
          },
          appPool,
        );

        expect(visible).toBe(0);
      } finally {
        await appPool.end();
        await pool.end();
      }
    });
  });
});
