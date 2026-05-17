import type { Pool, PoolClient } from "pg";

import { createPgPool } from "./db.js";
import { withTenantTransaction, type TenantDbContext } from "./transaction.js";

export type BillingAccountRecord = {
  balance_cents: string;
  created_at: string;
  currency: string;
  id: string;
  metadata: Record<string, unknown>;
  reserved_cents: string;
  status: string;
  tenant_id: string;
  updated_at: string;
};

export type UsageEventRecord = {
  billable_cents: string;
  created_at: string;
  event_type: string;
  id: string;
  idempotency_key: string;
  input_tokens: number | null;
  metadata: Record<string, unknown>;
  modality: string;
  model_id: string | null;
  node_run_id: string | null;
  occurred_at: string;
  output_tokens: number | null;
  provider_id: string | null;
  raw_cost: string | null;
  route_id: string | null;
  status: string;
  tenant_id: string;
  total_tokens: number | null;
  unit_type: string | null;
  units: string | null;
  workflow_run_id: string | null;
};

export type BillingLedgerRecord = {
  amount_cents: string;
  billing_account_id: string;
  created_at: string;
  currency: string;
  description: string | null;
  entry_type: string;
  id: string;
  idempotency_key: string;
  metadata: Record<string, unknown>;
  tenant_id: string;
  usage_event_id: string | null;
};

export type BillingAccountView = {
  balanceCents: number;
  createdAt: string;
  currency: string;
  id: string;
  metadata: Record<string, unknown>;
  reservedCents: number;
  status: string;
  tenantId: string;
  updatedAt: string;
};

export type UsageEventView = {
  billableCents: number;
  createdAt: string;
  eventType: string;
  id: string;
  idempotencyKey: string;
  inputTokens: number | null;
  metadata: Record<string, unknown>;
  modality: string;
  modelId: string | null;
  nodeRunId: string | null;
  occurredAt: string;
  outputTokens: number | null;
  providerId: string | null;
  rawCost: string | null;
  routeId: string | null;
  status: string;
  tenantId: string;
  totalTokens: number | null;
  unitType: string | null;
  units: string | null;
  workflowRunId: string | null;
};

export type BillingLedgerView = {
  amountCents: number;
  billingAccountId: string;
  createdAt: string;
  currency: string;
  description: string | null;
  entryType: string;
  id: string;
  idempotencyKey: string;
  metadata: Record<string, unknown>;
  tenantId: string;
  usageEventId: string | null;
};

export type BillingSummaryView = {
  account: BillingAccountView;
  ledgerTotals: {
    refundCents: number;
    reserveCents: number;
    settleCents: number;
  };
  usageTotals: {
    eventCount: number;
    pendingCount: number;
    rawCostTotal: string;
    settledCount: number;
    totalBillableCents: number;
  };
};

export type UsageEventInput = {
  billableCents?: number;
  eventType: string;
  idempotencyKey: string;
  inputTokens?: number | null;
  metadata?: Record<string, unknown>;
  modality: string;
  modelId?: string | null;
  nodeRunId?: string | null;
  occurredAt?: string | null;
  outputTokens?: number | null;
  providerId?: string | null;
  rawCost?: string | number | null;
  routeId?: string | null;
  status?: string;
  totalTokens?: number | null;
  unitType?: string | null;
  units?: string | number | null;
  workflowRunId?: string | null;
};

export type ReserveUsageInput = {
  amountCents: number;
  currency?: string | null;
  description?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
};

export type SettleUsageInput = {
  amountCents: number;
  currency?: string | null;
  description?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  reservedAmountCents?: number;
  usageEventId: string;
};

export type RefundUsageInput = {
  amountCents: number;
  currency?: string | null;
  description?: string | null;
  idempotencyKey: string;
  metadata?: Record<string, unknown>;
  usageEventId?: string | null;
};

export type BillingListOptions = {
  limit?: number;
  page?: number;
};

