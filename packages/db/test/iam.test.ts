import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool } from "../src/db.js";
import { runMigrations } from "../src/migrator.js";
import { withTenantTransaction } from "../src/transaction.js";
import {
  hasDatabaseEnv,
  insertUser,
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

describeWithDatabase("000002_iam.sql and 000003_auth.sql", () => {
  test("creates IAM and auth tables and seeds permissions and global roles", async () => {
    await withDatabase(async ({ databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();
      try {
        await runMigrations(pool);

        const tables = await pool.query<{ table_name: string }>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name = ANY($1::text[])
            ORDER BY table_name ASC
          `,
          [[
            "auth_sessions",
            "users",
            "tenants",
            "tenant_memberships",
            "roles",
            "permissions",
            "role_permissions",
            "refresh_tokens",
          ]],
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "auth_sessions",
          "permissions",
          "refresh_tokens",
          "role_permissions",
          "roles",
          "tenant_memberships",
          "tenants",
          "users",
        ]);

        const permissions = await pool.query<{ key: string }>(
          "SELECT key FROM permissions ORDER BY key ASC",
        );
        expect(permissions.rows.map((row) => row.key)).toEqual([
          "admin:system",
          "asset:create",
          "asset:delete",
          "asset:read",
          "audit:read",
          "billing:manage",
          "billing:read",
          "credential:manage",
          "flow:create",
          "flow:delete",
          "flow:publish",
          "flow:read",
          "flow:run",
          "flow:update",
          "member:manage",
          "member:read",
          "project:create",
          "project:delete",
          "project:read",
          "project:update",
          "provider:manage",
          "provider:read",
          "run:cancel",
          "run:read",
          "tenant:manage",
          "tenant:read",
        ]);

        const roles = await pool.query<{ key: string }>(
          `
            SELECT key
            FROM roles
            WHERE tenant_id IS NULL
            ORDER BY key ASC
          `,
        );
        expect(roles.rows.map((row) => row.key)).toEqual([
          "flow_developer",
          "operator",
          "system_admin",
          "tenant_admin",
          "tenant_owner",
          "viewer",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("enforces tenant isolation for memberships and role visibility", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(pool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const tenantAId = randomUUID();
        const tenantBId = randomUUID();
        const userAId = await insertUser(pool, {
          email: "tenant-a@example.com",
          id: randomUUID(),
          displayName: "Tenant A User",
        });
        const userBId = await insertUser(pool, {
          email: "tenant-b@example.com",
          id: randomUUID(),
          displayName: "Tenant B User",
        });

        await withTenantTransaction(
          { tenantId: tenantAId, userId: userAId },
          async (client) => {
            await client.query(
              `
                INSERT INTO tenants (id, name, slug)
                VALUES ($1, $2, $3)
              `,
              [tenantAId, "Tenant A", "tenant-a"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, joined_at)
                VALUES ($1, $2, $3, now())
              `,
              [tenantAId, userAId, "tenant_owner"],
            );
            await client.query(
              `
                INSERT INTO roles (tenant_id, key, name, description)
                VALUES ($1, $2, $3, $4)
              `,
              [tenantAId, "tenant_a_custom", "Tenant A Custom", "Tenant A private role"],
            );
          },
          appPool,
        );

        await withTenantTransaction(
          { tenantId: tenantBId, userId: userBId },
          async (client) => {
            await client.query(
              `
                INSERT INTO tenants (id, name, slug)
                VALUES ($1, $2, $3)
              `,
              [tenantBId, "Tenant B", "tenant-b"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, joined_at)
                VALUES ($1, $2, $3, now())
              `,
              [tenantBId, userBId, "viewer"],
            );
            await client.query(
              `
                INSERT INTO roles (tenant_id, key, name, description)
                VALUES ($1, $2, $3, $4)
              `,
              [tenantBId, "tenant_b_custom", "Tenant B Custom", "Tenant B private role"],
            );
          },
          appPool,
        );

        const noTenantMemberships = await appPool.query(
          "SELECT tenant_id::text AS tenant_id FROM tenant_memberships ORDER BY tenant_id ASC",
        );
        expect(noTenantMemberships.rows).toEqual([]);

        const tenantAMemberships = await withTenantTransaction(
          { tenantId: tenantAId, userId: userAId },
          async (client) => {
            const rows = await client.query<{ tenant_id: string; user_id: string }>(
              `
                SELECT tenant_id::text AS tenant_id, user_id::text AS user_id
                FROM tenant_memberships
                ORDER BY tenant_id ASC
              `,
            );
            const visibleRoles = await client.query<{ key: string; tenant_id: string | null }>(
              `
                SELECT key, tenant_id::text AS tenant_id
                FROM roles
                ORDER BY key ASC
              `,
            );
            return {
              memberships: rows.rows,
              roles: visibleRoles.rows,
            };
          },
          appPool,
        );

        expect(tenantAMemberships.memberships).toEqual([
          { tenant_id: tenantAId, user_id: userAId },
        ]);
        expect(tenantAMemberships.roles.some((row) => row.key === "tenant_a_custom")).toBe(true);
        expect(tenantAMemberships.roles.some((row) => row.key === "tenant_b_custom")).toBe(false);
        expect(tenantAMemberships.roles.some((row) => row.key === "system_admin" && row.tenant_id === null)).toBe(true);

        const tenantBMemberships = await withTenantTransaction(
          { tenantId: tenantBId, userId: userBId },
          async (client) => {
            const rows = await client.query<{ tenant_id: string; user_id: string }>(
              `
                SELECT tenant_id::text AS tenant_id, user_id::text AS user_id
                FROM tenant_memberships
                ORDER BY tenant_id ASC
              `,
            );
            const visibleRoles = await client.query<{ key: string }>(
              "SELECT key FROM roles ORDER BY key ASC",
            );
            return {
              memberships: rows.rows,
              roleKeys: visibleRoles.rows.map((row) => row.key),
            };
          },
          appPool,
        );

        expect(tenantBMemberships.memberships).toEqual([
          { tenant_id: tenantBId, user_id: userBId },
        ]);
        expect(tenantBMemberships.roleKeys).toContain("tenant_b_custom");
        expect(tenantBMemberships.roleKeys).not.toContain("tenant_a_custom");
      } finally {
        await appPool.end();
        await pool.end();
      }
    });
  });

  test("allows a user to list only their own tenant memberships and tenants", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(pool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const tenantAId = randomUUID();
        const tenantBId = randomUUID();
        const tenantCId = randomUUID();
        const userAId = await insertUser(pool, {
          email: "tenant-list-a@example.com",
          id: randomUUID(),
        });
        const userBId = await insertUser(pool, {
          email: "tenant-list-b@example.com",
          id: randomUUID(),
        });

        await withTenantTransaction(
          { tenantId: tenantAId, userId: userAId },
          async (client) => {
            await client.query(
              "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
              [tenantAId, "Tenant A", "tenant-list-a"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, joined_at)
                VALUES ($1, $2, $3, now())
              `,
              [tenantAId, userAId, "tenant_owner"],
            );
          },
          appPool,
        );

        await withTenantTransaction(
          { tenantId: tenantBId, userId: userBId },
          async (client) => {
            await client.query(
              "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
              [tenantBId, "Tenant B", "tenant-list-b"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, joined_at)
                VALUES ($1, $2, $3, now())
              `,
              [tenantBId, userBId, "viewer"],
            );
          },
          appPool,
        );

        await withTenantTransaction(
          { tenantId: tenantCId, userId: userAId },
          async (client) => {
            await client.query(
              "INSERT INTO tenants (id, name, slug) VALUES ($1, $2, $3)",
              [tenantCId, "Tenant C", "tenant-list-c"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, joined_at)
                VALUES ($1, $2, $3, now())
              `,
              [tenantCId, userAId, "viewer"],
            );
          },
          appPool,
        );

        const anonymousVisible = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: null },
          async (client) => {
            const memberships = await client.query(
              "SELECT tenant_id::text AS tenant_id FROM tenant_memberships ORDER BY tenant_id ASC",
            );
            const tenants = await client.query(
              "SELECT id::text AS id FROM tenants ORDER BY id ASC",
            );
            return {
              memberships: memberships.rows,
              tenants: tenants.rows,
            };
          },
        );

        expect(anonymousVisible).toEqual({
          memberships: [],
          tenants: [],
        });

        const userAVisible = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userAId },
          async (client) => {
            const memberships = await client.query<{ tenant_id: string }>(
              `
                SELECT tenant_id::text AS tenant_id
                FROM tenant_memberships
                ORDER BY tenant_id ASC
              `,
            );
            const tenants = await client.query<{ id: string }>(
              "SELECT id::text AS id FROM tenants ORDER BY id ASC",
            );
            return {
              memberships: memberships.rows.map((row) => row.tenant_id),
              tenants: tenants.rows.map((row) => row.id),
            };
          },
        );

        expect(userAVisible).toEqual({
          memberships: [tenantAId, tenantCId].sort(),
          tenants: [tenantAId, tenantCId].sort(),
        });

        const userBVisible = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userBId },
          async (client) => {
            const tenants = await client.query<{ id: string }>(
              "SELECT id::text AS id FROM tenants ORDER BY id ASC",
            );
            return tenants.rows.map((row) => row.id);
          },
        );

        expect(userBVisible).toEqual([tenantBId]);
      } finally {
        await appPool.end();
        await pool.end();
      }
    });
  });
});
