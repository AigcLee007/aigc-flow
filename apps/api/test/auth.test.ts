import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";

import type { ApiEnv } from "../src/config/env.js";
import { requireAuth, requirePermission } from "../src/http/auth-middleware.js";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { resolvePermissionsForTenant } from "../src/modules/auth/permission-resolver.js";
import { hashRefreshToken } from "../src/modules/auth/token.js";
import { runMigrations } from "../../../packages/db/src/migrator.js";
import {
  hasDatabaseEnv,
  withDatabase,
} from "../../../packages/db/test/helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

const testEnv: ApiEnv = {
  accessTokenTtlSeconds: 60 * 15,
  jwtAccessSecret: "test_access_secret_1234567890",
  jwtRefreshSecret: "test_refresh_secret_1234567890",
  nodeEnv: "test",
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
};

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

function buildTestApp(pool: ReturnType<typeof createPgPool>) {
  const app = buildApp({
    env: testEnv,
    logger: false,
    pool,
  });

  app.get(
    "/api/v2/test/flow-update",
    {
      preHandler: [requireAuth, requirePermission("flow:update")],
    },
    async () => ({ ok: true }),
  );

  return app;
}

describeWithDatabase("auth v2", () => {
  test("register creates user, tenant, membership, session, and hashed refresh token", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        const response = await api.inject({
          method: "POST",
          payload: {
            displayName: "Alice",
            email: "alice@example.com",
            password: "StrongPass123!",
            tenantName: "Alice Tenant",
          },
          url: "/api/v2/auth/register",
        });

        expect(response.statusCode).toBe(201);
        const body = response.json();
        expect(body.user).toMatchObject({
          displayName: "Alice",
          email: "alice@example.com",
        });
        expect(body.user.password_hash).toBeUndefined();
        expect(body.currentTenant).toMatchObject({
          name: "Alice Tenant",
          status: "active",
        });
        expect(typeof body.accessToken).toBe("string");
        expect(typeof body.refreshToken).toBe("string");

        const userRecord = await adminPool.query<{
          password_hash: string;
          user_id: string;
        }>(
          `
            SELECT id::text AS user_id, password_hash
            FROM users
            WHERE email = $1
          `,
          ["alice@example.com"],
        );
        expect(userRecord.rows[0]?.password_hash).toBeTruthy();
        expect(userRecord.rows[0]?.password_hash).not.toBe("StrongPass123!");

        const membership = await adminPool.query<{ role_key: string }>(
          `
            SELECT role_key
            FROM tenant_memberships
            WHERE user_id = $1::uuid
          `,
          [userRecord.rows[0]?.user_id],
        );
        expect(membership.rows[0]?.role_key).toBe("tenant_owner");

        const refreshTokenRow = await adminPool.query<{ token_hash: string }>(
          `
            SELECT token_hash
            FROM refresh_tokens
            ORDER BY created_at DESC
            LIMIT 1
          `,
        );
        expect(refreshTokenRow.rows[0]?.token_hash).toBe(hashRefreshToken(body.refreshToken));
        expect(refreshTokenRow.rows[0]?.token_hash).not.toBe(body.refreshToken);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("login succeeds with the right password and rejects the wrong password", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        await api.inject({
          method: "POST",
          payload: {
            email: "login@example.com",
            password: "StrongPass123!",
            tenantName: "Login Tenant",
          },
          url: "/api/v2/auth/register",
        });

        const success = await api.inject({
          method: "POST",
          payload: {
            email: "login@example.com",
            password: "StrongPass123!",
          },
          url: "/api/v2/auth/login",
        });

        expect(success.statusCode).toBe(200);
        const successBody = success.json();
        expect(successBody.currentTenant).toMatchObject({
          name: "Login Tenant",
        });
        expect(successBody.permissions).toContain("flow:update");

        const failure = await api.inject({
          method: "POST",
          payload: {
            email: "login@example.com",
            password: "wrong-password",
          },
          url: "/api/v2/auth/login",
        });

        expect(failure.statusCode).toBe(401);
        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("refresh rotates the token and logout revokes the session", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        const register = await api.inject({
          method: "POST",
          payload: {
            email: "refresh@example.com",
            password: "StrongPass123!",
            tenantName: "Refresh Tenant",
          },
          url: "/api/v2/auth/register",
        });
        const registerBody = register.json();

        const refreshed = await api.inject({
          method: "POST",
          payload: {
            refreshToken: registerBody.refreshToken,
          },
          url: "/api/v2/auth/refresh",
        });

        expect(refreshed.statusCode).toBe(200);
        const refreshedBody = refreshed.json();
        expect(refreshedBody.refreshToken).not.toBe(registerBody.refreshToken);

        const oldToken = await adminPool.query<{ revoked: boolean }>(
          `
            SELECT revoked_at IS NOT NULL AS revoked
            FROM refresh_tokens
            WHERE token_hash = $1
          `,
          [hashRefreshToken(registerBody.refreshToken)],
        );
        expect(oldToken.rows[0]?.revoked).toBe(true);

        const reusedOldToken = await api.inject({
          method: "POST",
          payload: {
            refreshToken: registerBody.refreshToken,
          },
          url: "/api/v2/auth/refresh",
        });
        expect(reusedOldToken.statusCode).toBe(401);

        const logout = await api.inject({
          headers: {
            authorization: `Bearer ${refreshedBody.accessToken}`,
          },
          method: "POST",
          payload: {
            refreshToken: refreshedBody.refreshToken,
          },
          url: "/api/v2/auth/logout",
        });
        expect(logout.statusCode).toBe(200);

        const afterLogout = await api.inject({
          method: "POST",
          payload: {
            refreshToken: refreshedBody.refreshToken,
          },
          url: "/api/v2/auth/refresh",
        });
        expect(afterLogout.statusCode).toBe(401);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("concurrent refresh requests can consume the same refresh token at most once", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        const register = await api.inject({
          method: "POST",
          payload: {
            email: "refresh-race@example.com",
            password: "StrongPass123!",
            tenantName: "Refresh Race Tenant",
          },
          url: "/api/v2/auth/register",
        });
        expect(register.statusCode).toBe(201);
        const registerBody = register.json();
        const oldTokenHash = hashRefreshToken(registerBody.refreshToken);

        const results = await Promise.all([
          api.inject({
            method: "POST",
            payload: {
              refreshToken: registerBody.refreshToken,
            },
            url: "/api/v2/auth/refresh",
          }),
          api.inject({
            method: "POST",
            payload: {
              refreshToken: registerBody.refreshToken,
            },
            url: "/api/v2/auth/refresh",
          }),
        ]);

        const successResponses = results.filter((response) => response.statusCode === 200);
        const failedResponses = results.filter((response) => response.statusCode === 401);

        expect(successResponses).toHaveLength(1);
        expect(failedResponses).toHaveLength(1);

        const oldToken = await adminPool.query<{ id: string; revoked: boolean }>(
          `
            SELECT
              id::text AS id,
              revoked_at IS NOT NULL AS revoked
            FROM refresh_tokens
            WHERE token_hash = $1
          `,
          [oldTokenHash],
        );
        expect(oldToken.rows[0]?.revoked).toBe(true);

        const rotations = await adminPool.query<{ total: number }>(
          `
            SELECT COUNT(*)::int AS total
            FROM refresh_tokens
            WHERE rotated_from_token_id = $1::uuid
              AND revoked_at IS NULL
          `,
          [oldToken.rows[0]?.id],
        );
        expect(rotations.rows[0]?.total).toBe(1);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("me returns the authenticated user and tenant owner can pass flow:update guard", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        const anonymous = await api.inject({
          method: "GET",
          url: "/api/v2/auth/me",
        });
        expect(anonymous.statusCode).toBe(401);

        const register = await api.inject({
          method: "POST",
          payload: {
            displayName: "Owner User",
            email: "owner@example.com",
            password: "StrongPass123!",
            tenantName: "Owner Tenant",
          },
          url: "/api/v2/auth/register",
        });
        const registerBody = register.json();

        const me = await api.inject({
          headers: {
            authorization: `Bearer ${registerBody.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/auth/me",
        });

        expect(me.statusCode).toBe(200);
        const meBody = me.json();
        expect(meBody.user.email).toBe("owner@example.com");
        expect(meBody.currentTenant.name).toBe("Owner Tenant");
        expect(meBody.permissions).toContain("flow:update");
        expect(meBody.roles).toContain("tenant_owner");

        const protectedRoute = await api.inject({
          headers: {
            authorization: `Bearer ${registerBody.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/test/flow-update",
        });
        expect(protectedRoute.statusCode).toBe(200);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("viewer lacks flow:update and cannot resolve another tenant's permissions", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();
      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });
        const api = buildTestApp(appPool);

        const viewerUserId = randomUUID();
        const viewerTenantId = randomUUID();
        const viewerPassword = "ViewerPass123!";
        const viewerPasswordHash = await hashPassword(viewerPassword);

        await withTenantTransaction(
          { tenantId: viewerTenantId, userId: viewerUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [viewerUserId, "viewer@example.com", "Viewer User", viewerPasswordHash],
            );
            await client.query(
              "INSERT INTO tenants (id, name, slug, updated_at) VALUES ($1, $2, $3, now())",
              [viewerTenantId, "Viewer Tenant", "viewer-tenant"],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1, $2, 'viewer', 'active', now(), now())
              `,
              [viewerTenantId, viewerUserId],
            );
          },
          appPool,
        );

        const otherUserEmail = "other-owner@example.com";
        await api.inject({
          method: "POST",
          payload: {
            email: otherUserEmail,
            password: "OtherPass123!",
            tenantName: "Other Tenant",
          },
          url: "/api/v2/auth/register",
        });
        const otherTenant = await adminPool.query<{ id: string }>(
          "SELECT id::text AS id FROM tenants WHERE name = $1 ORDER BY created_at DESC LIMIT 1",
          ["Other Tenant"],
        );
        const actualOtherTenantId = otherTenant.rows[0]?.id;
        expect(actualOtherTenantId).toBeTruthy();

        const login = await api.inject({
          method: "POST",
          payload: {
            email: "viewer@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(login.statusCode).toBe(200);
        const loginBody = login.json();
        expect(loginBody.permissions).not.toContain("flow:update");

        const forbiddenRoute = await api.inject({
          headers: {
            authorization: `Bearer ${loginBody.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/test/flow-update",
        });
        expect(forbiddenRoute.statusCode).toBe(403);

        const crossTenantLogin = await api.inject({
          method: "POST",
          payload: {
            email: "viewer@example.com",
            password: viewerPassword,
            tenantId: actualOtherTenantId,
          },
          url: "/api/v2/auth/login",
        });
        expect(crossTenantLogin.statusCode).toBe(403);

        const ownPermissions = await resolvePermissionsForTenant(
          {
            tenantId: viewerTenantId,
            userId: viewerUserId,
          },
          appPool,
        );
        expect(ownPermissions.permissions).toContain("flow:read");
        expect(ownPermissions.permissions).not.toContain("flow:update");

        const crossTenantPermissions = await resolvePermissionsForTenant(
          {
            tenantId: actualOtherTenantId,
            userId: viewerUserId,
          },
          appPool,
        );
        expect(crossTenantPermissions).toEqual({
          permissions: [],
          roles: [],
        });

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
