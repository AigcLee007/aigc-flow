import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test } from "vitest";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";

import type { ApiEnv } from "../src/config/env.js";
import { buildApp } from "../src/app.js";
import { hashPassword } from "../src/modules/auth/password.js";
import { runMigrations } from "../../../packages/db/src/migrator.js";
import { hasDatabaseEnv, withDatabase } from "../../../packages/db/test/helpers.js";

const originalDatabaseUrl = process.env.DATABASE_URL;
const describeWithDatabase = hasDatabaseEnv() ? describe : describe.skip;

const testEnv: ApiEnv = {
  accessTokenTtlSeconds: 60 * 15,
  credentialKeyVersion: "v1",
  credentialMasterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  jwtAccessSecret: "test_access_secret_1234567890",
  jwtRefreshSecret: "test_refresh_secret_1234567890",
  nodeEnv: "test",
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  s3AccessKeyId: "test-access",
  s3Bucket: "test-bucket",
  s3Endpoint: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Region: "us-east-1",
  s3SecretAccessKey: "test-secret",
};

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

function buildTestApp(pool: ReturnType<typeof createPgPool>) {
  return buildApp({
    env: testEnv,
    logger: false,
    pool,
  });
}

async function registerOwner(
  api: ReturnType<typeof buildTestApp>,
  email: string,
  tenantName: string,
) {
  const response = await api.inject({
    method: "POST",
    payload: {
      email,
      password: "StrongPass123!",
      tenantName,
    },
    url: "/api/v2/auth/register",
  });

  expect(response.statusCode).toBe(201);
  return response.json();
}

