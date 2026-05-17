import {
  listAuditLogs,
  type AuditListOptions,
  type AuditLogView,
  createPgPool,
} from "@aigc-flow/db";
import type { Pool } from "pg";

type PgPool = Pool;

type AuditContext = {
  tenantId: string;
  userId: string | null;
};

export class AuditApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuditApiError";
    this.statusCode = statusCode;
  }
}

export class AuditApiService {
  readonly pool: PgPool;

  constructor(options?: { pool?: PgPool }) {
    this.pool = options?.pool ?? createPgPool();
  }

  async listAuditLogs(
    context: AuditContext,
    options?: AuditListOptions,
  ): Promise<{
    items: AuditLogView[];
    page: number;
    pageSize: number;
  }> {
    try {
      return await listAuditLogs(context, options, this.pool);
    } catch (error) {
      if (error instanceof AuditApiError) {
        throw error;
      }

      throw error;
    }
  }
}
