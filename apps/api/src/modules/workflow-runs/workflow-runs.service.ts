import { randomUUID } from "node:crypto";

import { createPgPool, safeRecordAuditLog, withTenantTransaction } from "@aigc-flow/db";
import {
  QUEUE_NAMES,
  assertLightweightJobPayload,
  type NodeExecuteJobPayload,
} from "@aigc-flow/redis";
import type { CompiledWorkflow } from "@aigc-flow/workflow-core";
import type { Pool, PoolClient } from "pg";

type PgPool = Pool;

type WorkflowRunContext = {
  ipHash?: string | null;
  requestId?: string | null;
  tenantId: string;
  traceId?: string | null;
  userAgent?: string | null;
  userId: string | null;
};

type NodeExecuteQueueLike = {
  add: (name: string, data: NodeExecuteJobPayload) => Promise<unknown>;
};

type FlowRuntimeRecord = {
  compiled_graph_json: CompiledWorkflow;
  current_version_id: string | null;
  flow_id: string;
  flow_status: string;
};

type WorkflowRunRecord = {
  canceled_at: string | null;
  created_at: string;
  created_by: string | null;
  error_json: Record<string, unknown> | null;
  finished_at: string | null;
  flow_id: string;
  flow_version_id: string;
  id: string;
  idempotency_key: string | null;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
  started_at: string | null;
  status: string;
  tenant_id: string;
  updated_at: string;
};

type NodeRunRecord = {
  attempt: number;
  cost_json: Record<string, unknown>;
  created_at: string;
  error_json: Record<string, unknown> | null;
  finished_at: string | null;
  id: string;
  input_json: Record<string, unknown>;
  max_attempts: number;
  node_id: string;
  node_type: string;
  output_json: Record<string, unknown> | null;
  provider_task_id: string | null;
  started_at: string | null;
  status: string;
  tenant_id: string;
  updated_at: string;
  workflow_run_id: string;
};

type WorkflowRunEventRecord = {
  created_at: string;
  event_type: string;
  id: string;
  node_run_id: string | null;
  payload: Record<string, unknown>;
  sequence: number;
  tenant_id: string;
  workflow_run_id: string;
};

export type WorkflowRunView = {
  canceledAt: string | null;
  createdAt: string;
  createdBy: string | null;
  errorJson: Record<string, unknown> | null;
  finishedAt: string | null;
  flowId: string;
  flowVersionId: string;
  id: string;
  idempotencyKey: string | null;
  inputJson: Record<string, unknown>;
  outputJson: Record<string, unknown> | null;
  startedAt: string | null;
  status: string;
  tenantId: string;
  updatedAt: string;
};

export type WorkflowRunStatusView = Pick<
  WorkflowRunView,
  "canceledAt" | "finishedAt" | "id" | "status" | "tenantId"
>;

export type NodeRunView = {
  attempt: number;
  costJson: Record<string, unknown>;
  createdAt: string;
  errorJson: Record<string, unknown> | null;
  finishedAt: string | null;
  id: string;
  inputJson: Record<string, unknown>;
  maxAttempts: number;
  nodeId: string;
  nodeType: string;
  outputJson: Record<string, unknown> | null;
  providerTaskId: string | null;
  startedAt: string | null;
  status: string;
  tenantId: string;
  updatedAt: string;
  workflowRunId: string;
};

export type WorkflowRunEventView = {
  createdAt: string;
  eventType: string;
  id: string;
  nodeRunId: string | null;
  payload: Record<string, unknown>;
  sequence: number;
  tenantId: string;
  workflowRunId: string;
};

export class WorkflowRunsApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "WorkflowRunsApiError";
    this.statusCode = statusCode;
  }
}

function mapWorkflowRun(row: WorkflowRunRecord): WorkflowRunView {
  return {
    canceledAt: row.canceled_at,
    createdAt: row.created_at,
    createdBy: row.created_by,
    errorJson: row.error_json,
    finishedAt: row.finished_at,
    flowId: row.flow_id,
    flowVersionId: row.flow_version_id,
    id: row.id,
    idempotencyKey: row.idempotency_key,
    inputJson: row.input_json ?? {},
    outputJson: row.output_json,
    startedAt: row.started_at,
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
  };
}

