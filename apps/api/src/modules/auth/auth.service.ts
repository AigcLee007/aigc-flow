import { createHash, randomUUID } from "node:crypto";

import { createPgPool, safeRecordAuditLog, withTenantTransaction } from "@aigc-flow/db";
import type { Pool, PoolClient } from "pg";

import type { ApiEnv } from "../../config/env.js";
import type { RequestContext } from "../../http/request-context.js";
import type {
  LoginInput,
  RefreshInput,
  RegisterInput,
} from "./auth.schemas.js";
import { hashPassword, verifyPassword } from "./password.js";
import {
  type ResolvedPermissions,
  resolvePermissionsForTenant,
} from "./permission-resolver.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  signAccessToken,
  verifyAccessToken,
} from "./token.js";

type PgPool = Pool;
type PgClient = PoolClient;

type AuthenticatedIdentity = {
  permissions: string[];
  roles: string[];
  sessionId: string;
  tenantId: string | null;
  userId: string;
};

type PublicTenant = {
  id: string;
  name: string;
  plan: string;
  slug: string;
  status: string;
};

type PublicUser = {
  displayName: string | null;
  email: string;
  id: string;
  status: string;
};

type SessionMetadata = {
  ipAddress?: string | null;
  ipHash?: string | null;
  requestId?: string | null;
  traceId?: string | null;
  userAgent?: string | null;
};

type TenantMembershipSummary = PublicTenant & {
  roleKey: string;
};

export class AuthApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AuthApiError";
    this.statusCode = statusCode;
  }
}

function buildTenantSlug(name: string): string {
  const slugBase = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  const suffix = randomUUID().slice(0, 8);
  return `${slugBase || "tenant"}-${suffix}`;
}

function getDefaultTenantName(input: RegisterInput): string {
  if (input.tenantName?.trim()) {
    return input.tenantName.trim();
  }

  if (input.displayName?.trim()) {
    return `${input.displayName.trim()}'s Workspace`;
  }

  const localPart = input.email.split("@")[0]?.trim() || "workspace";
  return `${localPart}'s Workspace`;
}

function hashIpAddress(ipAddress?: string | null): string | null {
  if (!ipAddress?.trim()) {
    return null;
  }

  return createHash("sha256").update(ipAddress.trim()).digest("hex");
}

function mapUser(row: {
  display_name: string | null;
  email: string;
  id: string;
  status: string;
}): PublicUser {
  return {
    displayName: row.display_name,
    email: row.email,
    id: row.id,
    status: row.status,
  };
}

function mapTenant(row: {
  id: string;
  name: string;
  plan: string;
  slug: string;
  status: string;
}): PublicTenant {
  return {
    id: row.id,
    name: row.name,
    plan: row.plan,
    slug: row.slug,
    status: row.status,
  };
}

