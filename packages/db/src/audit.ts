import { createHash } from "node:crypto";

import type { Pool, PoolClient } from "pg";

import { createPgPool } from "./db.js";
import { withTenantTransaction, type TenantDbContext } from "./transaction.js";

const REDACTED = "[REDACTED]";
const MAX_STRING_LENGTH = 2_048;
const MAX_ARRAY_LENGTH = 50;
const MAX_DEPTH = 6;
const SENSITIVE_KEY_NAMES = new Set([
  "access_token",
  "accessToken",
  "apiKey",
  "apiSecret",
  "auth_tag",
  "authTag",
  "authorization",
  "authorization_header",
  "authorizationHeader",
  "base64",
  "clientSecret",
  "credentialSecret",
  "encrypted_secret",
  "encryptedSecret",
  "messages",
  "nonce",
  "password",
  "password_hash",
  "passwordHash",
  "prompt",
  "raw_request",
  "rawRequest",
  "raw_response",
  "rawResponse",
  "refresh_token",
  "refreshToken",
  "secretKey",
  "secret",
  "token",
  "token_hash",
  "tokenHash",
  "providerSecret",
]);

export type AuditActorType = "system" | "user" | string;

export type AuditLogInput = {
  action: string;
  actorType?: AuditActorType;
  actorUserId?: string | null;
  ipHash?: string | null;
  metadata?: Record<string, unknown>;
  requestId?: string | null;
  resourceId?: string | null;
  resourceType: string;
  tenantId: string;
  traceId?: string | null;
  userAgent?: string | null;
};

export type AuditLogRecord = {
  action: string;
  actor_type: string;
  actor_user_id: string | null;
  created_at: string;
  id: string;
  ip_hash: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
  resource_id: string | null;
  resource_type: string;
  tenant_id: string | null;
  trace_id: string | null;
  user_agent: string | null;
};

export type AuditLogView = {
  action: string;
  actorType: string;
  actorUserId: string | null;
  createdAt: string;
  id: string;
  ipHash: string | null;
  metadata: Record<string, unknown>;
  requestId: string | null;
  resourceId: string | null;
  resourceType: string;
  tenantId: string | null;
  traceId: string | null;
  userAgent: string | null;
};

export type AuditListOptions = {
  action?: string;
  limit?: number;
  page?: number;
  resourceId?: string;
  resourceType?: string;
};

let sharedPool: Pool | null = null;

function getSharedPgPool(): Pool {
  if (!sharedPool) {
    sharedPool = createPgPool();
  }
  return sharedPool;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_NAMES.has(key) ||
    key.toLowerCase().includes("password") ||
    key.toLowerCase().includes("authorization");
}

