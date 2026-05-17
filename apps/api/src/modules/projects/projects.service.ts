import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type { Pool } from "pg";

type PgPool = Pool;

type ProjectRecord = {
  created_at: string;
  created_by: string | null;
  description: string | null;
  id: string;
  name: string;
  tenant_id: string;
  updated_at: string;
};

export type ProjectView = {
  createdAt: string;
  createdBy: string | null;
  description: string | null;
  id: string;
  name: string;
  tenantId: string;
  updatedAt: string;
};

export type ProjectContext = {
  tenantId: string;
  userId: string | null;
};

export class ProjectsApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "ProjectsApiError";
    this.statusCode = statusCode;
  }
}

function mapProject(row: ProjectRecord): ProjectView {
  return {
    createdAt: row.created_at,
    createdBy: row.created_by,
    description: row.description,
    id: row.id,
    name: row.name,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
  };
}

export class ProjectsService {
  readonly pool: PgPool;

  constructor(options?: { pool?: PgPool }) {
    this.pool = options?.pool ?? createPgPool();
  }

  async listProjects(context: ProjectContext): Promise<ProjectView[]> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<ProjectRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            name,
            description,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM projects
          WHERE deleted_at IS NULL
          ORDER BY created_at ASC, id ASC
        `,
      );

      return result.rows.map(mapProject);
    }, this.pool);
  }

  async createProject(
    context: ProjectContext,
    input: {
      description?: string | null;
      name: string;
    },
  ): Promise<ProjectView> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<ProjectRecord>(
        `
          INSERT INTO projects (
            tenant_id,
            name,
            description,
            created_by,
            updated_at
          )
          VALUES ($1::uuid, $2, $3, $4::uuid, now())
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            name,
            description,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          context.tenantId,
          input.name.trim(),
          input.description?.trim() ?? null,
          context.userId,
        ],
      );

      return mapProject(result.rows[0]);
    }, this.pool);
  }

  async getProject(context: ProjectContext, projectId: string): Promise<ProjectView> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<ProjectRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            name,
            description,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM projects
          WHERE id = $1::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [projectId],
      );

      const row = result.rows[0];
      if (!row) {
        throw new ProjectsApiError(404, "PROJECT_NOT_FOUND", "Project not found");
      }

      return mapProject(row);
    }, this.pool);
  }

  async updateProject(
    context: ProjectContext,
    projectId: string,
    input: {
      description?: string | null;
      name?: string;
    },
  ): Promise<ProjectView> {
    return withTenantTransaction(context, async (client) => {
      const existing = await client.query<ProjectRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            name,
            description,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM projects
          WHERE id = $1::uuid
            AND deleted_at IS NULL
          LIMIT 1
        `,
        [projectId],
      );

      const row = existing.rows[0];
      if (!row) {
        throw new ProjectsApiError(404, "PROJECT_NOT_FOUND", "Project not found");
      }

      const updated = await client.query<ProjectRecord>(
        `
          UPDATE projects
          SET
            name = $2,
            description = $3,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            name,
            description,
            created_by::text AS created_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          projectId,
          input.name?.trim() ?? row.name,
          input.description !== undefined ? input.description?.trim() ?? null : row.description,
        ],
      );

      return mapProject(updated.rows[0]);
    }, this.pool);
  }

  async deleteProject(context: ProjectContext, projectId: string): Promise<{ ok: true }> {
    return withTenantTransaction(context, async (client) => {
      const deleted = await client.query<{ id: string }>(
        `
          UPDATE projects
          SET deleted_at = now(), updated_at = now()
          WHERE id = $1::uuid
            AND deleted_at IS NULL
          RETURNING id::text AS id
        `,
        [projectId],
      );

      if (!deleted.rows[0]?.id) {
        throw new ProjectsApiError(404, "PROJECT_NOT_FOUND", "Project not found");
      }

      return { ok: true as const };
    }, this.pool);
  }
}