async function withAuthContextTransaction<T>(
  pool: PgPool,
  context: {
    tenantId?: string | null;
    userId?: string | null;
  },
  run: (client: PgClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      context.tenantId ?? "",
    ]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      context.userId ?? "",
    ]);
    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export class AuthService {
  readonly env: ApiEnv;
  readonly pool: PgPool;

  constructor(options: { env: ApiEnv; pool?: PgPool }) {
    this.env = options.env;
    this.pool = options.pool ?? createPgPool();
  }

  async authenticateAccessToken(token: string): Promise<AuthenticatedIdentity | null> {
    const payload = await verifyAccessToken(token, this.env);
    if (!payload) {
      return null;
    }

    const result = await this.pool.query<{
      session_id: string;
      tenant_id: string | null;
      user_id: string;
    }>(
      `
        SELECT
          auth_sessions.id::text AS session_id,
          auth_sessions.tenant_id::text AS tenant_id,
          auth_sessions.user_id::text AS user_id
        FROM auth_sessions
        JOIN users
          ON users.id = auth_sessions.user_id
        WHERE auth_sessions.id = $1::uuid
          AND auth_sessions.user_id = $2::uuid
          AND auth_sessions.status = 'active'
          AND auth_sessions.revoked_at IS NULL
          AND auth_sessions.expires_at > now()
          AND users.status = 'active'
      `,
      [payload.session_id, payload.sub],
    );

    const session = result.rows[0];
    if (!session) {
      return null;
    }

    if ((session.tenant_id ?? null) !== (payload.tenant_id ?? null)) {
      return null;
    }

    const resolved = await resolvePermissionsForTenant(
      {
        tenantId: session.tenant_id,
        userId: session.user_id,
      },
      this.pool,
    );

    return {
      permissions: resolved.permissions,
      roles: resolved.roles,
      sessionId: session.session_id,
      tenantId: session.tenant_id,
      userId: session.user_id,
    };
  }

  async register(input: RegisterInput, metadata: SessionMetadata) {
    const userId = randomUUID();
    const tenantId = randomUUID();
    const sessionId = randomUUID();
    const refreshTokenId = randomUUID();
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const passwordHash = await hashPassword(input.password);
    const tenantName = getDefaultTenantName(input);
    const tenantSlug = buildTenantSlug(tenantName);

    try {
      const result = await withTenantTransaction(
        { tenantId, userId },
        async (client) => {
          const user = await client.query<{
            display_name: string | null;
            email: string;
            id: string;
            status: string;
          }>(
            `
              INSERT INTO users (id, email, display_name, password_hash, updated_at)
              VALUES ($1::uuid, $2, $3, $4, now())
              RETURNING id::text AS id, email, display_name, status
            `,
            [userId, input.email, input.displayName?.trim() ?? null, passwordHash],
          );

          const tenant = await client.query<{
            id: string;
            name: string;
            plan: string;
            slug: string;
            status: string;
          }>(
            `
              INSERT INTO tenants (id, name, slug, updated_at)
              VALUES ($1::uuid, $2, $3, now())
              RETURNING id::text AS id, name, slug, plan, status
            `,
            [tenantId, tenantName, tenantSlug],
          );

          await client.query(
            `
              INSERT INTO tenant_memberships (
                tenant_id,
                user_id,
                role_key,
                status,
                joined_at,
                updated_at
              )
              VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
            `,
            [tenantId, userId],
          );

          await client.query(
            `
              INSERT INTO auth_sessions (
                id,
                user_id,
                tenant_id,
                status,
                user_agent,
                ip_hash,
                expires_at
              )
              VALUES ($1::uuid, $2::uuid, $3::uuid, 'active', $4, $5, now() + ($6 || ' seconds')::interval)
            `,
            [
              sessionId,
              userId,
              tenantId,
              metadata.userAgent ?? null,
              hashIpAddress(metadata.ipAddress),
              String(this.env.refreshTokenTtlSeconds),
            ],
          );

          await client.query(
            `
              INSERT INTO refresh_tokens (
                id,
                session_id,
                user_id,
                token_hash,
                expires_at
              )
              VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + ($5 || ' seconds')::interval)
            `,
            [
              refreshTokenId,
              sessionId,
              userId,
              refreshTokenHash,
              String(this.env.refreshTokenTtlSeconds),
            ],
          );

          return {
            currentTenant: mapTenant(tenant.rows[0]),
            user: mapUser(user.rows[0]),
          };
        },
        this.pool,
      );

      const response = {
        accessToken: await signAccessToken(
          {
            sessionId,
            tenantId,
            userId,
          },
          this.env,
        ),
        currentTenant: result.currentTenant,
        refreshToken,
        user: result.user,
      };

      await safeRecordAuditLog(
        {
          action: "auth.register",
          actorType: "user",
          actorUserId: result.user.id,
          ipHash: metadata.ipHash ?? hashIpAddress(metadata.ipAddress),
          metadata: {
            sessionId,
            tenantId: result.currentTenant.id,
          },
          requestId: metadata.requestId,
          resourceId: result.user.id,
          resourceType: "user",
          tenantId: result.currentTenant.id,
          traceId: metadata.traceId,
          userAgent: metadata.userAgent ?? null,
        },
        {
          pool: this.pool,
        },
      );

      return response;
    } catch (error) {
      this.rethrowKnownDatabaseError(error, "Unable to register user");
    }
  }

  async login(input: LoginInput, metadata: SessionMetadata) {
    const userResult = await this.pool.query<{
      display_name: string | null;
      email: string;
      id: string;
      password_hash: string | null;
      status: string;
    }>(
      `
        SELECT
          id::text AS id,
          email,
          display_name,
          password_hash,
          status
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [input.email],
    );

    const user = userResult.rows[0];
    if (!user?.password_hash || user.status !== "active") {
      throw new AuthApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const passwordMatches = await verifyPassword(user.password_hash, input.password);
    if (!passwordMatches) {
      throw new AuthApiError(401, "INVALID_CREDENTIALS", "Invalid email or password");
    }

    const memberships = await this.listActiveTenantsForUser(user.id);
    if (memberships.length === 0) {
      throw new AuthApiError(403, "TENANT_ACCESS_REQUIRED", "No active tenant membership found");
    }

    const currentMembership =
      (input.tenantId
        ? memberships.find((membership) => membership.id === input.tenantId)
        : memberships[0]) ?? null;

    if (!currentMembership) {
      throw new AuthApiError(403, "TENANT_FORBIDDEN", "Tenant access denied");
    }

    const currentTenant: PublicTenant = {
      id: currentMembership.id,
      name: currentMembership.name,
      plan: currentMembership.plan,
      slug: currentMembership.slug,
      status: currentMembership.status,
    };

    const sessionId = randomUUID();
    const refreshTokenId = randomUUID();
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await withTenantTransaction(
      { tenantId: currentTenant.id, userId: user.id },
      async (client) => {
        await client.query(
          `
            UPDATE users
            SET last_login_at = now(), updated_at = now()
            WHERE id = $1::uuid
          `,
          [user.id],
        );

        await client.query(
          `
            INSERT INTO auth_sessions (
              id,
              user_id,
              tenant_id,
              status,
              user_agent,
              ip_hash,
              expires_at
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, 'active', $4, $5, now() + ($6 || ' seconds')::interval)
          `,
          [
            sessionId,
            user.id,
            currentTenant.id,
            metadata.userAgent ?? null,
            hashIpAddress(metadata.ipAddress),
            String(this.env.refreshTokenTtlSeconds),
          ],
        );

        await client.query(
          `
            INSERT INTO refresh_tokens (
              id,
              session_id,
              user_id,
              token_hash,
              expires_at
            )
            VALUES ($1::uuid, $2::uuid, $3::uuid, $4, now() + ($5 || ' seconds')::interval)
          `,
          [
            refreshTokenId,
            sessionId,
            user.id,
            refreshTokenHash,
            String(this.env.refreshTokenTtlSeconds),
          ],
        );
      },
      this.pool,
    );

    const resolved = await resolvePermissionsForTenant(
      {
        tenantId: currentTenant.id,
        userId: user.id,
      },
      this.pool,
    );

    const response = {
      accessToken: await signAccessToken(
        {
          sessionId,
          tenantId: currentTenant.id,
          userId: user.id,
        },
        this.env,
      ),
      currentTenant,
      permissions: resolved.permissions,
      refreshToken,
      user: mapUser(user),
    };

    await safeRecordAuditLog(
      {
        action: "auth.login",
        actorType: "user",
        actorUserId: user.id,
        ipHash: metadata.ipHash ?? hashIpAddress(metadata.ipAddress),
        metadata: {
          roleKey: currentMembership.roleKey,
          sessionId,
        },
        requestId: metadata.requestId,
        resourceId: sessionId,
        resourceType: "auth_session",
        tenantId: currentTenant.id,
        traceId: metadata.traceId,
        userAgent: metadata.userAgent ?? null,
      },
      {
        pool: this.pool,
      },
    );

    return response;
  }

  async refresh(input: RefreshInput) {
    const tokenHash = hashRefreshToken(input.refreshToken);
    const client = await this.pool.connect();

    try {
      await client.query("BEGIN");
      const existing = await client.query<{
        token_id: string;
        session_id: string;
        tenant_id: string | null;
        user_id: string;
      }>(
        `
          SELECT
            rt.id::text AS token_id,
            rt.session_id::text AS session_id,
            rt.user_id::text AS user_id,
            s.tenant_id::text AS tenant_id
          FROM refresh_tokens AS rt
          JOIN auth_sessions AS s
            ON s.id = rt.session_id
          JOIN users
            ON users.id = rt.user_id
          WHERE rt.token_hash = $1
            AND rt.revoked_at IS NULL
            AND rt.expires_at > now()
            AND s.status = 'active'
            AND s.revoked_at IS NULL
            AND s.expires_at > now()
            AND users.status = 'active'
          FOR UPDATE OF rt
        `,
        [tokenHash],
      );

      const row = existing.rows[0];
      if (!row) {
        throw new AuthApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");
      }

      const nextRefreshToken = generateRefreshToken();
      const nextRefreshTokenId = randomUUID();
      const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);

      const revoked = await client.query<{ id: string }>(
        `
          UPDATE refresh_tokens
          SET revoked_at = now()
          WHERE id = $1::uuid
            AND revoked_at IS NULL
          RETURNING id::text AS id
        `,
        [row.token_id],
      );
      if (!revoked.rows[0]?.id) {
        throw new AuthApiError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid");
      }

      await client.query(
        `
          INSERT INTO refresh_tokens (
            id,
            session_id,
            user_id,
            token_hash,
            rotated_from_token_id,
            expires_at
          )
          VALUES ($1::uuid, $2::uuid, $3::uuid, $4, $5::uuid, now() + ($6 || ' seconds')::interval)
        `,
        [
          nextRefreshTokenId,
          row.session_id,
          row.user_id,
          nextRefreshTokenHash,
          row.token_id,
          String(this.env.refreshTokenTtlSeconds),
        ],
      );

      await client.query("COMMIT");

      return {
        accessToken: await signAccessToken(
          {
            sessionId: row.session_id,
            tenantId: row.tenant_id,
            userId: row.user_id,
          },
          this.env,
        ),
        refreshToken: nextRefreshToken,
      };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      if (error instanceof AuthApiError) {
        throw error;
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async logout(input: { refreshToken?: string | null }, context: RequestContext) {
    const client = await this.pool.connect();
    let auditActorUserId = context.userId;
    let auditSessionId = context.sessionId;
    let auditTenantId = context.tenantId;

    try {
      await client.query("BEGIN");

      let sessionId = context.sessionId;
      if (input.refreshToken) {
        const tokenResult = await client.query<{
          session_id: string;
          tenant_id: string | null;
          user_id: string;
        }>(
          `
            SELECT
              refresh_tokens.session_id::text AS session_id,
              auth_sessions.tenant_id::text AS tenant_id,
              auth_sessions.user_id::text AS user_id
            FROM refresh_tokens
            JOIN auth_sessions
              ON auth_sessions.id = refresh_tokens.session_id
            WHERE token_hash = $1
            LIMIT 1
          `,
          [hashRefreshToken(input.refreshToken)],
        );
        sessionId = tokenResult.rows[0]?.session_id ?? sessionId;
        auditActorUserId = tokenResult.rows[0]?.user_id ?? auditActorUserId;
        auditSessionId = sessionId ?? auditSessionId;
        auditTenantId = tokenResult.rows[0]?.tenant_id ?? auditTenantId;

        await client.query(
          `
            UPDATE refresh_tokens
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE token_hash = $1
          `,
          [hashRefreshToken(input.refreshToken)],
        );
      }

      if (sessionId) {
        await client.query(
          `
            UPDATE auth_sessions
            SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
            WHERE id = $1::uuid
          `,
          [sessionId],
        );
        await client.query(
          `
            UPDATE refresh_tokens
            SET revoked_at = COALESCE(revoked_at, now())
            WHERE session_id = $1::uuid
          `,
          [sessionId],
        );
      }

      await client.query("COMMIT");
      if (auditTenantId) {
        await safeRecordAuditLog(
          {
            action: "auth.logout",
            actorType: auditActorUserId ? "user" : "system",
            actorUserId: auditActorUserId,
            ipHash: context.ipHash,
            metadata: {
              sessionId: auditSessionId ?? null,
            },
            requestId: context.requestId,
            resourceId: auditSessionId ?? null,
            resourceType: "auth_session",
            tenantId: auditTenantId,
            traceId: context.traceId,
            userAgent: context.userAgent,
          },
          {
            pool: this.pool,
          },
        );
      }
      return { ok: true as const };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async getMe(context: RequestContext) {
    if (!context.userId) {
      throw new AuthApiError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const userResult = await this.pool.query<{
      display_name: string | null;
      email: string;
      id: string;
      status: string;
    }>(
      `
        SELECT id::text AS id, email, display_name, status
        FROM users
        WHERE id = $1::uuid
          AND status = 'active'
        LIMIT 1
      `,
      [context.userId],
    );

    const user = userResult.rows[0];
    if (!user) {
      throw new AuthApiError(401, "UNAUTHORIZED", "Authentication is required");
    }

    const currentTenant = context.tenantId
      ? await withTenantTransaction(
          { tenantId: context.tenantId, userId: context.userId },
          async (client) => {
            const tenant = await client.query<{
              id: string;
              name: string;
              plan: string;
              slug: string;
              status: string;
            }>(
              `
                SELECT id::text AS id, name, slug, plan, status
                FROM tenants
                WHERE id = $1::uuid
                LIMIT 1
              `,
              [context.tenantId],
            );
            return tenant.rows[0] ? mapTenant(tenant.rows[0]) : null;
          },
          this.pool,
        )
      : null;

    return {
      currentTenant,
      permissions: context.permissions,
      roles: context.roles,
      sessionId: context.sessionId,
      user: mapUser(user),
    };
  }

  private async listActiveTenantsForUser(userId: string): Promise<TenantMembershipSummary[]> {
    return withAuthContextTransaction(
      this.pool,
      { tenantId: null, userId },
      async (client) => {
        const result = await client.query<{
          id: string;
          name: string;
          plan: string;
          role_key: string;
          slug: string;
          status: string;
        }>(
          `
            SELECT
              tenants.id::text AS id,
              tenants.name,
              tenants.slug,
              tenants.plan,
              tenants.status,
              tenant_memberships.role_key
            FROM tenant_memberships
            JOIN tenants
              ON tenants.id = tenant_memberships.tenant_id
            WHERE tenant_memberships.user_id = $1::uuid
              AND tenant_memberships.status = 'active'
              AND tenants.status = 'active'
            ORDER BY tenant_memberships.created_at ASC, tenants.id ASC
          `,
          [userId],
        );

        return result.rows.map((row) => ({
          ...mapTenant(row),
          roleKey: row.role_key,
        }));
      },
    );
  }

  private rethrowKnownDatabaseError(error: unknown, fallbackMessage: string): never {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    ) {
      throw new AuthApiError(409, "CONFLICT", "A record with the same unique value already exists");
    }

    if (error instanceof AuthApiError) {
      throw error;
    }

    throw new Error(fallbackMessage);
  }
}
