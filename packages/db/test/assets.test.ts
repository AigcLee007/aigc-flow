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

describeWithDatabase("assets migration and RLS", () => {
  test("creates assets and asset_variants tables", async () => {
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
              AND table_name IN ('assets', 'asset_variants')
            ORDER BY table_name ASC
          `,
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "asset_variants",
          "assets",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant RLS isolates assets and hides them when app.tenant_id is missing", async () => {
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
            [userA, "asset-tenant-a@example.com", "Asset Tenant A"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'Asset Tenant A', 'asset-tenant-a', now())
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

          const asset = await client.query<{ id: string }>(
            `
              INSERT INTO assets (
                tenant_id,
                owner_user_id,
                kind,
                mime_type,
                bucket,
                object_key,
                original_filename,
                status
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                'image',
                'image/png',
                'bucket-a',
                'tenants/tenant-a/assets/a/original-image.png',
                'image-a.png',
                'available'
              )
              RETURNING id::text AS id
            `,
            [tenantA, userA],
          );

          await client.query(
            `
              INSERT INTO asset_variants (
                tenant_id,
                asset_id,
                variant_key,
                bucket,
                object_key,
                mime_type,
                width,
                height
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                'thumb',
                'bucket-a',
                'tenants/tenant-a/assets/a/variants/thumb.webp',
                'image/webp',
                256,
                256
              )
            `,
            [tenantA, asset.rows[0].id],
          );
        }, adminPool);

        await withTenantTransaction({ tenantId: tenantB, userId: userB }, async (client) => {
          await client.query(
            `
              INSERT INTO users (id, email, display_name)
              VALUES ($1::uuid, $2, $3)
            `,
            [userB, "asset-tenant-b@example.com", "Asset Tenant B"],
          );
          await client.query(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, 'Asset Tenant B', 'asset-tenant-b', now())
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
              INSERT INTO assets (
                tenant_id,
                owner_user_id,
                kind,
                mime_type,
                bucket,
                object_key,
                original_filename,
                status
              )
              VALUES (
                $1::uuid,
                $2::uuid,
                'image',
                'image/jpeg',
                'bucket-b',
                'tenants/tenant-b/assets/b/original-image.jpg',
                'image-b.jpg',
                'available'
              )
            `,
            [tenantB, userB],
          );
        }, adminPool);

        const noTenantView = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userA },
          async (client) => {
            const assets = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM assets",
            );
            const variants = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM asset_variants",
            );
            return {
              assets: assets.rows[0]?.total ?? 0,
              variants: variants.rows[0]?.total ?? 0,
            };
          },
        );
        expect(noTenantView).toEqual({
          assets: 0,
          variants: 0,
        });

        const tenantAView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantA, userId: userA },
          async (client) => {
            const assets = await client.query<{ object_key: string }>(
              "SELECT object_key FROM assets ORDER BY object_key ASC",
            );
            const variants = await client.query<{ object_key: string }>(
              "SELECT object_key FROM asset_variants ORDER BY object_key ASC",
            );
            return {
              assets: assets.rows.map((row) => row.object_key),
              variants: variants.rows.map((row) => row.object_key),
            };
          },
        );
        expect(tenantAView).toEqual({
          assets: ["tenants/tenant-a/assets/a/original-image.png"],
          variants: ["tenants/tenant-a/assets/a/variants/thumb.webp"],
        });

        const tenantBView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantB, userId: userB },
          async (client) => {
            const assets = await client.query<{ object_key: string }>(
              "SELECT object_key FROM assets ORDER BY object_key ASC",
            );
            const variants = await client.query<{ object_key: string }>(
              "SELECT object_key FROM asset_variants ORDER BY object_key ASC",
            );
            return {
              assets: assets.rows.map((row) => row.object_key),
              variants: variants.rows.map((row) => row.object_key),
            };
          },
        );
        expect(tenantBView).toEqual({
          assets: ["tenants/tenant-b/assets/b/original-image.jpg"],
          variants: [],
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