export class BillingServiceError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BillingServiceError";
    this.statusCode = statusCode;
  }
}

function parseBigIntString(value: string): number {
  return Number.parseInt(value, 10);
}

function normalizeDecimalValue(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "number") {
    return value.toString();
  }

  const normalized = value.trim();
  return normalized ? normalized : null;
}

function mapBillingAccount(row: BillingAccountRecord): BillingAccountView {
  return {
    balanceCents: parseBigIntString(row.balance_cents),
    createdAt: row.created_at,
    currency: row.currency,
    id: row.id,
    metadata: row.metadata ?? {},
    reservedCents: parseBigIntString(row.reserved_cents),
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
  };
}

function mapUsageEvent(row: UsageEventRecord): UsageEventView {
  return {
    billableCents: parseBigIntString(row.billable_cents),
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    inputTokens: row.input_tokens,
    metadata: row.metadata ?? {},
    modality: row.modality,
    modelId: row.model_id,
    nodeRunId: row.node_run_id,
    occurredAt: row.occurred_at,
    outputTokens: row.output_tokens,
    providerId: row.provider_id,
    rawCost: row.raw_cost,
    routeId: row.route_id,
    status: row.status,
    tenantId: row.tenant_id,
    totalTokens: row.total_tokens,
    unitType: row.unit_type,
    units: row.units,
    workflowRunId: row.workflow_run_id,
  };
}

function mapLedgerEntry(row: BillingLedgerRecord): BillingLedgerView {
  return {
    amountCents: parseBigIntString(row.amount_cents),
    billingAccountId: row.billing_account_id,
    createdAt: row.created_at,
    currency: row.currency,
    description: row.description,
    entryType: row.entry_type,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    metadata: row.metadata ?? {},
    tenantId: row.tenant_id,
    usageEventId: row.usage_event_id,
  };
}

type UsageEventConflictComparable = Pick<
  UsageEventInput,
  "billableCents" | "eventType" | "modality" | "nodeRunId" | "workflowRunId"
>;

type LedgerConflictComparable = {
  amountCents: number;
  entryType: string;
  usageEventId: string | null;
};

function assertUsageEventConflictSafe(
  existing: UsageEventView,
  input: UsageEventConflictComparable,
): void {
  if (
    existing.eventType !== input.eventType ||
    existing.modality !== input.modality ||
    existing.workflowRunId !== (input.workflowRunId ?? null) ||
    existing.nodeRunId !== (input.nodeRunId ?? null) ||
    existing.billableCents !== (input.billableCents ?? 0)
  ) {
    throw new BillingServiceError(
      409,
      "USAGE_EVENT_IDEMPOTENCY_CONFLICT",
      "The usage event idempotency key was reused with different billing data",
    );
  }
}

function assertLedgerConflictSafe(
  existing: BillingLedgerView,
  input: LedgerConflictComparable,
): void {
  if (
    existing.entryType !== input.entryType ||
    existing.amountCents !== input.amountCents ||
    existing.usageEventId !== input.usageEventId
  ) {
    throw new BillingServiceError(
      409,
      "LEDGER_IDEMPOTENCY_CONFLICT",
      "The billing ledger idempotency key was reused with different settlement data",
    );
  }
}

export class BillingService {
  readonly pool: Pool;

  constructor(options?: { pool?: Pool }) {
    this.pool = options?.pool ?? createPgPool();
  }

  async getOrCreateBillingAccount(
    context: TenantDbContext,
    tenantId = context.tenantId,
  ): Promise<BillingAccountView> {
    return withTenantTransaction(context, async (client) => {
      return this.getOrCreateBillingAccountInTransaction(client, tenantId);
    }, this.pool);
  }

  async getOrCreateBillingAccountWithClient(
    client: PoolClient,
    tenantId: string,
  ): Promise<BillingAccountView> {
    return this.getOrCreateBillingAccountInTransaction(client, tenantId);
  }

