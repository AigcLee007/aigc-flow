import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

import { BillingService, createPgPool, withTenantTransaction } from "@aigc-flow/db";
import type {
  AiGatewayMediaResult,
  ProviderTaskResult,
} from "@aigc-flow/ai-gateway-core";
import { QUEUE_NAMES, type NodeExecuteJobPayload, type ProviderPollJobPayload } from "@aigc-flow/redis";
import type { StorageProvider } from "@aigc-flow/storage";

import type { ApiEnv } from "../../api/src/config/env.js";
import { buildApp } from "../../api/src/app.js";
import { WorkflowRunsService } from "../../api/src/modules/workflow-runs/workflow-runs.service.js";
import { createWorkerRuntime } from "../src/main.js";
import type { WorkerLogger } from "../src/logger.js";
import { processNodeExecuteJob } from "../src/processors/node-execute.processor.js";
import { processProviderPollJob } from "../src/processors/provider-poll.processor.js";
import { processWorkflowStartJob } from "../src/processors/workflow-start.processor.js";
import { WORKER_QUEUE_NAMES } from "../src/queues/registry.js";
import { WorkflowNodeExecutionService } from "../src/workflow-runtime/service.js";
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
  queuePrefix: "test-prefix",
  redisUrl: "redis://localhost:6379",
  refreshTokenTtlSeconds: 60 * 60 * 24 * 7,
  s3AccessKeyId: "test-access",
  s3Bucket: "test-bucket",
  s3Endpoint: "http://localhost:9000",
  s3ForcePathStyle: true,
  s3Region: "us-east-1",
  s3SecretAccessKey: "test-secret",
};

class MemoryStorageProvider implements StorageProvider {
  readonly objects = new Map<string, {
    body: Buffer;
    contentType: string | null;
    metadata: Record<string, string>;
  }>();

  async putObject(input: {
    body: Buffer | Uint8Array | string;
    bucket: string;
    contentType?: string;
    key: string;
    metadata?: Record<string, string>;
  }): Promise<void> {
    this.objects.set(`${input.bucket}/${input.key}`, {
      body: Buffer.isBuffer(input.body) ? input.body : Buffer.from(input.body),
      contentType: input.contentType ?? null,
      metadata: input.metadata ?? {},
    });
  }

  async headObject(input: { bucket: string; key: string }) {
    const object = this.objects.get(`${input.bucket}/${input.key}`);
    if (!object) {
      throw new Error("Object not found");
    }

    return {
      contentLength: object.body.byteLength,
      contentType: object.contentType,
      eTag: "etag-test",
      lastModified: new Date().toISOString(),
      metadata: object.metadata,
    };
  }

  async deleteObject(input: { bucket: string; key: string }): Promise<void> {
    this.objects.delete(`${input.bucket}/${input.key}`);
  }

  async createPresignedPutUrl() {
    throw new Error("not used in worker tests");
  }

  async createPresignedGetUrl() {
    throw new Error("not used in worker tests");
  }
}

function createFakeNodeExecuteQueue() {
  const jobs: Array<{ data: NodeExecuteJobPayload; name: string }> = [];
  return {
    jobs,
    queue: {
      async add(name: string, data: NodeExecuteJobPayload) {
        jobs.push({ data, name });
        return { id: `job-${jobs.length}` };
      },
    },
  };
}

function createFakeProviderPollQueue() {
  const jobs: Array<{ data: ProviderPollJobPayload; delay?: number; name: string }> = [];
  return {
    jobs,
    queue: {
      async add(
        name: string,
        data: ProviderPollJobPayload,
        options?: {
          delay?: number;
        },
      ) {
        jobs.push({ data, delay: options?.delay, name });
        return { id: `poll-${jobs.length}` };
      },
    },
  };
}

function createTestLogger(): WorkerLogger {
  return {
    error() {
      return;
    },
    info() {
      return;
    },
  };
}

function createSpyLogger() {
  return {
    error: vi.fn(),
    info: vi.fn(),
  } satisfies WorkerLogger;
}

async function countBillingState(
  pool: ReturnType<typeof createPgPool>,
  tenantId: string,
  userId: string,
) {
  return withTenantTransaction(
    { tenantId, userId },
    async (client) => {
      const usageEvents = await client.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM usage_events",
      );
      const ledgerEntries = await client.query<{ count: number }>(
        "SELECT COUNT(*)::int AS count FROM billing_ledger",
      );
      return {
        ledgerEntries: ledgerEntries.rows[0]?.count ?? 0,
        usageEvents: usageEvents.rows[0]?.count ?? 0,
      };
    },
    pool,
  );
}

