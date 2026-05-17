import { BillingService, createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type {
  AiGatewayMediaResult,
  AiGatewayTextResult,
  AssetReferenceInput,
  DatabaseMediaRuntime,
  DatabaseTextGenerationRuntime,
  ImageGenerationRequest,
  MediaOutput,
  ProviderTaskResult,
  TextGenerationRequest,
  VideoGenerationRequest,
} from "@aigc-flow/ai-gateway-core";
import {
  QUEUE_NAMES,
  assertLightweightJobPayload,
  type NodeExecuteJobPayload,
  type ProviderPollJobPayload,
} from "@aigc-flow/redis";
import type { StorageProvider } from "@aigc-flow/storage";
import type { CompiledWorkflow, CompiledWorkflowNode } from "@aigc-flow/workflow-core";
import type { Pool, PoolClient } from "pg";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "../processors/shared.js";
import {
  type AssetRef,
  type FetchLike,
  MediaAssetStore,
} from "./media-asset-store.js";

type WorkflowRunRecord = {
  error_json: Record<string, unknown> | null;
  flow_id: string;
  flow_version_id: string;
  id: string;
  input_json: Record<string, unknown>;
  output_json: Record<string, unknown> | null;
  project_id: string | null;
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
  provider_task_id: string | null;
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
type MediaGenerationRuntimeLike = Pick<DatabaseMediaRuntime, "generateImage" | "generateVideo" | "pollTask">;

type NodeExecuteQueueLike = {
  add: (name: string, data: NodeExecuteJobPayload) => Promise<unknown>;
};

type ProviderPollQueueLike = {
  add: (
    name: string,
    data: ProviderPollJobPayload,
    options?: {
      delay?: number;
    },
  ) => Promise<unknown>;
};

type RuntimeExecutionResult = {
  errorToThrow?: Error;
  nodeEnqueuePayloads: NodeExecuteJobPayload[];
  pollEnqueuePayloads: Array<{
    delayMs?: number;
    payload: ProviderPollJobPayload;
  }>;
  processorResult: ProcessorResult;
};

type RuntimeFlowRecord = {
  compiled_graph_json: CompiledWorkflow;
  flow_version_id: string;
  project_id: string | null;
  workflow_run_id: string;
};

type NodeExecutionOutcome =
  | {
      usageRecord?: UsageRecordInput;
      outputJson: Record<string, unknown>;
      type: "succeeded";
    }
  | {
      outputJson: Record<string, unknown>;
      pollPayload: ProviderPollJobPayload;
      type: "waiting_provider";
    };

type UsageRecordInput = {
  billableCents: number;
  eventType: string;
  idempotencyKey: string;
  inputTokens: number | null;
  modality: "image" | "text" | "video";
  modelId?: string | null;
  nodeRunId: string;
  outputTokens: number | null;
  providerId?: string | null;
  rawCost?: string | number | null;
  routeId?: string | null;
  totalTokens: number | null;
  unitType?: string | null;
  units?: number | null;
  workflowRunId: string;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function extractAssetInputs(upstreamOutputs: Array<Record<string, unknown> | null>): AssetReferenceInput[] {
  const assets: AssetReferenceInput[] = [];

  for (const output of upstreamOutputs) {
    if (!output || !Array.isArray(output.assets)) {
      continue;
    }

    for (const asset of output.assets) {
      if (!isPlainObject(asset) || typeof asset.assetId !== "string") {
        continue;
      }

      assets.push({
        assetId: asset.assetId,
        durationMs: typeof asset.durationMs === "number" ? asset.durationMs : null,
        height: typeof asset.height === "number" ? asset.height : null,
        kind: typeof asset.kind === "string" ? asset.kind : null,
        mimeType: typeof asset.mimeType === "string" ? asset.mimeType : null,
        width: typeof asset.width === "number" ? asset.width : null,
      });
    }
  }

  return assets;
}

function extractPromptFromUpstreamOutputs(
  upstreamOutputs: Array<Record<string, unknown> | null>,
  fallbackPrompt: string,
): string {
  const fragments = upstreamOutputs
    .flatMap((output) => {
      if (!output) {
        return [];
      }

      const values: string[] = [];
      if (typeof output.prompt === "string" && output.prompt.trim()) {
        values.push(output.prompt.trim());
      }
      if (typeof output.text === "string" && output.text.trim()) {
        values.push(output.text.trim());
      }
      return values;
    })
    .filter(Boolean);

  if (fragments.length > 0) {
    return fragments.join("\n");
  }

  if (fallbackPrompt.trim()) {
    return fallbackPrompt.trim();
  }

  return JSON.stringify(upstreamOutputs);
}

function buildImageRequest(
  upstreamOutputs: Array<Record<string, unknown> | null>,
  config: Record<string, unknown>,
): ImageGenerationRequest {
  return {
    inputAssets: extractAssetInputs(upstreamOutputs),
    metadata: isPlainObject(config.metadata) ? config.metadata : null,
    model: typeof config.model === "string" ? config.model : null,
    prompt: extractPromptFromUpstreamOutputs(upstreamOutputs, typeof config.prompt === "string" ? config.prompt : ""),
    routeKey: typeof config.routeKey === "string" ? config.routeKey : null,
  };
}

function buildVideoRequest(
  upstreamOutputs: Array<Record<string, unknown> | null>,
  config: Record<string, unknown>,
): VideoGenerationRequest {
  return {
    inputAssets: extractAssetInputs(upstreamOutputs),
    metadata: isPlainObject(config.metadata) ? config.metadata : null,
    model: typeof config.model === "string" ? config.model : null,
    prompt: extractPromptFromUpstreamOutputs(upstreamOutputs, typeof config.prompt === "string" ? config.prompt : ""),
    routeKey: typeof config.routeKey === "string" ? config.routeKey : null,
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
  readonly assetStore: MediaAssetStore;
  readonly billingService: BillingService;
  readonly mediaGenerationRuntime: MediaGenerationRuntimeLike;
  readonly nodeExecuteQueue: NodeExecuteQueueLike;
  readonly pollDelayMs: number;
  readonly pool: Pool;
  readonly providerPollQueue: ProviderPollQueueLike;
  readonly textGenerationRuntime: TextGenerationRuntimeLike;

  constructor(options: {
    assetBucket: string;
    billingService?: BillingService;
    fetchFn?: FetchLike;
    mediaGenerationRuntime: MediaGenerationRuntimeLike;
    nodeExecuteQueue: NodeExecuteQueueLike;
    pollDelayMs?: number;
    pool?: Pool;
    providerPollQueue: ProviderPollQueueLike;
    storageProvider: StorageProvider;
    textGenerationRuntime: TextGenerationRuntimeLike;
  }) {
    this.assetStore = new MediaAssetStore({
      assetBucket: options.assetBucket,
      fetchFn: options.fetchFn,
      storageProvider: options.storageProvider,
    });
    this.billingService = options.billingService ?? new BillingService({
      pool: options.pool,
    });
    this.mediaGenerationRuntime = options.mediaGenerationRuntime;
    this.nodeExecuteQueue = options.nodeExecuteQueue;
    this.pollDelayMs = options.pollDelayMs ?? 250;
    this.pool = options.pool ?? createPgPool();
    this.providerPollQueue = options.providerPollQueue;
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

    await this.flushEnqueues(execution);

    if (execution.errorToThrow) {
      throw execution.errorToThrow;
    }

    return execution.processorResult;
  }

  async pollProviderTask(
    input: ProviderPollJobPayload,
    logger: WorkerLogger,
  ): Promise<ProcessorResult> {
    const execution = await this.pollProviderTaskInTransaction(
      {
        tenantId: input.tenantId,
        traceId: input.traceId ?? null,
        userId: null,
      },
      input,
      logger,
    );

    await this.flushEnqueues(execution);

    if (execution.errorToThrow) {
      throw execution.errorToThrow;
    }

    return execution.processorResult;
  }

  private async flushEnqueues(execution: RuntimeExecutionResult): Promise<void> {
    for (const payload of execution.nodeEnqueuePayloads) {
      assertLightweightJobPayload(payload);
      await this.nodeExecuteQueue.add(QUEUE_NAMES.nodeExecute, payload);
    }

    for (const instruction of execution.pollEnqueuePayloads) {
      assertLightweightJobPayload(instruction.payload);
      await this.providerPollQueue.add(QUEUE_NAMES.providerPoll, instruction.payload, {
        delay: instruction.delayMs,
      });
    }
  }

  private async executeNodeInTransaction(
    context: WorkflowExecutionContext,
    input: NodeExecuteJobPayload,
    logger: WorkerLogger,
  ): Promise<RuntimeExecutionResult> {
    return withTenantTransaction(context, async (client) => {
      const workflowRun = await this.lockWorkflowRun(client, input.workflowRunId);
      if (isTerminalStatus(workflowRun.status)) {
        return this.noOpResult(QUEUE_NAMES.nodeExecute, input);
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

      if (
        isTerminalStatus(currentNodeRun.status) ||
        currentNodeRun.status === "running" ||
        currentNodeRun.status === "waiting_provider"
      ) {
        return this.noOpResult(QUEUE_NAMES.nodeExecute, input);
      }

      if (!this.areDependenciesSatisfied(currentNode, nodeRuns)) {
        return this.noOpResult(QUEUE_NAMES.nodeExecute, input);
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
        const outcome = await this.executeNodeByType(
          client,
          currentNode,
          upstreamOutputs,
          workflowRun,
          runtimeFlow,
          currentNodeRun,
          context,
        );

        if (outcome.type === "waiting_provider") {
          await client.query(
            `
              UPDATE node_runs
              SET
                status = 'waiting_provider',
                output_json = $2::jsonb,
                provider_task_id = $3,
                error_json = NULL,
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [currentNodeRun.id, JSON.stringify(outcome.outputJson), outcome.pollPayload.providerTaskId],
          );

          await this.appendWorkflowRunEvent(client, {
            eventType: "node.run.waiting_provider",
            nodeRunId: currentNodeRun.id,
            payload: outcome.outputJson,
            tenantId: input.tenantId,
            workflowRunId: workflowRun.id,
          });

          logger.info(
            {
              nodeRunId: currentNodeRun.id,
              providerTaskId: outcome.pollPayload.providerTaskId,
              workflowRunId: workflowRun.id,
            },
            "workflow node waiting on provider task",
          );

          return {
            nodeEnqueuePayloads: [],
            pollEnqueuePayloads: [
              {
                delayMs: this.pollDelayMs,
                payload: outcome.pollPayload,
              },
            ],
            processorResult: {
              jobId: null,
              queueName: QUEUE_NAMES.nodeExecute,
              status: "ok",
              tenantId: input.tenantId,
              traceId: input.traceId ?? null,
            },
          };
        }

        const enqueuePayloads = await this.markNodeSucceededAndUnlockDependents(
          client,
          currentNode,
          runtimeFlow,
          workflowRun,
          currentNodeRun,
          context,
          outcome.outputJson,
          outcome.type === "succeeded" ? outcome.usageRecord : undefined,
        );

        logger.info(
          {
            enqueuedNodeCount: enqueuePayloads.length,
            nodeRunId: currentNodeRun.id,
            workflowRunId: workflowRun.id,
          },
          "workflow node execution succeeded",
        );

        return {
          nodeEnqueuePayloads: enqueuePayloads,
          pollEnqueuePayloads: [],
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
        await this.failNodeAndWorkflow(client, workflowRun.id, currentNodeRun.id, input.tenantId, normalized);

        return {
          errorToThrow: error instanceof Error ? error : new Error(String(error)),
          nodeEnqueuePayloads: [],
          pollEnqueuePayloads: [],
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

  private async pollProviderTaskInTransaction(
    context: WorkflowExecutionContext,
    input: ProviderPollJobPayload,
    logger: WorkerLogger,
  ): Promise<RuntimeExecutionResult> {
    return withTenantTransaction(context, async (client) => {
      const workflowRun = await this.lockWorkflowRun(client, input.workflowRunId);
      if (isTerminalStatus(workflowRun.status)) {
        return this.noOpResult(QUEUE_NAMES.providerPoll, input);
      }

      const runtimeFlow = await this.getRuntimeFlow(client, input.workflowRunId);
      const nodeRuns = await this.listNodeRuns(client, input.workflowRunId);
      const currentNodeRun = nodeRuns.find((nodeRun) => nodeRun.id === input.nodeRunId);

      if (!currentNodeRun) {
        throw new Error(`Node run not found: ${input.nodeRunId}`);
      }

      if (currentNodeRun.status !== "waiting_provider") {
        return this.noOpResult(QUEUE_NAMES.providerPoll, input);
      }

      const currentNode = runtimeFlow.compiled_graph_json.nodes.find(
        (node) => node.id === currentNodeRun.node_id,
      );
      if (!currentNode) {
        throw new Error(`Compiled node not found: ${currentNodeRun.node_id}`);
      }

      try {
        const providerState = isPlainObject(currentNodeRun.output_json?.providerTask)
          ? currentNodeRun.output_json?.providerTask
          : {};

        const pollResult = await this.mediaGenerationRuntime.pollTask(
          {
            tenantId: context.tenantId,
            userId: context.userId,
          },
          currentNode.type === "video.generate" ? "video" : "image",
          {
            providerTaskId: input.providerTaskId,
            routeId: typeof providerState.routeId === "string" ? providerState.routeId : null,
            routeKey: typeof providerState.routeKey === "string" ? providerState.routeKey : null,
          },
          {
            nodeRunId: currentNodeRun.id,
            workflowRunId: workflowRun.id,
          },
        );

        if (pollResult.status === "pending" || pollResult.status === "running") {
          const waitingJson = this.buildWaitingProviderOutput({
            modelId: typeof providerState.modelId === "string" ? providerState.modelId : null,
            modelKey: typeof providerState.modelKey === "string" ? providerState.modelKey : null,
            providerId: typeof providerState.providerId === "string" ? providerState.providerId : null,
            providerKey: typeof providerState.providerKey === "string" ? providerState.providerKey : null,
            providerTaskId: input.providerTaskId,
            routeId: typeof providerState.routeId === "string" ? providerState.routeId : null,
            routeKey: typeof providerState.routeKey === "string" ? providerState.routeKey : null,
            status: pollResult.status,
          });

          await client.query(
            `
              UPDATE node_runs
              SET
                output_json = $2::jsonb,
                updated_at = now()
              WHERE id = $1::uuid
            `,
            [currentNodeRun.id, JSON.stringify(waitingJson)],
          );

          await this.appendWorkflowRunEvent(client, {
            eventType: "node.run.waiting_provider",
            nodeRunId: currentNodeRun.id,
            payload: waitingJson,
            tenantId: input.tenantId,
            workflowRunId: workflowRun.id,
          });

          return {
            nodeEnqueuePayloads: [],
            pollEnqueuePayloads: [
              {
                delayMs: this.pollDelayMs,
                payload: {
                  nodeRunId: input.nodeRunId,
                  providerTaskId: input.providerTaskId,
                  tenantId: input.tenantId,
                  traceId: input.traceId ?? undefined,
                  workflowRunId: input.workflowRunId,
                },
              },
            ],
            processorResult: {
              jobId: null,
              queueName: QUEUE_NAMES.providerPoll,
              status: "ok",
              tenantId: input.tenantId,
              traceId: input.traceId ?? null,
            },
          };
        }

        if (pollResult.status === "failed") {
          const normalized = normalizeError(pollResult.error ?? { message: "Provider task failed" });
          await this.failNodeAndWorkflow(client, workflowRun.id, currentNodeRun.id, input.tenantId, normalized);
          return {
            errorToThrow: new Error(normalized.message),
            nodeEnqueuePayloads: [],
            pollEnqueuePayloads: [],
            processorResult: {
              jobId: null,
              queueName: QUEUE_NAMES.providerPoll,
              status: "ok",
              tenantId: input.tenantId,
              traceId: input.traceId ?? null,
            },
          };
        }

        const outputJson = await this.persistProviderResult(
          client,
          currentNode,
          workflowRun,
          runtimeFlow,
          currentNodeRun,
          pollResult,
        );
        const usageRecord = this.buildUsageRecord({
          billableCents: 0,
          eventType: currentNode.type === "video.generate" ? "ai.video.generate" : "ai.image.generate",
          idempotencyKey: this.buildUsageIdempotencyKey(
            context.tenantId,
            workflowRun.id,
            currentNodeRun.id,
            currentNode.type === "video.generate" ? "video" : "image",
          ),
          inputTokens: pollResult.usage?.inputTokens ?? null,
          modality: currentNode.type === "video.generate" ? "video" : "image",
          modelId: pollResult.modelId ?? null,
          nodeRunId: currentNodeRun.id,
          outputTokens: pollResult.usage?.outputTokens ?? null,
          providerId: pollResult.providerId ?? null,
          rawCost: pollResult.usage?.rawCost ?? null,
          routeId: pollResult.routeId ?? null,
          totalTokens: pollResult.usage?.totalTokens ?? null,
          unitType: "output_count",
          units: outputJson.assets && Array.isArray(outputJson.assets) ? outputJson.assets.length : 0,
          workflowRunId: workflowRun.id,
        });
        const enqueuePayloads = await this.markNodeSucceededAndUnlockDependents(
          client,
          currentNode,
          runtimeFlow,
          workflowRun,
          currentNodeRun,
          context,
          outputJson,
          usageRecord,
        );

        logger.info(
          {
            enqueuedNodeCount: enqueuePayloads.length,
            nodeRunId: currentNodeRun.id,
            providerTaskId: input.providerTaskId,
            workflowRunId: workflowRun.id,
          },
          "provider task polling succeeded",
        );

        return {
          nodeEnqueuePayloads: enqueuePayloads,
          pollEnqueuePayloads: [],
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.providerPoll,
            status: "ok",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      } catch (error) {
        const normalized = normalizeError(error);
        await this.failNodeAndWorkflow(client, workflowRun.id, currentNodeRun.id, input.tenantId, normalized);
        return {
          errorToThrow: error instanceof Error ? error : new Error(String(error)),
          nodeEnqueuePayloads: [],
          pollEnqueuePayloads: [],
          processorResult: {
            jobId: null,
            queueName: QUEUE_NAMES.providerPoll,
            status: "ok",
            tenantId: input.tenantId,
            traceId: input.traceId ?? null,
          },
        };
      }
    }, this.pool);
  }

  private noOpResult(
    queueName: string,
    input: {
      tenantId: string;
      traceId?: string;
    },
  ): RuntimeExecutionResult {
    return {
      nodeEnqueuePayloads: [],
      pollEnqueuePayloads: [],
      processorResult: {
        jobId: null,
        queueName,
        status: "no-op",
        tenantId: input.tenantId,
        traceId: input.traceId ?? null,
      },
    };
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
    client: PoolClient,
    node: CompiledWorkflowNode,
    upstreamOutputs: Array<Record<string, unknown> | null>,
    workflowRun: WorkflowRunRecord,
    runtimeFlow: RuntimeFlowRecord,
    nodeRun: NodeRunRecord,
    context: WorkflowExecutionContext,
  ): Promise<NodeExecutionOutcome> {
    if (node.type === "input") {
      return {
        outputJson: resolveInputNodeOutput(workflowRun.input_json ?? {}, node.config ?? {}),
        type: "succeeded",
      };
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

      return {
        usageRecord: this.buildUsageRecord({
          billableCents: 0,
          eventType: "ai.text.generate",
          idempotencyKey: this.buildUsageIdempotencyKey(context.tenantId, workflowRun.id, nodeRun.id, "text"),
          inputTokens: result.usage.inputTokens,
          modality: "text",
          modelId: result.modelId ?? null,
          nodeRunId: nodeRun.id,
          outputTokens: result.usage.outputTokens,
          providerId: result.providerId ?? null,
          rawCost: result.usage.rawCost ?? null,
          routeId: result.routeId ?? null,
          totalTokens: result.usage.totalTokens,
          workflowRunId: workflowRun.id,
        }),
        outputJson: this.mapTextGenerationOutput(result),
        type: "succeeded",
      };
    }

    if (node.type === "image.generate") {
      const request = buildImageRequest(upstreamOutputs, node.config ?? {});
      const result = await this.mediaGenerationRuntime.generateImage(
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

      return this.mapMediaOutcome(client, node, workflowRun, runtimeFlow, nodeRun, context, result, "image");
    }

    if (node.type === "video.generate") {
      const request = buildVideoRequest(upstreamOutputs, node.config ?? {});
      const result = await this.mediaGenerationRuntime.generateVideo(
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

      return this.mapMediaOutcome(client, node, workflowRun, runtimeFlow, nodeRun, context, result, "video");
    }

    if (node.type === "output") {
      return {
        outputJson: resolveOutputNodeOutput(upstreamOutputs),
        type: "succeeded",
      };
    }

    throw new Error(`Unsupported node type for PR-12: ${node.type}`);
  }

  private async mapMediaOutcome(
    client: PoolClient,
    node: CompiledWorkflowNode,
    workflowRun: WorkflowRunRecord,
    runtimeFlow: RuntimeFlowRecord,
    nodeRun: NodeRunRecord,
    context: WorkflowExecutionContext,
    result: AiGatewayMediaResult,
    kind: "image" | "video",
  ): Promise<NodeExecutionOutcome> {
    if (result.status === "waiting_provider") {
      if (!result.providerTaskId) {
        throw new Error("Provider task ID is required for waiting_provider results");
      }

      return {
        outputJson: this.buildWaitingProviderOutput({
          modelId: result.modelId ?? null,
          modelKey: result.modelKey,
          providerId: result.providerId ?? null,
          providerKey: result.providerKey,
          providerTaskId: result.providerTaskId,
          routeId: result.routeId ?? null,
          routeKey: typeof node.config.routeKey === "string" ? node.config.routeKey : null,
          status: "waiting_provider",
        }),
        pollPayload: {
          nodeRunId: nodeRun.id,
          providerTaskId: result.providerTaskId,
          tenantId: context.tenantId,
          traceId: context.traceId ?? undefined,
          workflowRunId: workflowRun.id,
        },
        type: "waiting_provider",
      };
    }

    const outputJson = await this.persistMediaOutputs(
      client,
      kind,
      workflowRun,
      runtimeFlow,
      nodeRun,
      this.normalizeMediaOutputs(result.outputs ?? []),
    );

    return {
      usageRecord: this.buildUsageRecord({
        billableCents: 0,
        eventType: kind === "image" ? "ai.image.generate" : "ai.video.generate",
        idempotencyKey: this.buildUsageIdempotencyKey(
          context.tenantId,
          workflowRun.id,
          nodeRun.id,
          kind,
        ),
        inputTokens: result.usage?.inputTokens ?? null,
        modality: kind,
        modelId: result.modelId ?? null,
        nodeRunId: nodeRun.id,
        outputTokens: result.usage?.outputTokens ?? null,
        providerId: result.providerId ?? null,
        rawCost: result.usage?.rawCost ?? null,
        routeId: result.routeId ?? null,
        totalTokens: result.usage?.totalTokens ?? null,
        unitType: "output_count",
        units: outputJson.assets && Array.isArray(outputJson.assets) ? outputJson.assets.length : 0,
        workflowRunId: workflowRun.id,
      }),
      outputJson,
      type: "succeeded",
    };
  }

  private buildWaitingProviderOutput(input: {
    modelId: string | null;
    modelKey: string | null;
    providerId: string | null;
    providerKey: string | null;
    providerTaskId: string;
    routeId: string | null;
    routeKey: string | null;
    status: "pending" | "running" | "waiting_provider";
  }): Record<string, unknown> {
    return {
      providerTask: {
        modelId: input.modelId,
        modelKey: input.modelKey,
        providerId: input.providerId,
        providerKey: input.providerKey,
        providerTaskId: input.providerTaskId,
        routeId: input.routeId,
        routeKey: input.routeKey,
        status: input.status,
      },
    };
  }

  private normalizeMediaOutputs(
    outputs: Array<Record<string, unknown> | MediaOutput | null | undefined>,
    outputUrls: string[] = [],
    outputBase64: string[] = [],
    mimeType: string | null = null,
  ): MediaOutput[] {
    const normalized: MediaOutput[] = [];

    for (const output of outputs) {
      if (!output || !isPlainObject(output)) {
        continue;
      }

      normalized.push({
        base64: typeof output.base64 === "string" ? output.base64 : null,
        durationMs: typeof output.durationMs === "number" ? output.durationMs : null,
        filename: typeof output.filename === "string" ? output.filename : null,
        height: typeof output.height === "number" ? output.height : null,
        mimeType: typeof output.mimeType === "string" ? output.mimeType : mimeType,
        url: typeof output.url === "string" ? output.url : null,
        width: typeof output.width === "number" ? output.width : null,
      });
    }

    for (const url of outputUrls) {
      normalized.push({
        mimeType,
        url,
      });
    }

    for (const base64 of outputBase64) {
      normalized.push({
        base64,
        mimeType,
      });
    }

    return normalized;
  }

  private async persistProviderResult(
    client: PoolClient,
    node: CompiledWorkflowNode,
    workflowRun: WorkflowRunRecord,
    runtimeFlow: RuntimeFlowRecord,
    nodeRun: NodeRunRecord,
    result: ProviderTaskResult,
  ): Promise<Record<string, unknown>> {
    return this.persistMediaOutputs(
      client,
      node.type === "video.generate" ? "video" : "image",
      workflowRun,
      runtimeFlow,
      nodeRun,
      this.normalizeMediaOutputs(
        result.outputs ?? [],
        result.outputUrls ?? [],
        result.outputBase64 ?? [],
        result.mimeType ?? null,
      ),
    );
  }

  private async persistMediaOutputs(
    client: PoolClient,
    kind: "image" | "video",
    workflowRun: WorkflowRunRecord,
    runtimeFlow: RuntimeFlowRecord,
    nodeRun: NodeRunRecord,
    outputs: MediaOutput[],
  ): Promise<Record<string, unknown>> {
    const assets = await this.assetStore.persistOutputs(client, {
      kind,
      nodeRunId: nodeRun.id,
      outputs,
      projectId: runtimeFlow.project_id,
      tenantId: workflowRun.tenant_id,
      workflowRunId: workflowRun.id,
    });

    return {
      assets,
    };
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
          flows.project_id::text AS project_id,
          flow_versions.compiled_graph_json
        FROM workflow_runs
        JOIN flows
          ON flows.id = workflow_runs.flow_id
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
          provider_task_id,
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
          workflow_runs.id::text AS id,
          workflow_runs.tenant_id::text AS tenant_id,
          workflow_runs.flow_id::text AS flow_id,
          workflow_runs.flow_version_id::text AS flow_version_id,
          workflow_runs.status,
          workflow_runs.input_json,
          workflow_runs.output_json,
          workflow_runs.error_json,
          workflow_runs.started_at::text AS started_at,
          flows.project_id::text AS project_id
        FROM workflow_runs
        JOIN flows
          ON flows.id = workflow_runs.flow_id
        WHERE workflow_runs.id = $1::uuid
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

  private buildUsageIdempotencyKey(
    tenantId: string,
    workflowRunId: string,
    nodeRunId: string,
    modality: "image" | "text" | "video",
  ): string {
    return `usage:${tenantId}:${workflowRunId}:${nodeRunId}:${modality}`;
  }

  private buildUsageRecord(input: UsageRecordInput): UsageRecordInput {
    return input;
  }

  private async recordUsageForNode(
    client: PoolClient,
    tenantId: string,
    input: UsageRecordInput,
  ): Promise<void> {
    const usageEvent = await this.billingService.recordUsageEventWithClient(client, tenantId, {
      billableCents: input.billableCents,
      eventType: input.eventType,
      idempotencyKey: input.idempotencyKey,
      inputTokens: input.inputTokens,
      metadata: {
        nodeRunId: input.nodeRunId,
        workflowRunId: input.workflowRunId,
      },
      modality: input.modality,
      modelId: input.modelId ?? null,
      nodeRunId: input.nodeRunId,
      outputTokens: input.outputTokens,
      providerId: input.providerId ?? null,
      rawCost: input.rawCost ?? null,
      routeId: input.routeId ?? null,
      totalTokens: input.totalTokens,
      unitType: input.unitType ?? null,
      units: input.units ?? null,
      workflowRunId: input.workflowRunId,
    });

    await this.billingService.settleUsageWithClient(client, tenantId, {
      amountCents: input.billableCents,
      description: `${input.eventType} settled`,
      idempotencyKey: `settle:${usageEvent.id}`,
      metadata: {
        modality: input.modality,
        nodeRunId: input.nodeRunId,
        workflowRunId: input.workflowRunId,
      },
      usageEventId: usageEvent.id,
    });
  }

  private async markNodeSucceededAndUnlockDependents(
    client: PoolClient,
    currentNode: CompiledWorkflowNode,
    runtimeFlow: RuntimeFlowRecord,
    workflowRun: WorkflowRunRecord,
    currentNodeRun: NodeRunRecord,
    context: WorkflowExecutionContext,
    outputJson: Record<string, unknown>,
    usageRecord?: UsageRecordInput,
  ): Promise<NodeExecuteJobPayload[]> {
    if (usageRecord) {
      await this.recordUsageForNode(client, context.tenantId, usageRecord);
    }

    await client.query(
      `
        UPDATE node_runs
        SET
          status = 'succeeded',
          output_json = $2::jsonb,
          provider_task_id = NULL,
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
      tenantId: context.tenantId,
      workflowRunId: workflowRun.id,
    });

    if (currentNode.type === "output") {
      await client.query(
        `
          UPDATE workflow_runs
          SET
            output_json = $2::jsonb,
            updated_at = now()
          WHERE id = $1::uuid
        `,
        [workflowRun.id, JSON.stringify(outputJson)],
      );
    }

    const enqueuePayloads = await this.enqueueReadyDependents(
      client,
      currentNode,
      runtimeFlow,
      workflowRun.id,
      context.tenantId,
      context.traceId,
    );
    await this.finalizeWorkflowRunIfComplete(client, workflowRun.id, context.tenantId);
    return enqueuePayloads;
  }

  private async enqueueReadyDependents(
    client: PoolClient,
    currentNode: CompiledWorkflowNode,
    runtimeFlow: RuntimeFlowRecord,
    workflowRunId: string,
    tenantId: string,
    traceId: string | null,
  ): Promise<NodeExecuteJobPayload[]> {
    const enqueuePayloads: NodeExecuteJobPayload[] = [];
    const refreshedNodeRuns = await this.listNodeRuns(client, workflowRunId);

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
          tenantId,
          workflowRunId,
        });

        enqueuePayloads.push({
          nodeRunId: dependentRun.id,
          tenantId,
          traceId: traceId ?? undefined,
          workflowRunId,
        });
      }
    }

    return enqueuePayloads;
  }

  private async finalizeWorkflowRunIfComplete(
    client: PoolClient,
    workflowRunId: string,
    tenantId: string,
  ): Promise<void> {
    const finalNodeRuns = await this.listNodeRuns(client, workflowRunId);
    if (!finalNodeRuns.every((nodeRun) => nodeRun.status === "succeeded")) {
      return;
    }

    await client.query(
      `
        UPDATE workflow_runs
        SET
          status = 'succeeded',
          finished_at = now(),
          updated_at = now()
        WHERE id = $1::uuid
      `,
      [workflowRunId],
    );
    await this.appendWorkflowRunEvent(client, {
      eventType: "workflow.run.succeeded",
      payload: {
        status: "succeeded",
      },
      tenantId,
      workflowRunId,
    });
  }

  private async failNodeAndWorkflow(
    client: PoolClient,
    workflowRunId: string,
    nodeRunId: string,
    tenantId: string,
    normalized: {
      code: string;
      details?: unknown;
      message: string;
    },
  ): Promise<void> {
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
      [nodeRunId, JSON.stringify(normalized)],
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
      [workflowRunId, JSON.stringify(normalized)],
    );
    await this.appendWorkflowRunEvent(client, {
      eventType: "node.run.failed",
      nodeRunId,
      payload: normalized,
      tenantId,
      workflowRunId,
    });
    await this.appendWorkflowRunEvent(client, {
      eventType: "workflow.run.failed",
      payload: normalized,
      tenantId,
      workflowRunId,
    });
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