  async recordUsageEvent(
    context: TenantDbContext,
    input: UsageEventInput,
  ): Promise<UsageEventView> {
    return withTenantTransaction(context, async (client) => {
      return this.recordUsageEventInTransaction(client, context.tenantId, input);
    }, this.pool);
  }

  async recordUsageEventWithClient(
    client: PoolClient,
    tenantId: string,
    input: UsageEventInput,
  ): Promise<UsageEventView> {
    return this.recordUsageEventInTransaction(client, tenantId, input);
  }

  async reserveUsage(
    context: TenantDbContext,
    input: ReserveUsageInput,
  ): Promise<BillingLedgerView> {
    return withTenantTransaction(context, async (client) => {
      const account = await this.getOrCreateBillingAccountInTransaction(client, context.tenantId);
      return this.createLedgerEntryInTransaction(client, {
        amountCents: input.amountCents,
        applyAccountMutation: async () => {
          await client.query(
            `
              UPDATE billing_accounts
              SET
                reserved_cents = reserved_cents + $2::bigint,
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [account.id, input.amountCents],
          );
        },
        billingAccountId: account.id,
        currency: input.currency ?? account.currency,
        description: input.description ?? null,
        entryType: "reserve",
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        tenantId: context.tenantId,
        usageEventId: null,
      });
    }, this.pool);
  }

  async reserveUsageWithClient(
    client: PoolClient,
    tenantId: string,
    input: ReserveUsageInput,
  ): Promise<BillingLedgerView> {
    const account = await this.getOrCreateBillingAccountInTransaction(client, tenantId);
    return this.createLedgerEntryInTransaction(client, {
      amountCents: input.amountCents,
      applyAccountMutation: async () => {
        await client.query(
          `
            UPDATE billing_accounts
            SET
              reserved_cents = reserved_cents + $2::bigint,
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [account.id, input.amountCents],
        );
      },
      billingAccountId: account.id,
      currency: input.currency ?? account.currency,
      description: input.description ?? null,
      entryType: "reserve",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      tenantId,
      usageEventId: null,
    });
  }

  async settleUsage(
    context: TenantDbContext,
    input: SettleUsageInput,
  ): Promise<BillingLedgerView> {
    return withTenantTransaction(context, async (client) => {
      const account = await this.getOrCreateBillingAccountInTransaction(client, context.tenantId);
      const usageEvent = await this.getUsageEventOrThrow(client, input.usageEventId);

      const ledgerEntry = await this.createLedgerEntryInTransaction(client, {
        amountCents: input.amountCents,
        applyAccountMutation: async () => {
          await client.query(
            `
              UPDATE billing_accounts
              SET
                balance_cents = balance_cents - $2::bigint,
                reserved_cents = GREATEST(reserved_cents - $3::bigint, 0),
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [account.id, input.amountCents, input.reservedAmountCents ?? 0],
          );

          await client.query(
            `
              UPDATE usage_events
              SET
                status = 'settled',
                billable_cents = $2::bigint
              WHERE id = $1::uuid
            `,
            [usageEvent.id, input.amountCents],
          );
        },
        billingAccountId: account.id,
        currency: input.currency ?? account.currency,
        description: input.description ?? null,
        entryType: "settle",
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        tenantId: context.tenantId,
        usageEventId: usageEvent.id,
      });

      return ledgerEntry;
    }, this.pool);
  }

  async settleUsageWithClient(
    client: PoolClient,
    tenantId: string,
    input: SettleUsageInput,
  ): Promise<BillingLedgerView> {
    const account = await this.getOrCreateBillingAccountInTransaction(client, tenantId);
    const usageEvent = await this.getUsageEventOrThrow(client, input.usageEventId);

    return this.createLedgerEntryInTransaction(client, {
      amountCents: input.amountCents,
      applyAccountMutation: async () => {
        await client.query(
          `
            UPDATE billing_accounts
            SET
              balance_cents = balance_cents - $2::bigint,
              reserved_cents = GREATEST(reserved_cents - $3::bigint, 0),
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [account.id, input.amountCents, input.reservedAmountCents ?? 0],
        );

        await client.query(
          `
            UPDATE usage_events
            SET
              status = 'settled',
              billable_cents = $2::bigint
            WHERE id = $1::uuid
          `,
          [usageEvent.id, input.amountCents],
        );
      },
      billingAccountId: account.id,
      currency: input.currency ?? account.currency,
      description: input.description ?? null,
      entryType: "settle",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      tenantId,
      usageEventId: usageEvent.id,
    });
  }

  async refundUsage(
    context: TenantDbContext,
    input: RefundUsageInput,
  ): Promise<BillingLedgerView> {
    return withTenantTransaction(context, async (client) => {
      const account = await this.getOrCreateBillingAccountInTransaction(client, context.tenantId);
      const usageEventId = input.usageEventId ?? null;
      if (usageEventId) {
        await this.getUsageEventOrThrow(client, usageEventId);
      }

      return this.createLedgerEntryInTransaction(client, {
        amountCents: input.amountCents,
        applyAccountMutation: async () => {
          await client.query(
            `
              UPDATE billing_accounts
              SET
                reserved_cents = GREATEST(reserved_cents - $2::bigint, 0),
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [account.id, input.amountCents],
          );
        },
        billingAccountId: account.id,
        currency: input.currency ?? account.currency,
        description: input.description ?? null,
        entryType: "refund",
        idempotencyKey: input.idempotencyKey,
        metadata: input.metadata ?? {},
        tenantId: context.tenantId,
        usageEventId,
      });
    }, this.pool);
  }

  async refundUsageWithClient(
    client: PoolClient,
    tenantId: string,
    input: RefundUsageInput,
  ): Promise<BillingLedgerView> {
    const account = await this.getOrCreateBillingAccountInTransaction(client, tenantId);
    const usageEventId = input.usageEventId ?? null;
    if (usageEventId) {
      await this.getUsageEventOrThrow(client, usageEventId);
    }

    return this.createLedgerEntryInTransaction(client, {
      amountCents: input.amountCents,
      applyAccountMutation: async () => {
        await client.query(
          `
            UPDATE billing_accounts
            SET
              reserved_cents = GREATEST(reserved_cents - $2::bigint, 0),
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [account.id, input.amountCents],
        );
      },
      billingAccountId: account.id,
      currency: input.currency ?? account.currency,
      description: input.description ?? null,
      entryType: "refund",
      idempotencyKey: input.idempotencyKey,
      metadata: input.metadata ?? {},
      tenantId,
      usageEventId,
    });
  }

  async getBillingSummary(
    context: TenantDbContext,
  ): Promise<BillingSummaryView> {
    return withTenantTransaction(context, async (client) => {
      const account = await this.getOrCreateBillingAccountInTransaction(client, context.tenantId);
      const usageTotalsResult = await client.query<{
        event_count: number;
        pending_count: number;
        raw_cost_total: string | null;
        settled_count: number;
        total_billable_cents: string;
      }>(
        `
          SELECT
            COUNT(*)::int AS event_count,
            COUNT(*) FILTER (WHERE status = 'pending')::int AS pending_count,
            COUNT(*) FILTER (WHERE status = 'settled')::int AS settled_count,
            COALESCE(SUM(billable_cents), 0)::text AS total_billable_cents,
            COALESCE(SUM(raw_cost), 0)::text AS raw_cost_total
          FROM usage_events
        `,
      );
      const ledgerTotalsResult = await client.query<{
        refund_cents: string;
        reserve_cents: string;
        settle_cents: string;
      }>(
        `
          SELECT
            COALESCE(SUM(CASE WHEN entry_type = 'reserve' THEN amount_cents ELSE 0 END), 0)::text AS reserve_cents,
            COALESCE(SUM(CASE WHEN entry_type = 'settle' THEN amount_cents ELSE 0 END), 0)::text AS settle_cents,
            COALESCE(SUM(CASE WHEN entry_type = 'refund' THEN amount_cents ELSE 0 END), 0)::text AS refund_cents
          FROM billing_ledger
        `,
      );

      const usageTotals = usageTotalsResult.rows[0];
      const ledgerTotals = ledgerTotalsResult.rows[0];

      return {
        account,
        ledgerTotals: {
          refundCents: parseBigIntString(ledgerTotals?.refund_cents ?? "0"),
          reserveCents: parseBigIntString(ledgerTotals?.reserve_cents ?? "0"),
          settleCents: parseBigIntString(ledgerTotals?.settle_cents ?? "0"),
        },
        usageTotals: {
          eventCount: usageTotals?.event_count ?? 0,
          pendingCount: usageTotals?.pending_count ?? 0,
          rawCostTotal: usageTotals?.raw_cost_total ?? "0",
          settledCount: usageTotals?.settled_count ?? 0,
          totalBillableCents: parseBigIntString(usageTotals?.total_billable_cents ?? "0"),
        },
      };
    }, this.pool);
  }

  async listUsageEvents(
    context: TenantDbContext,
    options?: BillingListOptions,
  ): Promise<{
    items: UsageEventView[];
    page: number;
    pageSize: number;
  }> {
    return withTenantTransaction(context, async (client) => {
      const pageSize = Math.max(1, Math.min(options?.limit ?? 20, 100));
      const page = Math.max(1, options?.page ?? 1);
      const offset = (page - 1) * pageSize;
      const result = await client.query<UsageEventRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            workflow_run_id::text AS workflow_run_id,
            node_run_id::text AS node_run_id,
            provider_id::text AS provider_id,
            model_id::text AS model_id,
            route_id::text AS route_id,
            event_type,
            modality,
            status,
            idempotency_key,
            input_tokens,
            output_tokens,
            total_tokens,
            units::text AS units,
            unit_type,
            raw_cost::text AS raw_cost,
            billable_cents::text AS billable_cents,
            metadata,
            occurred_at::text AS occurred_at,
            created_at::text AS created_at
          FROM usage_events
          ORDER BY created_at DESC, id DESC
          LIMIT $1::int
          OFFSET $2::int
        `,
        [pageSize, offset],
      );

      return {
        items: result.rows.map(mapUsageEvent),
        page,
        pageSize,
      };
    }, this.pool);
  }

  async listLedgerEntries(
    context: TenantDbContext,
    options?: BillingListOptions,
  ): Promise<{
    items: BillingLedgerView[];
    page: number;
    pageSize: number;
  }> {
    return withTenantTransaction(context, async (client) => {
      const pageSize = Math.max(1, Math.min(options?.limit ?? 20, 100));
      const page = Math.max(1, options?.page ?? 1);
      const offset = (page - 1) * pageSize;
      const result = await client.query<BillingLedgerRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            billing_account_id::text AS billing_account_id,
            usage_event_id::text AS usage_event_id,
            entry_type,
            amount_cents::text AS amount_cents,
            currency,
            idempotency_key,
            description,
            metadata,
            created_at::text AS created_at
          FROM billing_ledger
          ORDER BY created_at DESC, id DESC
          LIMIT $1::int
          OFFSET $2::int
        `,
        [pageSize, offset],
      );

      return {
        items: result.rows.map(mapLedgerEntry),
        page,
        pageSize,
      };
    }, this.pool);
  }

  private async getOrCreateBillingAccountInTransaction(
    client: PoolClient,
    tenantId: string,
  ): Promise<BillingAccountView> {
    const inserted = await client.query<BillingAccountRecord>(
      `
        INSERT INTO billing_accounts (tenant_id, updated_at)
        VALUES ($1::uuid, now())
        ON CONFLICT (tenant_id) DO NOTHING
        RETURNING
          id::text AS id,
          tenant_id::text AS tenant_id,
          currency,
          balance_cents::text AS balance_cents,
          reserved_cents::text AS reserved_cents,
          status,
          metadata,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [tenantId],
    );

    if (inserted.rows[0]) {
      return mapBillingAccount(inserted.rows[0]);
    }

    const existing = await client.query<BillingAccountRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          currency,
          balance_cents::text AS balance_cents,
          reserved_cents::text AS reserved_cents,
          status,
          metadata,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM billing_accounts
        WHERE tenant_id = $1::uuid
        LIMIT 1
      `,
      [tenantId],
    );

    const row = existing.rows[0];
    if (!row) {
      throw new BillingServiceError(500, "BILLING_ACCOUNT_CREATE_FAILED", "Unable to load billing account");
    }

    return mapBillingAccount(row);
  }

  private async recordUsageEventInTransaction(
    client: PoolClient,
    tenantId: string,
    input: UsageEventInput,
  ): Promise<UsageEventView> {
    const inserted = await client.query<UsageEventRecord>(
      `
        INSERT INTO usage_events (
          tenant_id,
          workflow_run_id,
          node_run_id,
          provider_id,
          model_id,
          route_id,
          event_type,
          modality,
          status,
          idempotency_key,
          input_tokens,
          output_tokens,
          total_tokens,
          units,
          unit_type,
          raw_cost,
          billable_cents,
          metadata,
          occurred_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5::uuid,
          $6::uuid,
          $7,
          $8,
          $9,
          $10,
          $11::int,
          $12::int,
          $13::int,
          $14::numeric(18, 6),
          $15,
          $16::numeric(18, 8),
          $17::bigint,
          $18::jsonb,
          COALESCE($19::timestamptz, now())
        )
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING
          id::text AS id,
          tenant_id::text AS tenant_id,
          workflow_run_id::text AS workflow_run_id,
          node_run_id::text AS node_run_id,
          provider_id::text AS provider_id,
          model_id::text AS model_id,
          route_id::text AS route_id,
          event_type,
          modality,
          status,
          idempotency_key,
          input_tokens,
          output_tokens,
          total_tokens,
          units::text AS units,
          unit_type,
          raw_cost::text AS raw_cost,
          billable_cents::text AS billable_cents,
          metadata,
          occurred_at::text AS occurred_at,
          created_at::text AS created_at
      `,
      [
        tenantId,
        input.workflowRunId ?? null,
        input.nodeRunId ?? null,
        input.providerId ?? null,
        input.modelId ?? null,
        input.routeId ?? null,
        input.eventType,
        input.modality,
        input.status ?? "pending",
        input.idempotencyKey,
        input.inputTokens ?? null,
        input.outputTokens ?? null,
        input.totalTokens ?? null,
        normalizeDecimalValue(input.units),
        input.unitType ?? null,
        normalizeDecimalValue(input.rawCost),
        input.billableCents ?? 0,
        JSON.stringify(input.metadata ?? {}),
        input.occurredAt ?? null,
      ],
    );

    if (inserted.rows[0]) {
      return mapUsageEvent(inserted.rows[0]);
    }

    const existing = await this.getUsageEventByIdempotencyKey(client, input.idempotencyKey);
    if (!existing) {
      throw new BillingServiceError(500, "USAGE_EVENT_CREATE_FAILED", "Unable to load usage event");
    }

    assertUsageEventConflictSafe(existing, input);
    return existing;
  }

  private async createLedgerEntryInTransaction(
    client: PoolClient,
    input: {
      amountCents: number;
      applyAccountMutation: () => Promise<void>;
      billingAccountId: string;
      currency: string;
      description: string | null;
      entryType: string;
      idempotencyKey: string;
      metadata: Record<string, unknown>;
      tenantId: string;
      usageEventId: string | null;
    },
  ): Promise<BillingLedgerView> {
    const inserted = await client.query<BillingLedgerRecord>(
      `
        INSERT INTO billing_ledger (
          tenant_id,
          billing_account_id,
          usage_event_id,
          entry_type,
          amount_cents,
          currency,
          idempotency_key,
          description,
          metadata
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5::bigint,
          $6,
          $7,
          $8,
          $9::jsonb
        )
        ON CONFLICT (tenant_id, idempotency_key) DO NOTHING
        RETURNING
          id::text AS id,
          tenant_id::text AS tenant_id,
          billing_account_id::text AS billing_account_id,
          usage_event_id::text AS usage_event_id,
          entry_type,
          amount_cents::text AS amount_cents,
          currency,
          idempotency_key,
          description,
          metadata,
          created_at::text AS created_at
      `,
      [
        input.tenantId,
        input.billingAccountId,
        input.usageEventId,
        input.entryType,
        input.amountCents,
        input.currency,
        input.idempotencyKey,
        input.description,
        JSON.stringify(input.metadata),
      ],
    );

    if (!inserted.rows[0]) {
      const existing = await this.getLedgerEntryByIdempotencyKey(client, input.idempotencyKey);
      if (!existing) {
        throw new BillingServiceError(500, "BILLING_LEDGER_CREATE_FAILED", "Unable to load ledger entry");
      }

      assertLedgerConflictSafe(existing, {
        amountCents: input.amountCents,
        entryType: input.entryType,
        usageEventId: input.usageEventId,
      });
      return existing;
    }

    await input.applyAccountMutation();
    return mapLedgerEntry(inserted.rows[0]);
  }

  private async getUsageEventOrThrow(
    client: PoolClient,
    usageEventId: string,
  ): Promise<UsageEventView> {
    const result = await client.query<UsageEventRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          workflow_run_id::text AS workflow_run_id,
          node_run_id::text AS node_run_id,
          provider_id::text AS provider_id,
          model_id::text AS model_id,
          route_id::text AS route_id,
          event_type,
          modality,
          status,
          idempotency_key,
          input_tokens,
          output_tokens,
          total_tokens,
          units::text AS units,
          unit_type,
          raw_cost::text AS raw_cost,
          billable_cents::text AS billable_cents,
          metadata,
          occurred_at::text AS occurred_at,
          created_at::text AS created_at
        FROM usage_events
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [usageEventId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new BillingServiceError(404, "USAGE_EVENT_NOT_FOUND", "Usage event not found");
    }

    return mapUsageEvent(row);
  }

  private async getUsageEventByIdempotencyKey(
    client: PoolClient,
    idempotencyKey: string,
  ): Promise<UsageEventView | null> {
    const result = await client.query<UsageEventRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          workflow_run_id::text AS workflow_run_id,
          node_run_id::text AS node_run_id,
          provider_id::text AS provider_id,
          model_id::text AS model_id,
          route_id::text AS route_id,
          event_type,
          modality,
          status,
          idempotency_key,
          input_tokens,
          output_tokens,
          total_tokens,
          units::text AS units,
          unit_type,
          raw_cost::text AS raw_cost,
          billable_cents::text AS billable_cents,
          metadata,
          occurred_at::text AS occurred_at,
          created_at::text AS created_at
        FROM usage_events
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    );

    return result.rows[0] ? mapUsageEvent(result.rows[0]) : null;
  }

  private async getLedgerEntryByIdempotencyKey(
    client: PoolClient,
    idempotencyKey: string,
  ): Promise<BillingLedgerView | null> {
    const result = await client.query<BillingLedgerRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          billing_account_id::text AS billing_account_id,
          usage_event_id::text AS usage_event_id,
          entry_type,
          amount_cents::text AS amount_cents,
          currency,
          idempotency_key,
          description,
          metadata,
          created_at::text AS created_at
        FROM billing_ledger
        WHERE idempotency_key = $1
        LIMIT 1
      `,
      [idempotencyKey],
    );

    return result.rows[0] ? mapLedgerEntry(result.rows[0]) : null;
  }
}