describeWithDatabase("projects and flows v2", () => {
  test("tenant_owner can create a project and viewer cannot", async () => {
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

        const owner = await registerOwner(api, "owner-projects@example.com", "Owner Projects");

        const createProject = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            description: "Project description",
            name: "Project Alpha",
          },
          url: "/api/v2/projects",
        });

        expect(createProject.statusCode).toBe(201);
        expect(createProject.json()).toMatchObject({
          description: "Project description",
          name: "Project Alpha",
          tenantId: owner.currentTenant.id,
        });

        const viewerUserId = randomUUID();
        const viewerPassword = "ViewerPass123!";
        const viewerPasswordHash = await hashPassword(viewerPassword);

        await withTenantTransaction(
          { tenantId: owner.currentTenant.id, userId: viewerUserId },
          async (client) => {
            await client.query(
              `
                INSERT INTO users (id, email, display_name, password_hash, updated_at)
                VALUES ($1::uuid, $2, $3, $4, now())
              `,
              [viewerUserId, "viewer-projects@example.com", "Viewer Projects", viewerPasswordHash],
            );
            await client.query(
              `
                INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
                VALUES ($1::uuid, $2::uuid, 'viewer', 'active', now(), now())
              `,
              [owner.currentTenant.id, viewerUserId],
            );
          },
          appPool,
        );

        const viewerLogin = await api.inject({
          method: "POST",
          payload: {
            email: "viewer-projects@example.com",
            password: viewerPassword,
          },
          url: "/api/v2/auth/login",
        });
        expect(viewerLogin.statusCode).toBe(200);

        const viewerCreate = await api.inject({
          headers: {
            authorization: `Bearer ${viewerLogin.json().accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Forbidden Project",
          },
          url: "/api/v2/projects",
        });
        expect(viewerCreate.statusCode).toBe(403);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("tenant_owner can create, publish, and version a flow without overwriting older versions", async () => {
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
        const owner = await registerOwner(api, "owner-flows@example.com", "Owner Flows");

        const project = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Compiler Project",
          },
          url: "/api/v2/projects",
        });
        expect(project.statusCode).toBe(201);
        const projectBody = project.json();

        const flow = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            description: "Draft flow",
            title: "My Flow",
          },
          url: `/api/v2/projects/${projectBody.id}/flows`,
        });
        expect(flow.statusCode).toBe(201);
        const flowBody = flow.json();

        const firstPublish = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            changelog: "first publish",
            graph: {
              edges: [{ source: "input", target: "output" }],
              nodes: [
                { id: "input", type: "input", data: { prompt: "hello" } },
                { id: "output", type: "output" },
              ],
            },
          },
          url: `/api/v2/flows/${flowBody.id}/publish`,
        });
        expect(firstPublish.statusCode).toBe(201);
        const firstVersion = firstPublish.json();
        expect(firstVersion.version).toBe(1);
        expect(firstVersion.compiledGraph.entryNodeIds).toEqual(["input"]);

        const invalidPublish = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            graph: {
              edges: [
                { source: "a", target: "b" },
                { source: "b", target: "a" },
              ],
              nodes: [
                { id: "a", type: "input" },
                { id: "b", type: "output" },
              ],
            },
          },
          url: `/api/v2/flows/${flowBody.id}/publish`,
        });
        expect(invalidPublish.statusCode).toBe(400);

        const secondPublish = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            changelog: "second publish",
            graph: {
              edges: [
                { source: "input", target: "transform" },
                { source: "transform", target: "output" },
              ],
              nodes: [
                { id: "input", type: "input", data: { prompt: "hello" } },
                { id: "transform", type: "transform", data: { mode: "uppercase" } },
                { id: "output", type: "output" },
              ],
            },
          },
          url: `/api/v2/flows/${flowBody.id}/publish`,
        });
        expect(secondPublish.statusCode).toBe(201);
        const secondVersion = secondPublish.json();
        expect(secondVersion.version).toBe(2);
        expect(secondVersion.id).not.toBe(firstVersion.id);

        const duplicateChecksumPublish = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            changelog: "same graph should reuse",
            graph: {
              edges: [
                { source: "input", target: "transform" },
                { source: "transform", target: "output" },
              ],
              nodes: [
                { id: "input", type: "input", data: { prompt: "hello" } },
                { id: "transform", type: "transform", data: { mode: "uppercase" } },
                { id: "output", type: "output" },
              ],
            },
          },
          url: `/api/v2/flows/${flowBody.id}/publish`,
        });
        expect(duplicateChecksumPublish.statusCode).toBe(201);
        expect(duplicateChecksumPublish.json().id).toBe(secondVersion.id);
        expect(duplicateChecksumPublish.json().version).toBe(2);

        const versions = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/flows/${flowBody.id}/versions`,
        });
        expect(versions.statusCode).toBe(200);
        expect(versions.json()).toMatchObject([
          { id: secondVersion.id, version: 2 },
          { id: firstVersion.id, version: 1 },
        ]);

        const versionCount = await adminPool.query<{ total: number }>(
          "SELECT COUNT(*)::int AS total FROM flow_versions WHERE flow_id = $1::uuid",
          [flowBody.id],
        );
        expect(versionCount.rows[0]?.total).toBe(2);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("tenant A cannot read tenant B projects, flows, or versions", async () => {
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

        const tenantAOwner = await registerOwner(api, "tenant-a-owner@example.com", "Tenant A");
        const tenantBOwner = await registerOwner(api, "tenant-b-owner@example.com", "Tenant B");

        const projectB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Tenant B Project",
          },
          url: "/api/v2/projects",
        });
        expect(projectB.statusCode).toBe(201);
        const projectBBody = projectB.json();

        const flowB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            title: "Tenant B Flow",
          },
          url: `/api/v2/projects/${projectBBody.id}/flows`,
        });
        expect(flowB.statusCode).toBe(201);
        const flowBBody = flowB.json();

        const publishB = await api.inject({
          headers: {
            authorization: `Bearer ${tenantBOwner.accessToken}`,
          },
          method: "POST",
          payload: {
            graph: {
              edges: [],
              nodes: [{ id: "only", type: "output" }],
            },
          },
          url: `/api/v2/flows/${flowBBody.id}/publish`,
        });
        expect(publishB.statusCode).toBe(201);

        const listProjectsA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: "/api/v2/projects",
        });
        expect(listProjectsA.statusCode).toBe(200);
        expect(listProjectsA.json()).toEqual([]);

        const getProjectBFromA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/projects/${projectBBody.id}`,
        });
        expect(getProjectBFromA.statusCode).toBe(404);

        const getFlowBFromA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/flows/${flowBBody.id}`,
        });
        expect(getFlowBFromA.statusCode).toBe(404);

        const getVersionsFromA = await api.inject({
          headers: {
            authorization: `Bearer ${tenantAOwner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/flows/${flowBBody.id}/versions`,
        });
        expect(getVersionsFromA.statusCode).toBe(404);

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
