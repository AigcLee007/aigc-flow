import { randomUUID } from "node:crypto";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import {
  checksumGraph,
  compileGraph,
  type CompiledWorkflow,
  type FlowGraph,
  validateGraph,
  WorkflowGraphValidationError,
} from "@aigc-flow/workflow-core";
import type { Pool, PoolClient } from "pg";

type PgPool = Pool;

type FlowContext = {
  tenantId: string;
  userId: string | null;
};

type FlowRecord = {
  created_at: string;
  created_by: string | null;
  current_version_id: string | null;
  description: string | null;
  id: string;
  project_id: string;
  status: string;
  tenant_id: string;
  title: string;
  updated_at: string;
  updated_by: string | null;
};

type FlowVersionRecord = {
  changelog: string | null;
  checksum: string;
  compiled_graph_json: CompiledWorkflow;
  created_at: string;
  flow_id: string;
  graph_json: FlowGraph;
  id: string;
  published_at: string | null;
  published_by: string | null;
  tenant_id: string;
  version: number;
};

export type FlowView = {
  createdAt: string;
  createdBy: string | null;
  currentVersionId: string | null;
  description: string | null;
  id: string;
  projectId: string;
  status: string;
  tenantId: string;
  title: string;
  updatedAt: string;
  updatedBy: string | null;
};

export type FlowVersionView = {
  changelog: string | null;
  checksum: string;
  compiledGraph: CompiledWorkflow;
  createdAt: string;
  flowId: string;
  graph: FlowGraph;
  id: string;
  publishedAt: string | null;
  publishedBy: string | null;
  tenantId: string;
  version: number;
};

export class FlowsApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "FlowsApiError";
    this.statusCode = statusCode;
  }
}

function mapFlow(row: FlowRecord): FlowView {
  return {
    createdAt: row.created_at,
    createdBy: row.created_by,
    currentVersionId: row.current_version_id,
    description: row.description,
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    tenantId: row.tenant_id,
    title: row.title,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  };
}

function mapFlowVersion(row: FlowVersionRecord): FlowVersionView {
  return {
    changelog: row.changelog,
    checksum: row.checksum,
    compiledGraph: row.compiled_graph_json,
    createdAt: row.created_at,
    flowId: row.flow_id,
    graph: row.graph_json,
    id: row.id,
    publishedAt: row.published_at,
    publishedBy: row.published_by,
    tenantId: row.tenant_id,
    version: row.version,
  };
}

function mapWorkflowError(error: unknown): never {
  if (error instanceof WorkflowGraphValidationError) {
    throw new FlowsApiError(400, "INVALID_GRAPH", error.message);
  }

  throw error;
}

export class FlowsService {
  readonly pool: PgPool;

  constructor(options?: { pool?: PgPool }) {
    this.pool = options?.pool ?? createPgPool();
  }

  async listFlows(context: FlowContext, projectId: string): Promise<FlowView[]> {
    return withTenantTransaction(context, async (client) => {
      await this.getProjectOrThrow(client, projectId);

      const result = await client.query<FlowRecord>(
        `
          SELECT
            flows.id::text AS id,
            flows.tenant_id::text AS tenant_id,
            flows.project_id::text AS project_id,
            flows.title,
            flows.description,
            flows.status,
            flows.current_version_id::text AS current_version_id,
            flows.created_by::text AS created_by,
            flows.updated_by::text AS updated_by,
            flows.created_at::text AS created_at,
            flows.updated_at::text AS updated_at
          FROM flows
          JOIN projects
            ON projects.id = flows.project_id
          WHERE flows.project_id = $1::uuid
            AND flows.deleted_at IS NULL
            AND projects.deleted_at IS NULL
          ORDER BY flows.updated_at DESC, flows.id ASC
        `,
        [projectId],
      );

      return result.rows.map(mapFlow);
    }, this.pool);
  }

