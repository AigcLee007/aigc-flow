import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import {
  BillingService,
  createPgPool,
  withTenantTransaction,
} from "../src/index.js";
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

async function seedBillingTenant(
  pool: ReturnType<typeof createPgPool>,
  input: {
    slug: string;
    tenantId: string;
    userId: string;
  },
) {
  await withTenantTransaction({ tenantId: input.tenantId, userId: input.userId }, async (client) => {
    await client.query(
      `
        INSERT INTO users (id, email, display_name)
        VALUES ($1::uuid, $2, $3)
      `,
      [input.userId, `${input.slug}@example.com`, input.slug],
    );
    await client.query(
      `
        INSERT INTO tenants (id, name, slug, updated_at)
        VALUES ($1::uuid, $2, $3, now())
      `,
      [input.tenantId, input.slug, input.slug],
    );
    await client.query(
      `
        INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
        VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
      `,
      [input.tenantId, input.userId],
    );
  }, pool);
}

describeWithDatabase("billing migration, RLS, and idempotency", () => {
  test("000008_billing.sql creates billing tables and re-applies idempotently", async () => {
    await withDatabase(async ({ databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const pool = createPgPool();

      try {
        await runMigrations(pool);
        await runMigrations(pool);

        const tables = await pool.query<{ table_name: string }>(
          `
            SELECT table_name
            FROM information_schema.tables
            WHERE table_schema = 'public'
              AND table_name IN (
                'billing_accounts',
                'usage_events',
                'billing_ledger'
              )
            ORDER BY table_name ASC
          `,
        );

        expect(tables.rows.map((row) => row.table_name)).toEqual([
          "billing_accounts",
          "billing_ledger",
          "usage_events",
        ]);
      } finally {
        await pool.end();
      }
    });
  });

  test("tenant RLS isolates billing tables and no tenant sees no rows", async () => {
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

        await seedBillingTenant(adminPool, {
          slug: "billing-a",
          tenantId: tenantA,
          userId: userA,
        });
        await seedBillingTenant(adminPool, {
          slug: "billing-b",
          tenantId: tenantB,
          userId: userB,
        });

        const billingServiceA = new BillingService({ pool: appPool });
        const usageEventA = await billingServiceA.recordUsageEvent(
          { tenantId: tenantA, userId: userA },
          {
            billableCents: 0,
            eventType: "ai.text.generate",
            idempotencyKey: `usage:${tenantA}:run-a:node-a:text`,
            modality: "text",
            nodeRunId: null,
            workflowRunId: null,
          },
        );
        await billingServiceA.settleUsage(
          { tenantId: tenantA, userId: userA },
          {
            amountCents: 0,
            idempotencyKey: `settle:${usageEventA.id}`,
            usageEventId: usageEventA.id,
          },
        );

        const tenantAView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantA, userId: userA },
          async (client) => {
            const accounts = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_accounts",
            );
            const usage = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM usage_events",
            );
            const ledger = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_ledger",
            );
            return {
              accounts: accounts.rows[0]?.total ?? 0,
              ledger: ledger.rows[0]?.total ?? 0,
              usage: usage.rows[0]?.total ?? 0,
            };
          },
        );

        expect(tenantAView).toEqual({
          accounts: 1,
          ledger: 1,
          usage: 1,
        });

        const tenantBView = await withAppContextTransaction(
          appPool,
          { tenantId: tenantB, userId: userB },
          async (client) => {
            const accounts = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_accounts",
            );
            const usage = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM usage_events",
            );
            const ledger = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_ledger",
            );
            return {
              accounts: accounts.rows[0]?.total ?? 0,
              ledger: ledger.rows[0]?.total ?? 0,
              usage: usage.rows[0]?.total ?? 0,
            };
          },
        );

        expect(tenantBView).toEqual({
          accounts: 0,
          ledger: 0,
          usage: 0,
        });

        const noTenantView = await withAppContextTransaction(
          appPool,
          { tenantId: null, userId: userA },
          async (client) => {
            const accounts = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_accounts",
            );
            const usage = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM usage_events",
            );
            const ledger = await client.query<{ total: number }>(
              "SELECT COUNT(*)::int AS total FROM billing_ledger",
            );
            return {
              accounts: accounts.rows[0]?.total ?? 0,
              ledger: ledger.rows[0]?.total ?? 0,
              usage: usage.rows[0]?.total ?? 0,
            };
          },
        );

        expect(noTenantView).toEqual({
          accounts: 0,
          ledger: 0,
          usage: 0,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("recordUsageEvent and settleUsage stay idempotent for retries", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      const tenantId = randomUUID();
      const userId = randomUUID();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        await seedBillingTenant(adminPool, {
          slug: "billing-idempotent",
          tenantId,
          userId,
        });

        const billingService = new BillingService({ pool: appPool });
        const firstUsage = await billingService.recordUsageEvent(
          { tenantId, userId },
          {
            billableCents: 0,
            eventType: "ai.image.generate",
            idempotencyKey: `usage:${tenantId}:run-1:node-1:image`,
            modality: "image",
            rawCost: "0.12345678",
            unitType: "output_count",
            units: 1,
          },
        );
        const secondUsage = await billingService.recordUsageEvent(
          { tenantId, userId },
          {
            billableCents: 0,
            eventType: "ai.image.generate",
            idempotencyKey: `usage:${tenantId}:run-1:node-1:image`,
            modality: "image",
            rawCost: "0.12345678",
            unitType: "output_count",
            units: 1,
          },
        );

        expect(secondUsage.id).toBe(firstUsage.id);

        const firstSettle = await billingService.settleUsage(
          { tenantId, userId },
          {
            amountCents: 0,
            description: "zero-cost settle",
            idempotencyKey: `settle:${firstUsage.id}`,
            usageEventId: firstUsage.id,
          },
        );
        const secondSettle = await billingService.settleUsage(
          { tenantId, userId },
          {
            amountCents: 0,
            description: "zero-cost settle",
            idempotencyKey: `settle:${firstUsage.id}`,
            usageEventId: firstUsage.id,
          },
        );

        expect(secondSettle.id).toBe(firstSettle.id);

        const summary = await billingService.getBillingSummary({
          tenantId,
          userId,
        });
        expect(summary.usageTotals.eventCount).toBe(1);
        expect(summary.usageTotals.settledCount).toBe(1);

        const usageEvents = await billingService.listUsageEvents(
          { tenantId, userId },
          { limit: 10, page: 1 },
        );
        const ledgerEntries = await billingService.listLedgerEntries(
          { tenantId, userId },
          { limit: 10, page: 1 },
        );

        expect(usageEvents.items).toHaveLength(1);
        expect(ledgerEntries.items).toHaveLength(1);
        expect(ledgerEntries.items[0]).toMatchObject({
          amountCents: 0,
          entryType: "settle",
          usageEventId: firstUsage.id,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