async function seedWorkflowRuntime(
  pool: ReturnType<typeof createPgPool>,
  options?: {
    inputNodeStatus?: string;
    inputOutputJson?: Record<string, unknown> | null;
    middleNodeConfig?: Record<string, unknown>;
    middleNodeOutputJson?: Record<string, unknown> | null;
    middleNodeStatus?: string;
    middleNodeType?: "text.generate" | "image.generate" | "video.generate";
    outputNodeStatus?: string;
    workflowStatus?: string;
  },
) {
  const tenantId = randomUUID();
  const userId = randomUUID();
  const projectId = randomUUID();
  const flowId = randomUUID();
  const flowVersionId = randomUUID();
  const workflowRunId = randomUUID();
  const inputNodeRunId = randomUUID();
  const middleNodeRunId = randomUUID();
  const outputNodeRunId = randomUUID();
  const middleNodeType = options?.middleNodeType ?? "text.generate";
  const middleNodeId = middleNodeType.startsWith("video") ? "video" : middleNodeType.startsWith("image") ? "image" : "text";

  const compiledGraph = {
    edges: [
      { source: "input", target: middleNodeId },
      { source: middleNodeId, target: "output" },
    ],
    entryNodeIds: ["input"],
    nodes: [
      {
        config: {
          inputKey: "prompt",
        },
        dependencies: [],
        dependents: [middleNodeId],
        id: "input",
        type: "input",
      },
      {
        config: options?.middleNodeConfig ?? (
          middleNodeType === "text.generate"
            ? { routeKey: "default-text", systemPrompt: "You are helpful." }
            : { routeKey: "default-media", prompt: "render something" }
        ),
        dependencies: ["input"],
        dependents: ["output"],
        id: middleNodeId,
        type: middleNodeType,
      },
      {
        config: {},
        dependencies: [middleNodeId],
        dependents: [],
        id: "output",
        type: "output",
      },
    ],
    outputNodeIds: ["output"],
    schemaVersion: "v2" as const,
  };

  await withTenantTransaction({ tenantId, userId }, async (client) => {
    await client.query(
      `
        INSERT INTO users (id, email, display_name)
        VALUES ($1::uuid, $2, $3)
      `,
      [userId, `${tenantId}@example.com`, "Worker Owner"],
    );
    await client.query(
      `
        INSERT INTO tenants (id, name, slug, updated_at)
        VALUES ($1::uuid, 'Worker Tenant', $2, now())
      `,
      [tenantId, `worker-${tenantId.slice(0, 8)}`],
    );
    await client.query(
      `
        INSERT INTO tenant_memberships (tenant_id, user_id, role_key, status, joined_at, updated_at)
        VALUES ($1::uuid, $2::uuid, 'tenant_owner', 'active', now(), now())
      `,
      [tenantId, userId],
    );
    await client.query(
      `
        INSERT INTO projects (id, tenant_id, name, created_by, updated_at)
        VALUES ($1::uuid, $2::uuid, 'Worker Project', $3::uuid, now())
      `,
      [projectId, tenantId, userId],
    );
    await client.query(
      `
        INSERT INTO flows (id, tenant_id, project_id, title, status, current_version_id, created_by, updated_by, updated_at)
        VALUES ($1::uuid, $2::uuid, $3::uuid, 'Worker Flow', 'published', null, $4::uuid, $4::uuid, now())
      `,
      [flowId, tenantId, projectId, userId],
    );
    await client.query(
      `
        INSERT INTO flow_versions (
          id,
          tenant_id,
          flow_id,
          version,
          graph_json,
          compiled_graph_json,
          checksum,
          published_by,
          published_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          1,
          $4::jsonb,
          $5::jsonb,
          'worker-checksum',
          $6::uuid,
          now()
        )
      `,
      [
        flowVersionId,
        tenantId,
        flowId,
        JSON.stringify({ edges: [], nodes: [] }),
        JSON.stringify(compiledGraph),
        userId,
      ],
    );
    await client.query(
      `
        UPDATE flows
        SET current_version_id = $2::uuid
        WHERE id = $1::uuid
      `,
      [flowId, flowVersionId],
    );
    await client.query(
      `
        INSERT INTO workflow_runs (
          id,
          tenant_id,
          flow_id,
          flow_version_id,
          status,
          input_json,
          created_by,
          updated_at
        )
        VALUES (
          $1::uuid,
          $2::uuid,
          $3::uuid,
          $4::uuid,
          $5,
          $6::jsonb,
          $7::uuid,
          now()
        )
      `,
      [
        workflowRunId,
        tenantId,
        flowId,
        flowVersionId,
        options?.workflowStatus ?? "pending",
        JSON.stringify({ prompt: "hello worker" }),
        userId,
      ],
    );
    await client.query(
      `
        INSERT INTO node_runs (
          id,
          tenant_id,
          workflow_run_id,
          node_id,
          node_type,
          status,
          output_json,
          provider_task_id,
          updated_at
        )
        VALUES
          ($1::uuid, $2::uuid, $3::uuid, 'input', 'input', $4, $5::jsonb, NULL, now()),
          ($6::uuid, $2::uuid, $3::uuid, $7, $8, $9, $10::jsonb, $11, now()),
          ($12::uuid, $2::uuid, $3::uuid, 'output', 'output', $13, NULL, NULL, now())
      `,
      [
        inputNodeRunId,
        tenantId,
        workflowRunId,
        options?.inputNodeStatus ?? "runnable",
        options?.inputOutputJson ? JSON.stringify(options.inputOutputJson) : null,
        middleNodeRunId,
        middleNodeId,
        middleNodeType,
        options?.middleNodeStatus ?? "pending",
        options?.middleNodeOutputJson ? JSON.stringify(options.middleNodeOutputJson) : null,
        options?.middleNodeOutputJson && isProviderTaskJson(options.middleNodeOutputJson)
          ? String(options.middleNodeOutputJson.providerTask.providerTaskId)
          : null,
        outputNodeRunId,
        options?.outputNodeStatus ?? "pending",
      ],
    );
    await client.query(
      `
        INSERT INTO workflow_run_events (tenant_id, workflow_run_id, event_type, sequence, payload)
        VALUES ($1::uuid, $2::uuid, 'workflow.run.created', 1, '{}'::jsonb)
      `,
      [tenantId, workflowRunId],
    );
  }, pool);

  return {
    flowId,
    flowVersionId,
    inputNodeRunId,
    middleNodeId,
    middleNodeRunId,
    middleNodeType,
    outputNodeRunId,
    projectId,
    tenantId,
    userId,
    workflowRunId,
  };
}

