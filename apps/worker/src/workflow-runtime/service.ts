import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import {
  type AiGatewayTextResult,
  type DatabaseTextGenerationRuntime,
  type TextGenerationRequest,
} from "@aigc-flow/ai-gateway-core";
import {
  QUEUE_NAMES,
  assertLightweightJobPayload,
  type NodeExecuteJobPayload,
} from "@aigc-flow/redis";
import type { CompiledWorkflow, CompiledWorkflowNode } from "@aigc-flow/workflow-core";
import type { Pool, PoolClient } from "pg";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "../processors/shared.js";

type WorkflowRunRecord = {
  error_json: Record<string, unknown> | null;
  flow_id: string;
  flow_version_id: string;
  id: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
  started_at: string | null;
  status: string;
  tenant_id: string;
};

type NodeRunRecord = {
  attempt: number;
  error_json: Record<string, unknown> | null;
  finished_at: string | null;
  id: string;
  input_json: Record<string, unknown>;
  node_id: string;
  node_type: string;
  output_json: Record<string, unknown> | null;
  started_at: string | null;
  status: string;
  workflow_run_id: string;
};

type WorkflowRunEventAppendInput = {
  eventType: string;
  nodeRunId?: string;
  payload: Record<string, unknown>;
  tenantId: string;
  workflowRunId: string;
};

type WorkflowExecutionContext = {
  tenantId: string;
  traceId: string | null;
  userId: string | null;
};

type TextGenerationRuntimeLike = Pick<DatabaseTextGenerationRuntime, "generateText">;

type NodeExecuteQueueLike = {
  add: (name: string, data: NodeExecuteJobPayload) => Promise<unknown>;
};

type RuntimeExecutionResult = {
  enqueuePayloads: NodeExecuteJobPayload[];
  errorToThrow?: Error;
  processorResult: ProcessorResult;
};

type RuntimeFlowRecord = {
  compiled_graph_json: CompiledWorkflow;
  flow_version_id: string;
  workflow_run_id: string;
};

function isTerminalStatus(status: string): boolean {
  return status === "failed" || status === "canceled" || status === "succeeded";
}

function normalizeError(error: unknown): {
  code: string;
  details?: unknown;
  message: string;
} {
  if (typeof error === "object" && error && "code" in error && "message" in error) {
    return {
      code: String(error.code),
      details: "details" in error ? (error as { details?: unknown }).details : undefined,
      message: String((error as { message: unknown }).message),
    };
  }

  if (error instanceof Error) {
    return {
      code: "WORKFLOW_NODE_FAILED",
      message: error.message,
    };
  }

  return {
    code: "WORKFLOW_NODE_FAILED",
    message: String(error),
  };
}

function buildTextMessages(
  upstreamOutputs: Array<Record<string, unknown> | null>,
  config: Record<string, unknown>,
): TextGenerationRequest {
  const messages: Array<{ content: string; role: "assistant" | "system" | "user" }> = [];
  if (typeof config.systemPrompt === "string" && config.systemPrompt.trim()) {
    messages.push({
      content: config.systemPrompt.trim(),
      role: "system",
    });
  }

  const upstreamText = upstreamOutputs
    .map((value) => {
      if (!value) {
        return "";
      }

      const directText = value.text;
      if (typeof directText === "string" && directText.trim()) {
        return directText.trim();
      }

      return JSON.stringify(value);
    })
    .filter(Boolean)
    .join("\n");

  const fallbackPrompt =
    typeof config.prompt === "string" && config.prompt.trim()
      ? config.prompt.trim()
      : "";

  const content = upstreamText || fallbackPrompt || JSON.stringify(upstreamOutputs);
  messages.push({
    content,
    role: "user",
  });

  return {
    maxTokens: typeof config.maxTokens === "number" ? config.maxTokens : null,
    messages,
    routeKey: typeof config.routeKey === "string" ? config.routeKey : null,
    temperature: typeof config.temperature === "number" ? config.temperature : null,
  };
}

function resolveInputNodeOutput(
  workflowInput: Record<string, unknown>,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const inputKey = typeof config.inputKey === "string" ? config.inputKey.trim() : "";
  if (inputKey && workflowInput[inputKey] !== undefined) {
    return {
      [inputKey]: workflowInput[inputKey],
    };
  }

  return workflowInput;
}

