import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool, withTenantTransaction } from "../src/index.js";
import { runMigrations } from "../src/migrator.js";
import { hasDatabaseEnv, withAppContextTransaction, withDatabase } from "./helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describeWithDatabase("projects / flows migrations and RLS", () => {
  test("creates project, flow, and flow version tables", async () => {
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
              AND table_name IN ('projects', 'flows', 'flow_versions')
            ORDER BY table_name ASC
          `,
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "flow_versions",
          "flows",
          "projects",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant RLS isolates projects, flows, and flow versions", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const userA = randomUUID();
      const userB = randomUUID();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        await withTenantTransaction({ tenantId: tenantA, userId: userA }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userA, "tenant-a@example.com", "Tenant A"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'Tenant A', 'tenant-a', now())
            `,
            [tenantA],
          );
          await client.query(
            `
              INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
              VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
            `,
            [tenantA, userA],
          );

          const project = await client.query<{ id: string }>(
            `
              INSERT INTO projects (tenant_id, name, created_by, updated_at)
              VALUES ($1::uuid, 'Project A', $2::uuid, now())
              RETURNING id::text AS id
            `,
            [tenantA, userA],
          );
          const flow = await client.query<{ id: string }>(
            `
              INSERT INTO flows (
                tenant_id,
                project_id,
                title,
                status,
                created_by,
                updated_by,
                updated_at
              )
              VALUES ($1::uuid, $2::uuid, 'Flow A', 'draft', $3::uuid, $3::uuid, now())
              RETURNING id::text AS id
            `,
            [tenantA, project.rows[0].id, userA],
          );
          const version = await client.query<{ id: string }>(
            `
              INSERT INTO flow_versions (
                tenant_id,
                flow_id,
                version,
                graph_json,
                compiled_graph_json,
                checksum,
                published_by,
                published_at
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                1,
                '{"nodes":[{"id":"start","type":"input"}],"edges":[]}'::jsonb,
                '{"schemaVersion":"v2","nodes":[{"id":"start","type":"input","config":{},"dependencies":[],"dependents":[]}],"edges":[],"entryNodeIds":["start"],"outputNodeIds":["start"]}'::jsonb,
                'checksum-a',
                $3::uuid,
                now()
              )
              RETURNING id::text AS id
            `,
            [tenantA, flow.rows[0].id, userA],
          );
          await client.query(
            `
              UPDATE flows
              SET current_version_id = $2::uuid, status = 'published', updated_at = now()
              WHERE id = $1::uuid
            `,
            [flow.rows[0].id, version.rows[0].id],
          );
        }, adminPool);

        await withTenantTransaction({ tenantId: tenantB, userId: userB }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userB, "tenant-b@example.com", "Tenant B"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'Tenant B', 'tenant-b', now())
            `,
            [tenantB],
          );
          await client.query(
            `
              INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
              VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
            `,
            [tenantB, userB],
          );

          const project = await client.query<{ id: string }>(
            `
              INSERT INTO projects (tenant_id, name, created_by, updated_at)
              VALUES ($1::uuid, 'Project B', $2::uuid, now())
              RETURNING id::text AS id
            `,
            [tenantB, userB],
          );
          const flow = await client.query<{ id: string }>(
            `
              INSERT INTO flows (
                tenant_id,
                project_id,
                title,
                status,
                created_by,
                updated_by,
                updated_at
              )
              VALUES ($1::uuid, $2::uuid, 'Flow B', 'draft', $3::uuid, $3::uuid, now())
              RETURNING id::text AS id
            `,
            [tenantB, project.rows[0].id, userB],
          );
          const version = await client.query<{ id: string }>(
            `
              INSERT INTO flow_versions (
                tenant_id,
                flow_id,
                version,
                graph_json,
                compiled_graph_json,
                checksum,
                published_by,
                published_at
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                1,
                '{"nodes":[{"id":"finish","type":"output"}],"edges":[]}'::jsonb,
                '{"schemaVersion":"v2","nodes":[{"id":"finish","type":"output","config":{},"dependencies":[],"dependents":[]}],"edges":[],"entryNodeIds":["finish"],"outputNodeIds":["finish"]}'::jsonb,
                'checksum-b',
                $3::uuid,
                now()
              )
              RETURNING id::text AS id
            `,
            [tenantB, flow.rows[0].id, userB],
          );
          await client.query(
            `
              UPDATE flows
              SET current_version_id = $2::uuid, status = 'published', updated_at = now()
              WHERE id = $1::uuid
            `,
            [flow.rows[0].id, version.rows[0].id],
          );
        }, adminPool);

        const noTenantProjects = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userA },
          async (client) => {
            const result = await client.query("SELECT COUNT(*)::int AS total FROM projects");
            return result.rows[0]?.total ?? 0;
          },
        );
        expect(noTenantProjects).toBe(0);

        const tenantAView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantA, userId: userA },
          async (client) => {
            const projects = await client.query<{ name: string }>(
              "SELECT name FROM projects ORDER BY name ASC",
            );
            const flows = await client.query<{ title: string }>(
              "SELECT title FROM flows ORDER BY title ASC",
            );
            const versions = await client.query<{ checksum: string }>(
              "SELECT checksum FROM flow_versions ORDER BY checksum ASC",
            );
            return {
              flows: flows.rows.map((row) => row.title),
              projects: projects.rows.map((row) => row.name),
              versions: versions.rows.map((row) => row.checksum),
            };
          },
        );
        expect(tenantAView).toEqual({
          flows: ["Flow A"],
          projects: ["Project A"],
          versions: ["checksum-a"],
        });

        const tenantBView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantB, userId: userB },
          async (client) => {
            const projects = await client.query<{ name: string }>(
              "SELECT name FROM projects ORDER BY name ASC",
            );
            const flows = await client.query<{ title: string }>(
              "SELECT title FROM flows ORDER BY title ASC",
            );
            const versions = await client.query<{ checksum: string }>(
              "SELECT checksum FROM flow_versions ORDER BY checksum ASC",
            );
            return {
              flows: flows.rows.map((row) => row.title),
              projects: projects.rows.map((row) => row.name),
              versions: versions.rows.map((row) => row.checksum),
            };
          },
        );
        expect(tenantBView).toEqual({
          flows: ["Flow B"],
          projects: ["Project B"],
          versions: ["checksum-b"],
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
