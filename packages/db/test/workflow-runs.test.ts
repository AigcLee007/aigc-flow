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

describeWithDatabase("workflow runs migration and RLS", () => {
  test("creates workflow run tables", async () => {
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
              AND table_name IN (
                'workflow_runs',
                'node_runs',
                'workflow_run_events'
              )
            ORDER BY table_name ASC
          `,
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "node_runs",
          "workflow_run_events",
          "workflow_runs",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant RLS isolates workflow runs, node runs, and events", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      const tenantA = randomUUID();
      const tenantB = randomUUID();
      const userA = randomUUID();
      const userB = randomUUID();
      const projectA = randomUUID();
      const projectB = randomUUID();
      const flowA = randomUUID();
      const flowB = randomUUID();
      const versionA = randomUUID();
      const versionB = randomUUID();
      const runA = randomUUID();
      const runB = randomUUID();
      const nodeRunA = randomUUID();
      const nodeRunB = randomUUID();

      const compiledGraph = {
        edges: [
          { source: "input", target: "text" },
          { source: "text", target: "output" },
        ],
        entryNodeIds: ["input"],
        nodes: [
          {
            config: { inputKey: "prompt" },
            dependencies: [],
            dependents: ["text"],
            id: "input",
            type: "input",
          },
          {
            config: { routeKey: "default-text" },
            dependencies: ["input"],
            dependents: ["output"],
            id: "text",
            type: "text.generate",
          },
          {
            config: {},
            dependencies: ["text"],
            dependents: [],
            id: "output",
            type: "output",
          },
        ],
        outputNodeIds: ["output"],
        schemaVersion: "v2",
      };

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        for (const [tenantId, userId, projectId, flowId, versionId, runId, nodeRunId, email, slug] of [
          [tenantA, userA, projectA, flowA, versionA, runA, nodeRunA, "workflow-a@example.com", "workflow-a"],
          [tenantB, userB, projectB, flowB, versionB, runB, nodeRunB, "workflow-b@example.com", "workflow-b"],
        ] as const) {
          await withTenantTransaction({ tenantId, userId }, async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name)
                VALUES ($1::uuid, $2, $3)
              `,
              [userId, email, slug],
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
            await client.query(
              `
                INSERT INTO projects (id, tenant_id, name, created_by, updated_at)
                VALUES ($1::uuid, $2::uuid, $3, $4::uuid, now())
              `,
              [projectId, tenantId, `${slug}-project`, userId],
            );
            await client.query(
              `
                INSERT INTO flows (id, tenant_id, project_id, title, status, current_version_id, created_by, updated_by, updated_at)
                VALUES ($1::uuid, $2::uuid, $3::uuid, $4, 'published', null, $5::uuid, $5::uuid, now())
              `,
              [flowId, tenantId, projectId, `${slug}-flow`, userId],
            );
            await client.query(
              `
                INSERT INTO flow_versions (
                  id,
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
                  $3::uuid,
                  1,
                  $4::jsonb,
                  $5::jsonb,
                  $6,
                  $7::uuid,
                  now()
                )
              `,
              [
                versionId,
                tenantId,
                flowId,
                JSON.stringify({ edges: [], nodes: [] }),
                JSON.stringify(compiledGraph),
                `${slug}-checksum`,
                userId,
              ],
            );
            await client.query(
              `
                UPDATE flows
                SET current_version_id = $2::uuid
                WHERE id = $1::uuid
              `,
              [flowId, versionId],
            );
            await client.query(
              `
                INSERT INTO workflow_runs (
                  id,
                  tenant_id,
                  flow_id,
                  flow_version_id,
                  status,
                  input_json,
                  created_by,
                  updated_at
                )
                VALUES (
                  $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  $4::uuid,
                  'running',
                  $5::jsonb,
                  $6::uuid,
                  now()
                )
              `,
              [runId, tenantId, flowId, versionId, JSON.stringify({ prompt: slug }), userId],
            );
            await client.query(
              `
                INSERT INTO node_runs (
                  id,
                  tenant_id,
                  workflow_run_id,
                  node_id,
                  node_type,
                  status,
                  updated_at
                )
                VALUES (
                  $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  'input',
                  'input',
                  'succeeded',
                  now()
                )
              `,
              [nodeRunId, tenantId, runId],
            );
            await client.query(
              `
                INSERT INTO workflow_run_events (
                  tenant_id,
                  workflow_run_id,
                  node_run_id,
                  event_type,
                  sequence,
                  payload
                )
                VALUES (
                  $1::uuid,
                  $2::uuid,
                  $3::uuid,
                  'workflow.run.created',
                  1,
                  '{}'::jsonb
                )
              `,
              [tenantId, runId, nodeRunId],
            );
          }, adminPool);
        }

        const tenantAView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantA, userId: userA },
          async (client) => {
            const runs = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM workflow_runs",
            );
            const nodeRuns = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM node_runs",
            );
            const events = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM workflow_run_events",
            );
            return {
              events: events.rows[0]?.total ?? 0,
              nodeRuns: nodeRuns.rows[0]?.total ?? 0,
              runs: runs.rows[0]?.total ?? 0,
            };
          },
        );

        expect(tenantAView).toEqual({
          events: 1,
          nodeRuns: 1,
          runs: 1,
        });

        const noTenantView = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userA },
          async (client) => {
            const runs = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM workflow_runs",
            );
            const nodeRuns = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM node_runs",
            );
            const events = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM workflow_run_events",
            );
            return {
              events: events.rows[0]?.total ?? 0,
              nodeRuns: nodeRuns.rows[0]?.total ?? 0,
              runs: runs.rows[0]?.total ?? 0,
            };
          },
        );

        expect(noTenantView).toEqual({
          events: 0,
          nodeRuns: 0,
          runs: 0,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