function resolveOutputNodeOutput(upstreamOutputs: Array<Record<string, unknown> | null>): Record<string, unknown> {
  if (upstreamOutputs.length === 1 && upstreamOutputs[0]) {
    return upstreamOutputs[0];
  }

  return {
    outputs: upstreamOutputs.filter((value) => value !== null),
  };
}

export class WorkflowNodeExecutionService {
  readonly nodeExecuteQueue: NodeExecuteQueueLike;
  readonly pool: Pool;
  readonly textGenerationRuntime: TextGenerationRuntimeLike;

  constructor(options: {
    nodeExecuteQueue: NodeExecuteQueueLike;
    pool?: Pool;
    textGenerationRuntime: TextGenerationRuntimeLike;
  }) {
    this.nodeExecuteQueue = options.nodeExecuteQueue;
    this.pool = options.pool ?? createPgPool();
    this.textGenerationRuntime = options.textGenerationRuntime;
  }

  async executeNode(
    input: NodeExecuteJobPayload,
    logger: WorkerLogger,
  ): Promise<ProcessorResult> {
    const execution = await this.executeNodeInTransaction(
      {
        tenantId: input.tenantId,
        traceId: input.traceId ?? null,
        userId: null,
      },
      input,
      logger,
    );

    for (const payload of execution.enqueuePayloads) {
      assertLightweightJobPayload(payload);
      await this.nodeExecuteQueue.add(QUEUE_NAMES.nodeExecute, payload);
    }

    if (execution.errorToThrow) {
      throw execution.errorToThrow;
    }

    return execution.processorResult;
  }