function mapNodeRun(row: NodeRunRecord): NodeRunView {
  return {
    attempt: row.attempt,
    costJson: row.cost_json ?? {},
    createdAt: row.created_at,
    errorJson: row.error_json,
    finishedAt: row.finished_at,
    id: row.id,
    inputJson: row.input_json ?? {},
    maxAttempts: row.max_attempts,
    nodeId: row.node_id,
    nodeType: row.node_type,
    outputJson: row.output_json,
    providerTaskId: row.provider_task_id,
    startedAt: row.started_at,
    status: row.status,
    tenantId: row.tenant_id,
    updatedAt: row.updated_at,
    workflowRunId: row.workflow_run_id,
  };
}

function mapWorkflowRunEvent(row: WorkflowRunEventRecord): WorkflowRunEventView {
  return {
    createdAt: row.created_at,
    eventType: row.event_type,
    id: row.id,
    nodeRunId: row.node_run_id,
    payload: row.payload ?? {},
    sequence: row.sequence,
    tenantId: row.tenant_id,
    workflowRunId: row.workflow_run_id,
  };
}

function isTerminalRunStatus(status: string): boolean {
  return status === "failed" || status === "canceled" || status === "succeeded";
}

export class WorkflowRunsService {
  readonly nodeExecuteQueue: NodeExecuteQueueLike;
  readonly pool: PgPool;

  constructor(options: {
    nodeExecuteQueue: NodeExecuteQueueLike;
    pool?: PgPool;
  }) {
    this.nodeExecuteQueue = options.nodeExecuteQueue;
    this.pool = options.pool ?? createPgPool();
  }

  async createWorkflowRun(
    context: WorkflowRunContext,
    flowId: string,
    input: {
      idempotencyKey?: string;
      input?: Record<string, unknown>;
    },
  ): Promise<{
    runId: string;
    status: string;
  }> {
    const payloadsToEnqueue: NodeExecuteJobPayload[] = [];

    const createdRun = await withTenantTransaction(context, async (client) => {
      const runtimeFlow = await this.getCurrentFlowRuntimeOrThrow(client, flowId);
      if (!runtimeFlow.current_version_id) {
        throw new WorkflowRunsApiError(400, "FLOW_NOT_PUBLISHED", "Flow does not have a published version");
      }

      if (input.idempotencyKey) {
        const existing = await client.query<WorkflowRunRecord>(
          `
            SELECT
              id::text AS id,
              tenant_id::text AS tenant_id,
              flow_id::text AS flow_id,
              flow_version_id::text AS flow_version_id,
              status,
              input_json,
              output_json,
              error_json,
              idempotency_key,
              created_by::text AS created_by,
              started_at::text AS started_at,
              finished_at::text AS finished_at,
              canceled_at::text AS canceled_at,
              created_at::text AS created_at,
              updated_at::text AS updated_at
            FROM workflow_runs
            WHERE tenant_id = $1::uuid
              AND idempotency_key = $2
            LIMIT 1
          `,
          [context.tenantId, input.idempotencyKey],
        );

        if (existing.rows[0]) {
          return mapWorkflowRun(existing.rows[0]);
        }
      }

      const runId = randomUUID();
      const runInsert = await client.query<WorkflowRunRecord>(
        `
          INSERT INTO workflow_runs (
            id,
            tenant_id,
            flow_id,
            flow_version_id,
            status,
            input_json,
            idempotency_key,
            created_by,
            updated_at
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            'pending',
            $5::jsonb,
            $6,
            $7::uuid,
            now()
          )
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            flow_id::text AS flow_id,
            flow_version_id::text AS flow_version_id,
            status,
            input_json,
            output_json,
            error_json,
            idempotency_key,
            created_by::text AS created_by,
            started_at::text AS started_at,
            finished_at::text AS finished_at,
            canceled_at::text AS canceled_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          runId,
          context.tenantId,
          runtimeFlow.flow_id,
          runtimeFlow.current_version_id,
          JSON.stringify(input.input ?? {}),
          input.idempotencyKey ?? null,
          context.userId,
        ],
      );

      const run = mapWorkflowRun(runInsert.rows[0]);

      await this.appendWorkflowRunEvent(client, {
        eventType: "workflow.run.created",
        payload: {
          flowId: runtimeFlow.flow_id,
          flowVersionId: runtimeFlow.current_version_id,
          status: run.status,
        },
        tenantId: context.tenantId,
        workflowRunId: run.id,
      });

      for (const node of runtimeFlow.compiled_graph_json.nodes) {
        const isEntryNode = runtimeFlow.compiled_graph_json.entryNodeIds.includes(node.id);
        const nodeRunId = randomUUID();

        await client.query(
          `
            INSERT INTO node_runs (
              id,
              tenant_id,
              workflow_run_id,
              node_id,
              node_type,
              status,
              input_json,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4,
              $5,
              $6,
              $7::jsonb,
              now()
            )
          `,
          [
            nodeRunId,
            context.tenantId,
            run.id,
            node.id,
            node.type,
            isEntryNode ? "runnable" : "pending",
            JSON.stringify(node.config ?? {}),
          ],
        );

        if (isEntryNode) {
          await this.appendWorkflowRunEvent(client, {
            eventType: "node.run.runnable",
            nodeRunId,
            payload: {
              nodeId: node.id,
              nodeType: node.type,
              status: "runnable",
            },
            tenantId: context.tenantId,
            workflowRunId: run.id,
          });

          const queuePayload: NodeExecuteJobPayload = {
            nodeRunId,
            tenantId: context.tenantId,
            traceId: context.traceId ?? undefined,
            workflowRunId: run.id,
          };
          assertLightweightJobPayload(queuePayload);
          payloadsToEnqueue.push(queuePayload);
        }
      }

      return run;
    }, this.pool);

    for (const payload of payloadsToEnqueue) {
      await this.nodeExecuteQueue.add(QUEUE_NAMES.nodeExecute, payload);
    }

    await safeRecordAuditLog(
      {
        action: "workflow.run.create",
        actorType: context.userId ? "user" : "system",
        actorUserId: context.userId,
        ipHash: context.ipHash,
        metadata: {
          flowId,
          idempotencyKey: input.idempotencyKey ?? null,
          status: createdRun.status,
        },
        requestId: context.requestId,
        resourceId: createdRun.id,
        resourceType: "workflow_run",
        tenantId: context.tenantId,
        traceId: context.traceId,
        userAgent: context.userAgent,
      },
      {
        pool: this.pool,
      },
    );

    return {
      runId: createdRun.id,
      status: createdRun.status,
    };
  }

  async getWorkflowRun(
    context: WorkflowRunContext,
    runId: string,
  ): Promise<{
    nodeRuns: NodeRunView[];
    workflowRun: WorkflowRunView;
  }> {
    return withTenantTransaction(context, async (client) => {
      const workflowRun = await this.getWorkflowRunOrThrow(client, runId);
      const nodeRuns = await client.query<NodeRunRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            workflow_run_id::text AS workflow_run_id,
            node_id,
            node_type,
            status,
            attempt,
            max_attempts,
            input_json,
            output_json,
            error_json,
            provider_task_id,
            cost_json,
            started_at::text AS started_at,
            finished_at::text AS finished_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at
          FROM node_runs
          WHERE workflow_run_id = $1::uuid
          ORDER BY created_at ASC, id ASC
        `,
        [runId],
      );

      return {
        nodeRuns: nodeRuns.rows.map(mapNodeRun),
        workflowRun,
      };
    }, this.pool);
  }