function isProviderTaskJson(value: Record<string, unknown>): value is {
  providerTask: {
    providerTaskId: string;
  };
} {
  return typeof value.providerTask === "object" &&
    value.providerTask !== null &&
    "providerTaskId" in value.providerTask;
}

function createWorkflowService(options: {
  fetchFn?: (url: string) => Promise<{
    arrayBuffer(): Promise<ArrayBuffer>;
    headers: { get(name: string): string | null };
    ok: boolean;
    status: number;
  }>;
  mediaGenerationRuntime?: {
    generateImage: (context: { tenantId: string; userId: string | null }, request: unknown, metadata?: unknown) => Promise<AiGatewayMediaResult>;
    generateVideo: (context: { tenantId: string; userId: string | null }, request: unknown, metadata?: unknown) => Promise<AiGatewayMediaResult>;
    pollTask: (context: { tenantId: string; userId: string | null }, modality: "image" | "video", request: unknown, metadata?: unknown) => Promise<ProviderTaskResult>;
  };
  nodeQueue: ReturnType<typeof createFakeNodeExecuteQueue>;
  pool: ReturnType<typeof createPgPool>;
  pollQueue: ReturnType<typeof createFakeProviderPollQueue>;
  storageProvider: StorageProvider;
  textGenerationRuntime?: {
    generateText: (context: { tenantId: string; userId: string | null }, request: unknown, metadata?: unknown) => Promise<AiGatewayTextResultLike>;
  };
}) {
  return new WorkflowNodeExecutionService({
    assetBucket: "test-bucket",
    fetchFn: options.fetchFn,
    mediaGenerationRuntime: options.mediaGenerationRuntime ?? {
      async generateImage() {
        throw new Error("generateImage not mocked");
      },
      async generateVideo() {
        throw new Error("generateVideo not mocked");
      },
      async pollTask() {
        throw new Error("pollTask not mocked");
      },
    },
    nodeExecuteQueue: options.nodeQueue.queue,
    pool: options.pool,
    providerPollQueue: options.pollQueue.queue,
    storageProvider: options.storageProvider,
    textGenerationRuntime: options.textGenerationRuntime ?? {
      async generateText() {
        return {
          modelKey: "mock-model",
          outputText: "generated text",
          providerKey: "mock-provider",
          providerRequest: {},
          providerResponse: {},
          status: "succeeded" as const,
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            totalTokens: 5,
          },
        };
      },
    },
  });
}

type AiGatewayTextResultLike = {
  modelKey: string;
  outputText: string;
  providerKey: string;
  providerRequest: unknown;
  providerResponse: unknown;
  status: "succeeded";
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    totalTokens: number | null;
  };
};

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