  private async executeNodeInTransaction(
    context: WorkflowExecutionContext,
    input: NodeExecuteJobPayload,
    logger: WorkerLogger,
  ): Promise<RuntimeExecutionResult> {
    return withTenantTransaction(context, async (client) => {
      const workflowRun = await this.lockWorkflowRun(client, input.workflowRunId);
      if (isTerminalStatus(workflowRun.status)) {
        return {
          enqueuePayloads: [],
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.nodeExecute,
            status: "no-op",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      }

      const runtimeFlow = await this.getRuntimeFlow(client, input.workflowRunId);
      const nodeRuns = await this.listNodeRuns(client, input.workflowRunId);
      const currentNodeRun = nodeRuns.find((nodeRun) => nodeRun.id === input.nodeRunId);

      if (!currentNodeRun) {
        throw new Error(`Node run not found: ${input.nodeRunId}`);
      }

      const currentNode = runtimeFlow.compiled_graph_json.nodes.find(
        (node) => node.id === currentNodeRun.node_id,
      );
      if (!currentNode) {
        throw new Error(`Compiled node not found: ${currentNodeRun.node_id}`);
      }

      if (isTerminalStatus(currentNodeRun.status) || currentNodeRun.status === "running") {
        return {
          enqueuePayloads: [],
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.nodeExecute,
            status: "no-op",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      }

      if (!this.areDependenciesSatisfied(currentNode, nodeRuns)) {
        return {
          enqueuePayloads: [],
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.nodeExecute,
            status: "no-op",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      }

      await this.markNodeRunRunning(client, currentNodeRun.id);
      await this.markWorkflowRunRunning(client, workflowRun.id);
      await this.appendWorkflowRunEvent(client, {
        eventType: "node.run.started",
        nodeRunId: currentNodeRun.id,
        payload: {
          attempt: currentNodeRun.attempt + 1,
          nodeId: currentNode.id,
          nodeType: currentNode.type,
          status: "running",
        },
        tenantId: input.tenantId,
        workflowRunId: workflowRun.id,
      });

      try {
        const upstreamOutputs = this.getDependencyOutputs(currentNode, nodeRuns);
        const outputJson = await this.executeNodeByType(
          currentNode,
          upstreamOutputs,
          workflowRun,
          currentNodeRun,
          context,
        );

        await client.query(
          `
            UPDATE node_runs
            SET
              status = 'succeeded',
              output_json = $2::jsonb,
              error_json = NULL,
              finished_at = now(),
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [currentNodeRun.id, JSON.stringify(outputJson)],
        );

        await this.appendWorkflowRunEvent(client, {
          eventType: "node.run.succeeded",
          nodeRunId: currentNodeRun.id,
          payload: {
            nodeId: currentNode.id,
            nodeType: currentNode.type,
            status: "succeeded",
          },
          tenantId: input.tenantId,
          workflowRunId: workflowRun.id,
        });

        const updatedNodeRuns = await this.listNodeRuns(client, workflowRun.id);
        const refreshedCurrent = updatedNodeRuns.find((row) => row.id === currentNodeRun.id) ?? {
          ...currentNodeRun,
          output_json: outputJson,
          status: "succeeded",
        };

        if (currentNode.type === "output") {
          await client.query(
            `
              UPDATE workflow_runs
              SET
                output_json = $2::jsonb,
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [workflowRun.id, JSON.stringify(refreshedCurrent.output_json ?? outputJson)],
          );
        }

        const enqueuePayloads: NodeExecuteJobPayload[] = [];
        const refreshedNodeRuns = await this.listNodeRuns(client, workflowRun.id);
        for (const dependentId of currentNode.dependents) {
          const dependentRun = refreshedNodeRuns.find((row) => row.node_id === dependentId);
          const dependentNode = runtimeFlow.compiled_graph_json.nodes.find((row) => row.id === dependentId);
          if (!dependentRun || !dependentNode || dependentRun.status !== "pending") {
            continue;
          }

          if (this.areDependenciesSatisfied(dependentNode, refreshedNodeRuns)) {
            await client.query(
              `
                UPDATE node_runs
                SET status = 'runnable', updated_at = now()
                WHERE id = $1::uuid
                  AND status = 'pending'
              `,
              [dependentRun.id],
            );
            await this.appendWorkflowRunEvent(client, {
              eventType: "node.run.runnable",
              nodeRunId: dependentRun.id,
              payload: {
                nodeId: dependentNode.id,
                nodeType: dependentNode.type,
                status: "runnable",
              },
              tenantId: input.tenantId,
              workflowRunId: workflowRun.id,
            });

            enqueuePayloads.push({
              nodeRunId: dependentRun.id,
              tenantId: input.tenantId,
              traceId: input.traceId ?? undefined,
              workflowRunId: workflowRun.id,
            });
          }
        }

        const finalNodeRuns = await this.listNodeRuns(client, workflowRun.id);
        if (finalNodeRuns.every((nodeRun) => nodeRun.status === "succeeded")) {
          await client.query(
            `
              UPDATE workflow_runs
              SET
                status = 'succeeded',
                finished_at = now(),
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [workflowRun.id],
          );
          await this.appendWorkflowRunEvent(client, {
            eventType: "workflow.run.succeeded",
            payload: {
              status: "succeeded",
            },
            tenantId: input.tenantId,
            workflowRunId: workflowRun.id,
          });
        }

        logger.info(
          {
            enqueuedNodeCount: enqueuePayloads.length,
            nodeRunId: currentNodeRun.id,
            workflowRunId: workflowRun.id,
          },
          "workflow node execution succeeded",
        );

        return {
          enqueuePayloads,
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.nodeExecute,
            status: "ok",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      } catch (error) {
        const normalized = normalizeError(error);
        await client.query(
          `
            UPDATE node_runs
            SET
              status = 'failed',
              error_json = $2::jsonb,
              finished_at = now(),
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [
            currentNodeRun.id,
            JSON.stringify(normalized),
          ],
        );
        await client.query(
          `
            UPDATE workflow_runs
            SET
              status = 'failed',
              error_json = $2::jsonb,
              finished_at = now(),
              updated_at = now()
            WHERE id = $1::uuid
          `,
          [
            workflowRun.id,
            JSON.stringify(normalized),
          ],
        );
        await this.appendWorkflowRunEvent(client, {
          eventType: "node.run.failed",
          nodeRunId: currentNodeRun.id,
          payload: normalized,
          tenantId: input.tenantId,
          workflowRunId: workflowRun.id,
        });
        await this.appendWorkflowRunEvent(client, {
          eventType: "workflow.run.failed",
          payload: normalized,
          tenantId: input.tenantId,
          workflowRunId: workflowRun.id,
        });

        return {
          enqueuePayloads: [],
          errorToThrow: error instanceof Error ? error : new Error(String(error)),
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.nodeExecute,
            status: "ok",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      }
    }, this.pool);
  }

  private areDependenciesSatisfied(
    node: CompiledWorkflowNode,
    nodeRuns: NodeRunRecord[],
  ): boolean {
    return node.dependencies.every((dependencyId) => {
      const dependencyRun = nodeRuns.find((row) => row.node_id === dependencyId);
      return dependencyRun?.status === "succeeded";
    });
  }

  private async appendWorkflowRunEvent(
    client: PoolClient,
    input: WorkflowRunEventAppendInput,
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

  private async executeNodeByType(
    node: CompiledWorkflowNode,
    upstreamOutputs: Array<Record<string, unknown> | null>,
    workflowRun: WorkflowRunRecord,
    nodeRun: NodeRunRecord,
    context: WorkflowExecutionContext,
  ): Promise<Record<string, unknown>> {
    if (node.type === "input") {
      return resolveInputNodeOutput(workflowRun.input_json ?? {}, node.config ?? {});
    }

    if (node.type === "text.generate") {
      const request = buildTextMessages(upstreamOutputs, node.config ?? {});
      const result = await this.textGenerationRuntime.generateText(
        {
          tenantId: context.tenantId,
          userId: context.userId,
        },
        request,
        {
          nodeRunId: nodeRun.id,
          workflowRunId: workflowRun.id,
        },
      );

      return this.mapTextGenerationOutput(result);
    }

    if (node.type === "output") {
      return resolveOutputNodeOutput(upstreamOutputs);
    }

    throw new Error(`Unsupported node type for PR-10: ${node.type}`);
  }

  private getDependencyOutputs(
    node: CompiledWorkflowNode,
    nodeRuns: NodeRunRecord[],
  ): Array<Record<string, unknown> | null> {
    return node.dependencies.map((dependencyId) => {
      const dependencyRun = nodeRuns.find((row) => row.node_id === dependencyId);
      return dependencyRun?.output_json ?? null;
    });
  }

  private async getRuntimeFlow(
    client: PoolClient,
    workflowRunId: string,
  ): Promise<RuntimeFlowRecord> {
    const result = await client.query<RuntimeFlowRecord>(
      `
        SELECT
          workflow_runs.id::text AS workflow_run_id,
          workflow_runs.flow_version_id::text AS flow_version_id,
          flow_versions.compiled_graph_json
        FROM workflow_runs
        JOIN flow_versions
          ON flow_versions.id = workflow_runs.flow_version_id
        WHERE workflow_runs.id = $1::uuid
        LIMIT 1
      `,
      [workflowRunId],
    );

    if (!result.rows[0]) {
      throw new Error(`Workflow run not found: ${workflowRunId}`);
    }

    return result.rows[0];
  }

  private async listNodeRuns(
    client: PoolClient,
    workflowRunId: string,
  ): Promise<NodeRunRecord[]> {
    const result = await client.query<NodeRunRecord>(
      `
        SELECT
          id::text AS id,
          workflow_run_id::text AS workflow_run_id,
          node_id,
          node_type,
          status,
          attempt,
          input_json,
          output_json,
          error_json,
          started_at::text AS started_at,
          finished_at::text AS finished_at
        FROM node_runs
        WHERE workflow_run_id = $1::uuid
        ORDER BY created_at ASC, id ASC
      `,
      [workflowRunId],
    );

    return result.rows;
  }

  private async lockWorkflowRun(
    client: PoolClient,
    workflowRunId: string,
  ): Promise<WorkflowRunRecord> {
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
          started_at::text AS started_at
        FROM workflow_runs
        WHERE id = $1::uuid
        FOR UPDATE
      `,
      [workflowRunId],
    );

    if (!result.rows[0]) {
      throw new Error(`Workflow run not found: ${workflowRunId}`);
    }

    return result.rows[0];
  }

  private mapTextGenerationOutput(result: AiGatewayTextResult): Record<string, unknown> {
    return {
      modelKey: result.modelKey,
      providerKey: result.providerKey,
      text: result.outputText,
      usage: result.usage,
    };
  }

  private async markNodeRunRunning(client: PoolClient, nodeRunId: string): Promise<void> {
    await client.query(
      `
        UPDATE node_runs
        SET
          status = 'running',
          attempt = attempt + 1,
          started_at = COALESCE(started_at, now()),
          updated_at = now()
        WHERE id = $1::uuid
      `,
      [nodeRunId],
    );
  }

  private async markWorkflowRunRunning(client: PoolClient, workflowRunId: string): Promise<void> {
    await client.query(
      `
        UPDATE workflow_runs
        SET
          status = CASE WHEN status = 'pending' THEN 'running' ELSE status END,
          started_at = COALESCE(started_at, now()),
          updated_at = now()
        WHERE id = $1::uuid
      `,
      [workflowRunId],
    );
  }
}
