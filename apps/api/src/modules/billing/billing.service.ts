import {
  BillingService,
  BillingServiceError,
  createPgPool,
  type BillingSummaryView,
  type BillingLedgerView,
  type UsageEventView,
} from "@aigc-flow/db";
import type { Pool } from "pg";

type PgPool = Pool;

type BillingContext = {
  tenantId: string;
  userId: string | null;
};

export class BillingApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "BillingApiError";
    this.statusCode = statusCode;
  }
}

export class BillingApiService {
  readonly billingService: BillingService;
  readonly pool: PgPool;

  constructor(options?: {
    billingService?: BillingService;
    pool?: PgPool;
  }) {
    this.pool = options?.pool ?? createPgPool();
    this.billingService = options?.billingService ?? new BillingService({ pool: this.pool });
  }

  async getBillingSummary(context: BillingContext): Promise<BillingSummaryView> {
    return this.call(() => this.billingService.getBillingSummary(context));
  }

  async listUsageEvents(
    context: BillingContext,
    input?: {
      limit?: number;
      page?: number;
    },
  ): Promise<{
    items: UsageEventView[];
    page: number;
    pageSize: number;
  }> {
    return this.call(() => this.billingService.listUsageEvents(context, input));
  }

  async listLedgerEntries(
    context: BillingContext,
    input?: {
      limit?: number;
      page?: number;
    },
  ): Promise<{
    items: BillingLedgerView[];
    page: number;
    pageSize: number;
  }> {
    return this.call(() => this.billingService.listLedgerEntries(context, input));
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof BillingServiceError) {
        throw new BillingApiError(error.statusCode, error.code, error.message);
      }

      throw error;
    }
  }
}