function sanitizeAuditValue(value: unknown, depth = 0): unknown {
  if (depth >= MAX_DEPTH) {
    return "[TRUNCATED]";
  }

  if (typeof value === "string") {
    return value.length > MAX_STRING_LENGTH ? `${value.slice(0, MAX_STRING_LENGTH)}...[truncated]` : value;
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LENGTH).map((entry) => sanitizeAuditValue(entry, depth + 1));
  }

  if (isPlainObject(value)) {
    const sanitizedEntries = Object.entries(value).map(([key, nestedValue]) => {
      if (isSensitiveKey(key)) {
        return [key, REDACTED] as const;
      }

      return [key, sanitizeAuditValue(nestedValue, depth + 1)] as const;
    });

    return Object.fromEntries(sanitizedEntries);
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

function mapAuditLog(row: AuditLogRecord): AuditLogView {
  return {
    action: row.action,
    actorType: row.actor_type,
    actorUserId: row.actor_user_id,
    createdAt: row.created_at,
    id: row.id,
    ipHash: row.ip_hash,
    metadata: row.metadata ?? {},
    requestId: row.request_id,
    resourceId: row.resource_id,
    resourceType: row.resource_type,
    tenantId: row.tenant_id,
    traceId: row.trace_id,
    userAgent: row.user_agent,
  };
}

export function hashAuditIpAddress(ipAddress?: string | null): string | null {
  if (!ipAddress?.trim()) {
    return null;
  }

  return createHash("sha256").update(ipAddress.trim()).digest("hex");
}

export function sanitizeAuditMetadata(
  metadata?: Record<string, unknown> | null,
): Record<string, unknown> {
  if (!metadata || !isPlainObject(metadata)) {
    return {};
  }

  return sanitizeAuditValue(metadata) as Record<string, unknown>;
}

export async function recordAuditLogWithClient(
  client: PoolClient,
  input: AuditLogInput,
): Promise<AuditLogView> {
  const result = await client.query<AuditLogRecord>(
    `
      INSERT INTO audit_logs (
        tenant_id,
        actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        trace_id,
        ip_hash,
        user_agent,
        metadata
      )
      VALUES (
        $1::uuid,
        $2::uuid,
        $3,
        $4,
        $5,
        $6,
        $7,
        $8,
        $9,
        $10,
        $11::jsonb
      )
      RETURNING
        id::text AS id,
        tenant_id::text AS tenant_id,
        actor_user_id::text AS actor_user_id,
        actor_type,
        action,
        resource_type,
        resource_id,
        request_id,
        trace_id,
        ip_hash,
        user_agent,
        metadata,
        created_at::text AS created_at
    `,
    [
      input.tenantId,
      input.actorUserId ?? null,
      input.actorType ?? "user",
      input.action.trim(),
      input.resourceType.trim(),
      input.resourceId?.trim() ?? null,
      input.requestId?.trim() ?? null,
      input.traceId?.trim() ?? null,
      input.ipHash?.trim() ?? null,
      input.userAgent?.trim() ?? null,
      JSON.stringify(sanitizeAuditMetadata(input.metadata)),
    ],
  );

  return mapAuditLog(result.rows[0]);
}

export async function recordAuditLog(
  input: AuditLogInput,
  pool: Pool = getSharedPgPool(),
): Promise<AuditLogView> {
  return withTenantTransaction(
    {
      tenantId: input.tenantId,
      userId: input.actorUserId ?? null,
    },
    async (client) => recordAuditLogWithClient(client, input),
    pool,
  );
}

export async function safeRecordAuditLog(
  input: AuditLogInput,
  options?: {
    onError?: (error: unknown) => void;
    pool?: Pool;
  },
): Promise<boolean> {
  try {
    await recordAuditLog(input, options?.pool);
    return true;
  } catch (error) {
    options?.onError?.(error);
    return false;
  }
}

export async function listAuditLogs(
  context: TenantDbContext,
  options?: AuditListOptions,
  pool: Pool = getSharedPgPool(),
): Promise<{
  items: AuditLogView[];
  page: number;
  pageSize: number;
}> {
  return withTenantTransaction(context, async (client) => {
    const pageSize = Math.max(1, Math.min(options?.limit ?? 20, 100));
    const page = Math.max(1, options?.page ?? 1);
    const offset = (page - 1) * pageSize;
    const result = await client.query<AuditLogRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          actor_user_id::text AS actor_user_id,
          actor_type,
          action,
          resource_type,
          resource_id,
          request_id,
          trace_id,
          ip_hash,
          user_agent,
          metadata,
          created_at::text AS created_at
        FROM audit_logs
        WHERE ($1::text IS NULL OR action = $1)
          AND ($2::text IS NULL OR resource_type = $2)
          AND ($3::text IS NULL OR resource_id = $3)
        ORDER BY created_at DESC, id DESC
        LIMIT $4::int
        OFFSET $5::int
      `,
      [
        options?.action?.trim() || null,
        options?.resourceType?.trim() || null,
        options?.resourceId?.trim() || null,
        pageSize,
        offset,
      ],
    );

    return {
      items: result.rows.map(mapAuditLog),
      page,
      pageSize,
    };
  }, pool);
}