describe("worker skeleton", () => {
  test("registers the expected queue names", () => {
    const workerClose = vi.fn(async () => {});
    const eventsClose = vi.fn(async () => {});
    const queueClose = vi.fn(async () => {});
    const createdQueues: string[] = [];

    const runtime = createWorkerRuntime({
      env: {
        credentialKeyVersion: "v1",
        credentialMasterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        nodeEnv: "test",
        queuePrefix: "test-prefix",
        redisUrl: "redis://localhost:6379",
        s3AccessKeyId: "test-access",
        s3Bucket: "test-bucket",
        s3Endpoint: "http://localhost:9000",
        s3ForcePathStyle: true,
        s3Region: "us-east-1",
        s3SecretAccessKey: "test-secret",
        workerConcurrency: 2,
        workerName: "test-worker",
      },
      logger: createTestLogger(),
      pool: {} as never,
      queueFactory: {
        createQueue(name: string) {
          createdQueues.push(`queue:${name}`);
          return { close: queueClose };
        },
        createQueueEvents(name: string) {
          createdQueues.push(`events:${name}`);
          return { close: eventsClose };
        },
        createWorker(name: string) {
          createdQueues.push(`worker:${name}`);
          return { close: workerClose };
        },
      } as never,
      workflowNodeExecutionService: {} as never,
    });

    expect(runtime.queueNames).toEqual([...WORKER_QUEUE_NAMES]);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.nodeExecute}`);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.providerPoll}`);
  });

  test("processor skeleton returns a no-op result with tenantId and traceId", async () => {
    const result = await processWorkflowStartJob(
      {
        data: {
          tenantId: "tenant-1",
          traceId: "trace-1",
          workflowRunId: "run-1",
        },
        id: "job-1",
        queueName: QUEUE_NAMES.workflowStart,
      } as never,
      createTestLogger(),
    );

    expect(result).toEqual({
      jobId: "job-1",
      queueName: QUEUE_NAMES.workflowStart,
      status: "no-op",
      tenantId: "tenant-1",
      traceId: "trace-1",
    });
  });

  test("worker processor logs include traceId, tenantId, queueName, and jobId", async () => {
    const logger = createSpyLogger();

    await processNodeExecuteJob(
      {
        data: {
          nodeRunId: "node-1",
          tenantId: "tenant-1",
          traceId: "trace-1",
          workflowRunId: "run-1",
        },
        id: "job-1",
        queueName: QUEUE_NAMES.nodeExecute,
      } as never,
      logger,
      {
        executionService: {
          async executeNode() {
            return {
              jobId: null,
              queueName: QUEUE_NAMES.nodeExecute,
              status: "ok" as const,
              tenantId: "tenant-1",
              traceId: "trace-1",
            };
          },
        } as never,
      },
    );

    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        nodeRunId: "node-1",
        queueName: QUEUE_NAMES.nodeExecute,
        tenantId: "tenant-1",
        traceId: "trace-1",
        workflowRunId: "run-1",
      }),
      "processing node.execute job",
    );
    expect(logger.info).toHaveBeenCalledWith(
      expect.objectContaining({
        jobId: "job-1",
        nodeRunId: "node-1",
        queueName: QUEUE_NAMES.nodeExecute,
        status: "ok",
        tenantId: "tenant-1",
        traceId: "trace-1",
        workflowRunId: "run-1",
      }),
      "completed node.execute job",
    );
  });

  test("graceful shutdown closes worker resources", async () => {
    const workerClose = vi.fn(async () => {});
    const eventsClose = vi.fn(async () => {});
    const queueClose = vi.fn(async () => {});

    const runtime = createWorkerRuntime({
      env: {
        credentialKeyVersion: "v1",
        credentialMasterKey: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
        nodeEnv: "test",
        queuePrefix: "test-prefix",
        redisUrl: "redis://localhost:6379",
        s3AccessKeyId: "test-access",
        s3Bucket: "test-bucket",
        s3Endpoint: "http://localhost:9000",
        s3ForcePathStyle: true,
        s3Region: "us-east-1",
        s3SecretAccessKey: "test-secret",
        workerConcurrency: 2,
        workerName: "test-worker",
      },
      logger: createTestLogger(),
      pool: { end: vi.fn(async () => {}) } as never,
      queueFactory: {
        createQueue() {
          return { close: queueClose };
        },
        createQueueEvents() {
          return { close: eventsClose };
        },
        createWorker() {
          return { close: workerClose };
        },
      } as never,
      workflowNodeExecutionService: {} as never,
    });

    await runtime.shutdown();

    expect(workerClose).toHaveBeenCalledTimes(WORKER_QUEUE_NAMES.length);
    expect(eventsClose).toHaveBeenCalledTimes(WORKER_QUEUE_NAMES.length);
    expect(queueClose).toHaveBeenCalledTimes(2);
  });
});