  async createFlow(
    context: FlowContext,
    projectId: string,
    input: {
      description?: string | null;
      title: string;
    },
  ): Promise<FlowView> {
    return withTenantTransaction(context, async (client) => {
      await this.getProjectOrThrow(client, projectId);

      const result = await client.query<FlowRecord>(
        `
          INSERT INTO flows (
            tenant_id,
            project_id,
            title,
            description,
            status,
            created_by,
            updated_by,
            updated_at
          )
          VALUES ($1::uuid, $2::uuid, $3, $4, 'draft', $5::uuid, $5::uuid, now())
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            project_id::text AS project_id,
            title,
            description,
            status,
            current_version_id::text AS current_version_id,
            created_by::text AS created_by,
            updated_by::text AS updated_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          context.tenantId,
          projectId,
          input.title.trim(),
          input.description?.trim() ?? null,
          context.userId,
        ],
      );

      return mapFlow(result.rows[0]);
    }, this.pool);
  }

  async getFlow(context: FlowContext, flowId: string): Promise<FlowView> {
    return withTenantTransaction(context, async (client) => {
      return this.getFlowOrThrow(client, flowId);
    }, this.pool);
  }

  async updateFlow(
    context: FlowContext,
    flowId: string,
    input: {
      description?: string | null;
      title?: string;
    },
  ): Promise<FlowView> {
    return withTenantTransaction(context, async (client) => {
      const existing = await this.getFlowOrThrow(client, flowId);

      const updated = await client.query<FlowRecord>(
        `
          UPDATE flows
          SET
            title = $2,
            description = $3,
            updated_by = $4::uuid,
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            project_id::text AS project_id,
            title,
            description,
            status,
            current_version_id::text AS current_version_id,
            created_by::text AS created_by,
            updated_by::text AS updated_by,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          flowId,
          input.title?.trim() ?? existing.title,
          input.description !== undefined ? input.description?.trim() ?? null : existing.description,
          context.userId,
        ],
      );

      return mapFlow(updated.rows[0]);
    }, this.pool);
  }

  async publishFlow(
    context: FlowContext,
    flowId: string,
    input: {
      changelog?: string | null;
      graph: FlowGraph;
    },
  ): Promise<FlowVersionView> {
    try {
      validateGraph(input.graph);
      const compiledGraph = compileGraph(input.graph);
      const checksum = checksumGraph(input.graph);

      return await withTenantTransaction(context, async (client) => {
        const lockedFlow = await client.query<FlowRecord>(
          `
            SELECT
              flows.id::text AS id,
              flows.tenant_id::text AS tenant_id,
              flows.project_id::text AS project_id,
              flows.title,
              flows.description,
              flows.status,
              flows.current_version_id::text AS current_version_id,
              flows.created_by::text AS created_by,
              flows.updated_by::text AS updated_by,
              flows.created_at::text AS created_at,
              flows.updated_at::text AS updated_at
            FROM flows
            JOIN projects
              ON projects.id = flows.project_id
            WHERE flows.id = $1::uuid
              AND flows.deleted_at IS NULL
              AND projects.deleted_at IS NULL
            FOR UPDATE
          `,
          [flowId],
        );

        if (!lockedFlow.rows[0]) {
          throw new FlowsApiError(404, "FLOW_NOT_FOUND", "Flow not found");
        }

        const existingVersion = await client.query<FlowVersionRecord>(
          `
            SELECT
              id::text AS id,
              tenant_id::text AS tenant_id,
              flow_id::text AS flow_id,
              version,
              graph_json,
              compiled_graph_json,
              checksum,
              changelog,
              published_by::text AS published_by,
              published_at::text AS published_at,
              created_at::text AS created_at
            FROM flow_versions
            WHERE flow_id = $1::uuid
              AND checksum = $2
            LIMIT 1
          `,
          [flowId, checksum],
        );

        if (existingVersion.rows[0]) {
          await client.query(
            `
              UPDATE flows
              SET
                current_version_id = $2::uuid,
                status = 'published',
                updated_by = $3::uuid,
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [flowId, existingVersion.rows[0].id, context.userId],
          );

          return mapFlowVersion(existingVersion.rows[0]);
        }

        const nextVersionResult = await client.query<{ next_version: number }>(
          `
            SELECT COALESCE(MAX(version), 0) + 1 AS next_version
            FROM flow_versions
            WHERE flow_id = $1::uuid
          `,
          [flowId],
        );
        const nextVersion = Number(nextVersionResult.rows[0]?.next_version ?? 1);
        const flowVersionId = randomUUID();

        const inserted = await client.query<FlowVersionRecord>(
          `
            INSERT INTO flow_versions (
              id,
              tenant_id,
              flow_id,
              version,
              graph_json,
              compiled_graph_json,
              checksum,
              changelog,
              published_by,
              published_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4::int,
              $5::jsonb,
              $6::jsonb,
              $7,
              $8,
              $9::uuid,
              now()
            )
            RETURNING
              id::text AS id,
              tenant_id::text AS tenant_id,
              flow_id::text AS flow_id,
              version,
              graph_json,
              compiled_graph_json,
              checksum,
              changelog,
              published_by::text AS published_by,
              published_at::text AS published_at,
              created_at::text AS created_at
          `,
          [
            flowVersionId,
            context.tenantId,
            flowId,
            nextVersion,
            JSON.stringify(input.graph),
            JSON.stringify(compiledGraph),
            checksum,
            input.changelog?.trim() ?? null,
            context.userId,
          ],
        );

        await client.query(
          `
            UPDATE flows
            SET
              current_version_id = $2::uuid,
              status = 'published',
              updated_by = $3::uuid,
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [flowId, flowVersionId, context.userId],
        );

        return mapFlowVersion(inserted.rows[0]);
      }, this.pool);
    } catch (error) {
      mapWorkflowError(error);
    }
  }

  async listFlowVersions(context: FlowContext, flowId: string): Promise<FlowVersionView[]> {
    return withTenantTransaction(context, async (client) => {
      await this.getFlowOrThrow(client, flowId);

      const result = await client.query<FlowVersionRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            flow_id::text AS flow_id,
            version,
            graph_json,
            compiled_graph_json,
            checksum,
            changelog,
            published_by::text AS published_by,
            published_at::text AS published_at,
            created_at::text AS created_at
          FROM flow_versions
          WHERE flow_id = $1::uuid
          ORDER BY version DESC, created_at DESC
        `,
        [flowId],
      );

      return result.rows.map(mapFlowVersion);
    }, this.pool);
  }

  private async getProjectOrThrow(
    client: PoolClient,
    projectId: string,
  ): Promise<void> {
    const project = await client.query<{ id: string }>(
      `
        SELECT id::text AS id
        FROM projects
        WHERE id = $1::uuid
          AND deleted_at IS NULL
        LIMIT 1
      `,
      [projectId],
    );

    if (!project.rows[0]?.id) {
      throw new FlowsApiError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
  }

  private async getFlowOrThrow(
    client: PoolClient,
    flowId: string,
  ): Promise<FlowView> {
    const result = await client.query<FlowRecord>(
      `
        SELECT
          flows.id::text AS id,
          flows.tenant_id::text AS tenant_id,
          flows.project_id::text AS project_id,
          flows.title,
          flows.description,
          flows.status,
          flows.current_version_id::text AS current_version_id,
          flows.created_by::text AS created_by,
          flows.updated_by::text AS updated_by,
          flows.created_at::text AS created_at,
          flows.updated_at::text AS updated_at
        FROM flows
        JOIN projects
          ON projects.id = flows.project_id
        WHERE flows.id = $1::uuid
          AND flows.deleted_at IS NULL
          AND projects.deleted_at IS NULL
        LIMIT 1
      `,
      [flowId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new FlowsApiError(404, "FLOW_NOT_FOUND", "Flow not found");
    }

    return mapFlow(row);
  }
}