  async listWorkflowRunEvents(
    context: WorkflowRunContext,
    runId: string,
    options?: {
      afterSequence?: number;
    },
  ): Promise<WorkflowRunEventView[]> {
    return withTenantTransaction(context, async (client) => {
      await this.getWorkflowRunOrThrow(client, runId);

      const result = await client.query<WorkflowRunEventRecord>(
        `
          SELECT
            id::text AS id,
            tenant_id::text AS tenant_id,
            workflow_run_id::text AS workflow_run_id,
            node_run_id::text AS node_run_id,
            event_type,
            sequence,
            payload,
            created_at::text AS created_at
          FROM workflow_run_events
          WHERE workflow_run_id = $1::uuid
            AND sequence > $2::int
          ORDER BY sequence ASC, id ASC
        `,
        [runId, options?.afterSequence ?? 0],
      );

      return result.rows.map(mapWorkflowRunEvent);
    }, this.pool);
  }

  async cancelWorkflowRun(
    context: WorkflowRunContext,
    runId: string,
  ): Promise<WorkflowRunView> {
    const result = await withTenantTransaction(context, async (client) => {
      const current = await this.getWorkflowRunOrThrow(client, runId, true);
      if (isTerminalRunStatus(current.status)) {
        return {
          didCancel: false,
          workflowRun: current,
        };
      }

      const updated = await client.query<WorkflowRunRecord>(
        `
          UPDATE workflow_runs
          SET
            status = 'canceled',
            canceled_at = now(),
            finished_at = COALESCE(finished_at, now()),
            updated_at = now()
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            flow_id::text AS flow_id,
            flow_version_id::text AS flow_version_id,
            status,
            input_json,
            output_json,
            error_json,
            idempotency_key,
            created_by::text AS created_by,
            started_at::text AS started_at,
            finished_at::text AS finished_at,
            canceled_at::text AS canceled_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [runId],
      );

      await this.appendWorkflowRunEvent(client, {
        eventType: "workflow.run.canceled",
        payload: {
          status: "canceled",
        },
        tenantId: context.tenantId,
        workflowRunId: runId,
      });

      return {
        didCancel: true,
        workflowRun: mapWorkflowRun(updated.rows[0]),
      };
    }, this.pool);

    if (result.didCancel) {
      await safeRecordAuditLog(
        {
          action: "workflow.run.cancel",
          actorType: context.userId ? "user" : "system",
          actorUserId: context.userId,
          ipHash: context.ipHash,
          metadata: {
            status: result.workflowRun.status,
          },
          requestId: context.requestId,
          resourceId: result.workflowRun.id,
          resourceType: "workflow_run",
          tenantId: context.tenantId,
          traceId: context.traceId,
          userAgent: context.userAgent,
        },
        {
          pool: this.pool,
        },
      );
    }

    return result.workflowRun;
  }

  async getWorkflowRunStatus(
    context: WorkflowRunContext,
    runId: string,
  ): Promise<WorkflowRunStatusView> {
    return withTenantTransaction(context, async (client) => {
      const workflowRun = await this.getWorkflowRunOrThrow(client, runId);
      return {
        canceledAt: workflowRun.canceledAt,
        finishedAt: workflowRun.finishedAt,
        id: workflowRun.id,
        status: workflowRun.status,
        tenantId: workflowRun.tenantId,
      };
    }, this.pool);
  }

  isTerminalWorkflowRunStatus(status: string): boolean {
    return isTerminalRunStatus(status);
  }

  private async appendWorkflowRunEvent(
    client: PoolClient,
    input: {
      eventType: string;
      nodeRunId?: string;
      payload: Record<string, unknown>;
      tenantId: string;
      workflowRunId: string;
    },
  ): Promise<void> {
    const sequenceResult = await client.query<{ next_sequence: number }>(
      `
        SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence
        FROM workflow_run_events
        WHERE workflow_run_id = $1::uuid
      `,
      [input.workflowRunId],
    );

    await client.query(
      `
        INSERT INTO workflow_run_events (
          tenant_id,
          workflow_run_id,
          node_run_id,
          event_type,
          sequence,
          payload
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4,
          $5::int,
          $6::jsonb
        )
      `,
      [
        input.tenantId,
        input.workflowRunId,
        input.nodeRunId ?? null,
        input.eventType,
        sequenceResult.rows[0]?.next_sequence ?? 1,
        JSON.stringify(input.payload),
      ],
    );
  }

  private async getCurrentFlowRuntimeOrThrow(
    client: PoolClient,
    flowId: string,
  ): Promise<FlowRuntimeRecord> {
    const result = await client.query<FlowRuntimeRecord>(
      `
        SELECT
          flows.id::text AS flow_id,
          flows.status AS flow_status,
          flows.current_version_id::text AS current_version_id,
          flow_versions.compiled_graph_json
        FROM flows
        LEFT JOIN flow_versions
          ON flow_versions.id = flows.current_version_id
        WHERE flows.id = $1::uuid
          AND flows.deleted_at IS NULL
        LIMIT 1
      `,
      [flowId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new WorkflowRunsApiError(404, "FLOW_NOT_FOUND", "Flow not found");
    }

    return row;
  }

  private async getWorkflowRunOrThrow(
    client: PoolClient,
    runId: string,
    forUpdate = false,
  ): Promise<WorkflowRunView> {
    const result = await client.query<WorkflowRunRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          flow_id::text AS flow_id,
          flow_version_id::text AS flow_version_id,
          status,
          input_json,
          output_json,
          error_json,
          idempotency_key,
          created_by::text AS created_by,
          started_at::text AS started_at,
          finished_at::text AS finished_at,
          canceled_at::text AS canceled_at,
          created_at::text AS created_at,
          updated_at::text AS updated_at
        FROM workflow_runs
        WHERE id = $1::uuid
        ${forUpdate ? "FOR UPDATE" : ""}
      `,
      [runId],
    );

    if (!result.rows[0]) {
      throw new WorkflowRunsApiError(404, "WORKFLOW_RUN_NOT_FOUND", "Workflow run not found");
    }

    return mapWorkflowRun(result.rows[0]);
  }
}