describeWithDatabase("workflow node execution", () => {
  test("text node execution records billing audit logs without prompt leakage", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeOutputJson: {
            prompt: "sensitive prompt text",
          },
          inputNodeStatus: "succeeded",
          middleNodeStatus: "runnable",
        });
        const nodeQueue = createFakeNodeExecuteQueue();
        const pollQueue = createFakeProviderPollQueue();
        const service = createWorkflowService({
          nodeQueue,
          pollQueue,
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
          textGenerationRuntime: {
            async generateText() {
              return {
                modelKey: "mock-model",
                outputText: "generated text",
                providerKey: "mock-provider",
                providerRequest: {
                  prompt: "sensitive prompt text",
                },
                providerResponse: {
                  base64: "should-not-appear",
                },
                status: "succeeded" as const,
                usage: {
                  inputTokens: 2,
                  outputTokens: 3,
                  totalTokens: 5,
                },
              };
            },
          },
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-audit",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-audit",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const auditRows = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{
              action: string;
              metadata: Record<string, unknown>;
            }>(
              `
                SELECT action, metadata
                FROM audit_logs
                ORDER BY created_at ASC, id ASC
              `,
            );
            return result.rows;
          },
          appPool,
        );

        expect(auditRows.map((row) => row.action)).toEqual([
          "billing.usage.record",
          "billing.ledger.settle",
        ]);
        const serialized = JSON.stringify(auditRows);
        expect(serialized).not.toContain("sensitive prompt text");
        expect(serialized).not.toContain("should-not-appear");
        expect(serialized).not.toContain("base64");
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("input node succeeds and downstream node is enqueued with ID-only payload", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool);
        const nodeQueue = createFakeNodeExecuteQueue();
        const pollQueue = createFakeProviderPollQueue();
        const service = createWorkflowService({
          nodeQueue,
          pollQueue,
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.inputNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-input",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-input",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const result = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const inputNode = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.inputNodeRunId],
            );
            const nextNode = await client.query<{ id: string; status: string }>(
              "SELECT id::text AS id, status FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            return {
              inputNode: inputNode.rows[0],
              nextNode: nextNode.rows[0],
            };
          },
          appPool,
        );

        expect(result.inputNode.status).toBe("succeeded");
        expect(result.inputNode.output_json).toEqual({ prompt: "hello worker" });
        expect(result.nextNode.status).toBe("runnable");
        expect(nodeQueue.jobs).toHaveLength(1);
        expect(Object.keys(nodeQueue.jobs[0].data).sort()).toEqual([
          "nodeRunId",
          "tenantId",
          "traceId",
          "workflowRunId",
        ]);
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("text.generate node calls mocked AI Gateway runtime and succeeds", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          inputOutputJson: { prompt: "hello from upstream" },
          middleNodeStatus: "runnable",
        });
        const generateText = vi.fn(async () => ({
          modelKey: "mock-model",
          outputText: "generated text",
          providerKey: "mock-provider",
          providerRequest: {},
          providerResponse: {},
          status: "succeeded" as const,
          usage: {
            inputTokens: 2,
            outputTokens: 3,
            totalTokens: 5,
          },
        }));

        const service = createWorkflowService({
          nodeQueue: createFakeNodeExecuteQueue(),
          pollQueue: createFakeProviderPollQueue(),
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
          textGenerationRuntime: {
            generateText,
          },
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-text",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-text",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-text-retry",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-text-retry",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        expect(generateText).toHaveBeenCalledTimes(1);
        const nodeRun = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            return result.rows[0];
          },
          appPool,
        );
        const billing = await countBillingState(appPool, seeded.tenantId, seeded.userId);
        const billingService = new BillingService({ pool: appPool });

        const usageEventId = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ id: string }>(
              "SELECT id::text AS id FROM usage_events LIMIT 1",
            );
            return result.rows[0]?.id ?? "";
          },
          appPool,
        );
        await billingService.settleUsage(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          {
            amountCents: 0,
            idempotencyKey: `settle:${usageEventId}`,
            usageEventId,
          },
        );
        const billingAfterDuplicateSettle = await countBillingState(appPool, seeded.tenantId, seeded.userId);

        expect(nodeRun.status).toBe("succeeded");
        expect(nodeRun.output_json.text).toBe("generated text");
        expect(billing).toEqual({
          ledgerEntries: 1,
          usageEvents: 1,
        });
        expect(billingAfterDuplicateSettle).toEqual({
          ledgerEntries: 1,
          usageEvents: 1,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("image.generate sync result creates asset rows and stores AssetRef only", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          inputOutputJson: { prompt: "draw a sunrise" },
          middleNodeConfig: {
            prompt: "fallback prompt",
            routeKey: "default-image",
          },
          middleNodeStatus: "runnable",
          middleNodeType: "image.generate",
        });
        const nodeQueue = createFakeNodeExecuteQueue();
        const pollQueue = createFakeProviderPollQueue();
        const storageProvider = new MemoryStorageProvider();
        const service = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              return {
                modelKey: "image-model",
                outputs: [
                  {
                    base64: Buffer.from("fake image bytes").toString("base64"),
                    mimeType: "image/png",
                    width: 512,
                  },
                ],
                providerKey: "mock-provider",
                providerRequest: { prompt: "draw a sunrise" },
                providerResponse: { accepted: true },
                status: "succeeded",
                usage: {
                  inputTokens: 5,
                  outputTokens: 1,
                  totalTokens: 6,
                },
              };
            },
            async generateVideo() {
              throw new Error("not used");
            },
            async pollTask() {
              throw new Error("not used");
            },
          },
          nodeQueue,
          pollQueue,
          pool: appPool,
          storageProvider,
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-image",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-image",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const state = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const nodeRun = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            const asset = await client.query<{ kind: string; status: string; workflow_run_id: string; node_run_id: string }>(
              "SELECT kind, status, workflow_run_id::text AS workflow_run_id, node_run_id::text AS node_run_id FROM assets WHERE workflow_run_id = $1::uuid",
              [seeded.workflowRunId],
            );
            const outputNode = await client.query<{ status: string }>(
              "SELECT status FROM node_runs WHERE id = $1::uuid",
              [seeded.outputNodeRunId],
            );
            return {
              asset: asset.rows[0],
              nodeRun: nodeRun.rows[0],
              outputNode: outputNode.rows[0],
            };
          },
          appPool,
        );
        const billing = await countBillingState(appPool, seeded.tenantId, seeded.userId);

        expect(state.nodeRun.status).toBe("succeeded");
        expect(state.nodeRun.output_json).toEqual({
          assets: [
            expect.objectContaining({
              assetId: expect.any(String),
              kind: "image",
              mimeType: "image/png",
              width: 512,
            }),
          ],
        });
        expect(JSON.stringify(state.nodeRun.output_json)).not.toContain("base64");
        expect(state.asset).toMatchObject({
          kind: "image",
          node_run_id: seeded.middleNodeRunId,
          status: "available",
          workflow_run_id: seeded.workflowRunId,
        });
        expect(storageProvider.objects.size).toBe(1);
        expect(state.outputNode.status).toBe("runnable");
        expect(pollQueue.jobs).toHaveLength(0);
        expect(billing).toEqual({
          ledgerEntries: 1,
          usageEvents: 1,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("video.generate async result marks node waiting_provider and enqueues provider.poll with ID-only payload", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          inputOutputJson: { prompt: "animate a river" },
          middleNodeStatus: "runnable",
          middleNodeType: "video.generate",
        });
        const nodeQueue = createFakeNodeExecuteQueue();
        const pollQueue = createFakeProviderPollQueue();
        const service = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              throw new Error("not used");
            },
            async generateVideo() {
              return {
                modelKey: "video-model",
                outputs: [],
                providerKey: "mock-provider",
                providerRequest: { prompt: "animate a river" },
                providerResponse: { accepted: true },
                providerTaskId: "task-video-1",
                status: "waiting_provider",
                usage: {
                  inputTokens: 6,
                  outputTokens: null,
                  totalTokens: 6,
                },
              };
            },
            async pollTask() {
              throw new Error("not used");
            },
          },
          nodeQueue,
          pollQueue,
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-video",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-video",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const nodeRun = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ provider_task_id: string; status: string; output_json: Record<string, unknown> }>(
              "SELECT status, provider_task_id, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            return result.rows[0];
          },
          appPool,
        );

        expect(nodeRun.status).toBe("waiting_provider");
        expect(nodeRun.provider_task_id).toBe("task-video-1");
        expect(nodeRun.output_json).toEqual({
          providerTask: {
            modelId: null,
            modelKey: "video-model",
            providerId: null,
            providerKey: "mock-provider",
            providerTaskId: "task-video-1",
            routeId: null,
            routeKey: "default-media",
            status: "waiting_provider",
          },
        });
        expect(pollQueue.jobs).toHaveLength(1);
        expect(pollQueue.jobs[0]).toMatchObject({
          data: {
            nodeRunId: seeded.middleNodeRunId,
            providerTaskId: "task-video-1",
            tenantId: seeded.tenantId,
            traceId: "trace-video",
            workflowRunId: seeded.workflowRunId,
          },
        });
        expect(Object.keys(pollQueue.jobs[0].data).sort()).toEqual([
          "nodeRunId",
          "providerTaskId",
          "tenantId",
          "traceId",
          "workflowRunId",
        ]);
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("provider.poll pending re-enqueues without storing payload blobs", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          middleNodeOutputJson: {
            providerTask: {
              modelKey: "video-model",
              providerKey: "mock-provider",
              providerTaskId: "task-pending",
              routeId: "route-1",
              routeKey: "default-media",
              status: "waiting_provider",
            },
          },
          middleNodeStatus: "waiting_provider",
          middleNodeType: "video.generate",
        });
        const pollQueue = createFakeProviderPollQueue();
        const service = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              throw new Error("not used");
            },
            async generateVideo() {
              throw new Error("not used");
            },
            async pollTask() {
              return {
                providerTaskId: "task-pending",
                providerRequest: {},
                providerResponse: {},
                status: "pending",
                usage: null,
              };
            },
          },
          nodeQueue: createFakeNodeExecuteQueue(),
          pollQueue,
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        await processProviderPollJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              providerTaskId: "task-pending",
              tenantId: seeded.tenantId,
              traceId: "trace-pending",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-pending",
            queueName: QUEUE_NAMES.providerPoll,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const nodeRun = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            return result.rows[0];
          },
          appPool,
        );
        const billing = await countBillingState(appPool, seeded.tenantId, seeded.userId);

        expect(nodeRun.status).toBe("waiting_provider");
        expect(nodeRun.output_json.providerTask).toMatchObject({
          providerTaskId: "task-pending",
          status: "pending",
        });
        expect(JSON.stringify(nodeRun.output_json)).not.toContain("base64");
        expect(pollQueue.jobs).toHaveLength(1);
        expect(pollQueue.jobs[0].delay).toBeGreaterThan(0);
        expect(billing).toEqual({
          ledgerEntries: 0,
          usageEvents: 0,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("provider.poll succeeded creates asset, marks node succeeded, and unlocks downstream", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          middleNodeOutputJson: {
            providerTask: {
              modelKey: "video-model",
              providerKey: "mock-provider",
              providerTaskId: "task-success",
              routeId: "route-1",
              routeKey: "default-media",
              status: "waiting_provider",
            },
          },
          middleNodeStatus: "waiting_provider",
          middleNodeType: "video.generate",
        });
        const nodeQueue = createFakeNodeExecuteQueue();
        const service = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              throw new Error("not used");
            },
            async generateVideo() {
              throw new Error("not used");
            },
            async pollTask() {
              return {
                mimeType: "video/mp4",
                outputBase64: [Buffer.from("fake video bytes").toString("base64")],
                providerRequest: {},
                providerResponse: {},
                providerTaskId: "task-success",
                status: "succeeded",
                usage: null,
              };
            },
          },
          nodeQueue,
          pollQueue: createFakeProviderPollQueue(),
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        await processProviderPollJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              providerTaskId: "task-success",
              tenantId: seeded.tenantId,
              traceId: "trace-success",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-success",
            queueName: QUEUE_NAMES.providerPoll,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        await processProviderPollJob(
          {
            data: {
              nodeRunId: seeded.middleNodeRunId,
              providerTaskId: "task-success",
              tenantId: seeded.tenantId,
              traceId: "trace-success-retry",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-success-retry",
            queueName: QUEUE_NAMES.providerPoll,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const state = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const nodeRun = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            const outputNode = await client.query<{ status: string }>(
              "SELECT status FROM node_runs WHERE id = $1::uuid",
              [seeded.outputNodeRunId],
            );
            const assets = await client.query<{ count: number }>(
              "SELECT COUNT(*)::int AS count FROM assets WHERE workflow_run_id = $1::uuid",
              [seeded.workflowRunId],
            );
            return {
              assets: assets.rows[0]?.count ?? 0,
              nodeRun: nodeRun.rows[0],
              outputNode: outputNode.rows[0],
            };
          },
          appPool,
        );
        const billing = await countBillingState(appPool, seeded.tenantId, seeded.userId);

        expect(state.nodeRun.status).toBe("succeeded");
        expect(state.nodeRun.output_json.assets).toHaveLength(1);
        expect(JSON.stringify(state.nodeRun.output_json)).not.toContain("base64");
        expect(state.outputNode.status).toBe("runnable");
        expect(state.assets).toBe(1);
        expect(nodeQueue.jobs).toHaveLength(1);
        expect(billing).toEqual({
          ledgerEntries: 1,
          usageEvents: 1,
        });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("provider.poll failed marks node and workflow failed", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const seeded = await seedWorkflowRuntime(appPool, {
          inputNodeStatus: "succeeded",
          middleNodeOutputJson: {
            providerTask: {
              modelKey: "video-model",
              providerKey: "mock-provider",
              providerTaskId: "task-failed",
              routeId: "route-1",
              routeKey: "default-media",
              status: "waiting_provider",
            },
          },
          middleNodeStatus: "waiting_provider",
          middleNodeType: "video.generate",
        });
        const service = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              throw new Error("not used");
            },
            async generateVideo() {
              throw new Error("not used");
            },
            async pollTask() {
              return {
                error: {
                  code: "PROVIDER_FAILED",
                  message: "provider failed",
                },
                providerRequest: {},
                providerResponse: {},
                providerTaskId: "task-failed",
                status: "failed",
                usage: null,
              };
            },
          },
          nodeQueue: createFakeNodeExecuteQueue(),
          pollQueue: createFakeProviderPollQueue(),
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        await expect(
          processProviderPollJob(
            {
              data: {
                nodeRunId: seeded.middleNodeRunId,
                providerTaskId: "task-failed",
                tenantId: seeded.tenantId,
                traceId: "trace-failed",
                workflowRunId: seeded.workflowRunId,
              },
              id: "job-failed",
              queueName: QUEUE_NAMES.providerPoll,
            } as never,
            createTestLogger(),
            { executionService: service },
          ),
        ).rejects.toThrow("provider failed");

        const state = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const nodeRun = await client.query<{ status: string; error_json: Record<string, unknown> }>(
              "SELECT status, error_json FROM node_runs WHERE id = $1::uuid",
              [seeded.middleNodeRunId],
            );
            const workflowRun = await client.query<{ status: string; error_json: Record<string, unknown> }>(
              "SELECT status, error_json FROM workflow_runs WHERE id = $1::uuid",
              [seeded.workflowRunId],
            );
            return {
              nodeRun: nodeRun.rows[0],
              workflowRun: workflowRun.rows[0],
            };
          },
          appPool,
        );

        expect(state.nodeRun.status).toBe("failed");
        expect(state.workflowRun.status).toBe("failed");
        expect(state.nodeRun.error_json.message).toBe("provider failed");
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("integration harness executes input -> image.generate -> output to success", async () => {
    await withDatabase(async ({ createAppDatabaseUrl, databaseUrl }) => {
      process.env.DATABASE_URL = databaseUrl;
      const adminPool = createPgPool();
      let appPool = createPgPool();

      try {
        await runMigrations(adminPool);
        appPool = createPgPool({
          connectionString: await createAppDatabaseUrl(),
        });

        const fakeQueue = createFakeNodeExecuteQueue();
        const api = buildApp({
          env: testEnv,
          logger: false,
          pool: appPool,
          queueHealthService: {
            async close() {
              return;
            },
          } as never,
          workflowRunsService: new WorkflowRunsService({
            nodeExecuteQueue: fakeQueue.queue,
            pool: appPool,
          }),
        });

        const register = await api.inject({
          method: "POST",
          payload: {
            email: "integration-worker@example.com",
            password: "StrongPass123!",
            tenantName: "Integration Worker",
          },
          url: "/api/v2/auth/register",
        });
        expect(register.statusCode).toBe(201);
        const owner = register.json();

        const project = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            name: "Integration Project",
          },
          url: "/api/v2/projects",
        });
        const flow = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            title: "Integration Flow",
          },
          url: `/api/v2/projects/${project.json().id}/flows`,
        });
        const publish = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            graph: {
              edges: [
                { source: "input", target: "image" },
                { source: "image", target: "output" },
              ],
              nodes: [
                { id: "input", type: "input", data: { inputKey: "prompt" } },
                { id: "image", type: "image.generate", data: { routeKey: "default-media" } },
                { id: "output", type: "output" },
              ],
            },
          },
          url: `/api/v2/flows/${flow.json().id}/publish`,
        });
        expect(publish.statusCode).toBe(201);

        const createRun = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "POST",
          payload: {
            input: {
              prompt: "integration image",
            },
          },
          url: `/api/v2/flows/${flow.json().id}/runs`,
        });
        expect(createRun.statusCode).toBe(201);

        const workerService = createWorkflowService({
          mediaGenerationRuntime: {
            async generateImage() {
              return {
                modelKey: "image-model",
                outputs: [
                  {
                    base64: Buffer.from("integration image bytes").toString("base64"),
                    mimeType: "image/png",
                    width: 256,
                  },
                ],
                providerKey: "mock-provider",
                providerRequest: {},
                providerResponse: {},
                status: "succeeded",
                usage: {
                  inputTokens: 2,
                  outputTokens: 1,
                  totalTokens: 3,
                },
              };
            },
            async generateVideo() {
              throw new Error("not used");
            },
            async pollTask() {
              throw new Error("not used");
            },
          },
          nodeQueue: fakeQueue,
          pollQueue: createFakeProviderPollQueue(),
          pool: appPool,
          storageProvider: new MemoryStorageProvider(),
        });

        for (let index = 0; index < 10 && fakeQueue.jobs.length > 0; index += 1) {
          const nextJob = fakeQueue.jobs.shift();
          if (!nextJob) {
            break;
          }
          await processNodeExecuteJob(
            {
              data: nextJob.data,
              id: `job-${index + 1}`,
              queueName: QUEUE_NAMES.nodeExecute,
            } as never,
            createTestLogger(),
            { executionService: workerService },
          );
        }

        const runState = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/workflow-runs/${createRun.json().runId}`,
        });
        expect(runState.statusCode).toBe(200);
        expect(runState.json().workflowRun.status).toBe("succeeded");
        expect(runState.json().workflowRun.outputJson.assets).toHaveLength(1);
        expect(runState.json().workflowRun.outputJson.assets[0]).toMatchObject({
          kind: "image",
          mimeType: "image/png",
          width: 256,
        });

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
