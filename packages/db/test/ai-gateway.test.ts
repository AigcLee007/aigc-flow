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

describeWithDatabase("ai gateway migration and RLS", () => {
  test("creates AI Gateway tables", async () => {
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
                'ai_providers',
                'ai_models',
                'api_credentials',
                'ai_routes',
                'ai_call_logs'
              )
            ORDER BY table_name ASC
          `,
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "ai_call_logs",
          "ai_models",
          "ai_providers",
          "ai_routes",
          "api_credentials",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant RLS isolates credentials, routes, and call logs while exposing system routes", async () => {
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

        await adminPool.query(
          `
            INSERT INTO ai_providers (id, key, name, kind)
            VALUES ($1::uuid, 'openai-compatible', 'OpenAI Compatible', 'openai-compatible')
          `,
          ["11111111-1111-1111-1111-111111111111"],
        );
        await adminPool.query(
          `
            INSERT INTO ai_models (
              id,
              provider_id,
              model_key,
              display_name,
              modality
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              'gpt-test',
              'GPT Test',
              'text'
            )
          `,
          [
            "22222222-2222-2222-2222-222222222222",
            "11111111-1111-1111-1111-111111111111",
          ],
        );

        await withTenantTransaction({ tenantId: tenantA, userId: userA }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userA, "ai-tenant-a@example.com", "AI Tenant A"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'AI Tenant A', 'ai-tenant-a', now())
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
          await client.query(
            `
              INSERT INTO api_credentials (
                tenant_id,
                provider_id,
                name,
                encrypted_secret,
                nonce,
                auth_tag,
                key_version,
                secret_fingerprint,
                created_by
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                'Tenant A Credential',
                $3::bytea,
                $4::bytea,
                $5::bytea,
                'v1',
                'fingerprint-a',
                $6::uuid
              )
            `,
            [
              tenantA,
              "11111111-1111-1111-1111-111111111111",
              Buffer.from("secret-a"),
              Buffer.from("nonce-a"),
              Buffer.from("tag-a"),
              userA,
            ],
          );
          await client.query(
            `
              INSERT INTO ai_routes (
                tenant_id,
                provider_id,
                model_id,
                route_key,
                modality,
                priority,
                weight
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                'tenant-a-route',
                'text',
                10,
                100
              )
            `,
            [
              tenantA,
              "11111111-1111-1111-1111-111111111111",
              "22222222-2222-2222-2222-222222222222",
            ],
          );
          await client.query(
            `
              INSERT INTO ai_call_logs (
                tenant_id,
                provider_id,
                model_id,
                status,
                latency_ms
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                'succeeded',
                120
              )
            `,
            [
              tenantA,
              "11111111-1111-1111-1111-111111111111",
              "22222222-2222-2222-2222-222222222222",
            ],
          );
        }, adminPool);

        await withTenantTransaction({ tenantId: tenantB, userId: userB }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userB, "ai-tenant-b@example.com", "AI Tenant B"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'AI Tenant B', 'ai-tenant-b', now())
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
          await client.query(
            `
              INSERT INTO api_credentials (
                tenant_id,
                provider_id,
                name,
                encrypted_secret,
                nonce,
                auth_tag,
                key_version,
                secret_fingerprint,
                created_by
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                'Tenant B Credential',
                $3::bytea,
                $4::bytea,
                $5::bytea,
                'v1',
                'fingerprint-b',
                $6::uuid
              )
            `,
            [
              tenantB,
              "11111111-1111-1111-1111-111111111111",
              Buffer.from("secret-b"),
              Buffer.from("nonce-b"),
              Buffer.from("tag-b"),
              userB,
            ],
          );
          await client.query(
            `
              INSERT INTO ai_routes (
                tenant_id,
                provider_id,
                model_id,
                route_key,
                modality,
                priority,
                weight
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                'tenant-b-route',
                'text',
                20,
                100
              )
            `,
            [
              tenantB,
              "11111111-1111-1111-1111-111111111111",
              "22222222-2222-2222-2222-222222222222",
            ],
          );
          await client.query(
            `
              INSERT INTO ai_call_logs (
                tenant_id,
                provider_id,
                model_id,
                status,
                latency_ms
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                $3::uuid,
                'failed',
                220
              )
            `,
            [
              tenantB,
              "11111111-1111-1111-1111-111111111111",
              "22222222-2222-2222-2222-222222222222",
            ],
          );
        }, adminPool);

        await adminPool.query(
          `
            INSERT INTO ai_routes (
              tenant_id,
              provider_id,
              model_id,
              route_key,
              modality,
              priority,
              weight
            )
            VALUES (
              NULL,
              $1::uuid,
              $2::uuid,
              'system-text-default',
              'text',
              1,
              100
            )
          `,
          [
            "11111111-1111-1111-1111-111111111111",
            "22222222-2222-2222-2222-222222222222",
          ],
        );

        const tenantAView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantA, userId: userA },
          async (client) => {
            const credentials = await client.query<{ name: string }>(
              "SELECT name FROM api_credentials ORDER BY name ASC",
            );
            const routes = await client.query<{ route_key: string }>(
              "SELECT route_key FROM ai_routes ORDER BY route_key ASC",
            );
            const callLogs = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM ai_call_logs",
            );
            const systemRouteUpdate = await client.query<{ id: string }>(
              `
                UPDATE ai_routes
                SET priority = 99
                WHERE route_key = 'system-text-default'
                RETURNING id::text AS id
              `,
            );
            return {
              callLogs: callLogs.rows[0]?.total ?? 0,
              credentials: credentials.rows.map((row) => row.name),
              routes: routes.rows.map((row) => row.route_key),
              systemRouteUpdateCount: systemRouteUpdate.rowCount,
            };
          },
        );

        expect(tenantAView).toEqual({
          callLogs: 1,
          credentials: ["Tenant A Credential"],
          routes: ["system-text-default", "tenant-a-route"],
          systemRouteUpdateCount: 0,
        });

        const tenantBView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantB, userId: userB },
          async (client) => {
            const credentials = await client.query<{ name: string }>(
              "SELECT name FROM api_credentials ORDER BY name ASC",
            );
            const routes = await client.query<{ route_key: string }>(
              "SELECT route_key FROM ai_routes ORDER BY route_key ASC",
            );
            const callLogs = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM ai_call_logs",
            );
            return {
              callLogs: callLogs.rows[0]?.total ?? 0,
              credentials: credentials.rows.map((row) => row.name),
              routes: routes.rows.map((row) => row.route_key),
            };
          },
        );

        expect(tenantBView).toEqual({
          callLogs: 1,
          credentials: ["Tenant B Credential"],
          routes: ["system-text-default", "tenant-b-route"],
        });

        const noTenantView = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userA },
          async (client) => {
            const credentials = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM api_credentials",
            );
            const routes = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM ai_routes",
            );
            const callLogs = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM ai_call_logs",
            );
            return {
              callLogs: callLogs.rows[0]?.total ?? 0,
              credentials: credentials.rows[0]?.total ?? 0,
              routes: routes.rows[0]?.total ?? 0,
            };
          },
        );

        expect(noTenantView).toEqual({
          callLogs: 0,
          credentials: 0,
          routes: 1,
        });

        await expect(
          withAppContextTransaction(
            appPool,
            { tenantId: tenantA, userId: userA },
            async (client) => {
              await client.query(
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
                    'forbidden-system-write',
                    'text'
                  )
                `,
                [
                  "11111111-1111-1111-1111-111111111111",
                  "22222222-2222-2222-2222-222222222222",
                ],
              );
            },
          ),
        ).rejects.toMatchObject({
          code: "42501",
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
