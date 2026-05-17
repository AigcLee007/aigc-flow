import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, test, vi } from "vitest";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import { QUEUE_NAMES, type NodeExecuteJobPayload } from "@aigc-flow/redis";

import type { ApiEnv } from "../../api/src/config/env.js";
import { buildApp } from "../../api/src/app.js";
import { WorkflowRunsService } from "../../api/src/modules/workflow-runs/workflow-runs.service.js";
import { createWorkerRuntime } from "../src/main.js";
import type { WorkerLogger } from "../src/logger.js";
import { WORKER_QUEUE_NAMES } from "../src/queues/registry.js";
import { processWorkflowStartJob } from "../src/processors/workflow-start.processor.js";
import { processNodeExecuteJob } from "../src/processors/node-execute.processor.js";
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

afterAll(() => {
  if (originalDatabaseUrl === undefined) {
    delete process.env.DATABASE_URL;
  } else {
    process.env.DATABASE_URL = originalDatabaseUrl;
  }
});

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

async function seedWorkflowRuntime(
  pool: ReturnType<typeof createPgPool>,
  options?: {
    inputNodeStatus?: string;
    inputOutputJson?: Record<string, unknown> | null;
    outputNodeStatus?: string;
    textNodeStatus?: string;
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
  const textNodeRunId = randomUUID();
  const outputNodeRunId = randomUUID();

  const compiledGraph = {
    edges: [
      { source: "input", target: "text" },
      { source: "text", target: "output" },
    ],
    entryNodeIds: ["input"],
    nodes: [
      {
        config: {
          inputKey: "prompt",
        },
        dependencies: [],
        dependents: ["text"],
        id: "input",
        type: "input",
      },
      {
        config: {
          routeKey: "default-text",
          systemPrompt: "You are helpful.",
        },
        dependencies: ["input"],
        dependents: ["output"],
        id: "text",
        type: "text.generate",
      },
      {
        config: {},
        dependencies: ["text"],
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
          updated_at
        )
        VALUES
          ($1::uuid, $2::uuid, $3::uuid, 'input', 'input', $4, $5::jsonb, now()),
          ($6::uuid, $2::uuid, $3::uuid, 'text', 'text.generate', $7, NULL, now()),
          ($8::uuid, $2::uuid, $3::uuid, 'output', 'output', $9, NULL, now())
      `,
      [
        inputNodeRunId,
        tenantId,
        workflowRunId,
        options?.inputNodeStatus ?? "runnable",
        options?.inputOutputJson ? JSON.stringify(options.inputOutputJson) : null,
        textNodeRunId,
        options?.textNodeStatus ?? "pending",
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
    outputNodeRunId,
    projectId,
    tenantId,
    textNodeRunId,
    userId,
    workflowRunId,
  };
}

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
    expect(queueClose).toHaveBeenCalledTimes(1);
  });
});

describeWithDatabase("workflow node execution", () => {
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
        const fakeQueue = createFakeNodeExecuteQueue();
        const service = new WorkflowNodeExecutionService({
          nodeExecuteQueue: fakeQueue.queue,
          pool: appPool,
          textGenerationRuntime: {
            async generateText() {
              return {
                modelKey: "mock-model",
                outputText: "hello",
                providerKey: "mock-provider",
                providerRequest: {},
                providerResponse: {},
                status: "succeeded" as const,
                usage: {
                  inputTokens: 1,
                  outputTokens: 1,
                  totalTokens: 2,
                },
              };
            },
          },
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
            const textNode = await client.query<{ id: string; status: string }>(
              "SELECT id::text AS id, status FROM node_runs WHERE id = $1::uuid",
              [seeded.textNodeRunId],
            );
            return {
              inputNode: inputNode.rows[0],
              textNode: textNode.rows[0],
            };
          },
          appPool,
        );

        expect(result.inputNode.status).toBe("succeeded");
        expect(result.inputNode.output_json).toEqual({ prompt: "hello worker" });
        expect(result.textNode.status).toBe("runnable");
        expect(fakeQueue.jobs).toHaveLength(1);
        expect(Object.keys(fakeQueue.jobs[0].data).sort()).toEqual([
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
          textNodeStatus: "runnable",
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

        const service = new WorkflowNodeExecutionService({
          nodeExecuteQueue: createFakeNodeExecuteQueue().queue,
          pool: appPool,
          textGenerationRuntime: {
            generateText,
          },
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.textNodeRunId,
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

        expect(generateText).toHaveBeenCalledTimes(1);
        const nodeRun = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM node_runs WHERE id = $1::uuid",
              [seeded.textNodeRunId],
            );
            return result.rows[0];
          },
          appPool,
        );

        expect(nodeRun.status).toBe("succeeded");
        expect(nodeRun.output_json.text).toBe("generated text");
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("output node finalizes workflow run", async () => {
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
          outputNodeStatus: "runnable",
          textNodeStatus: "succeeded",
        });

        await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            await client.query(
              `
                UPDATE node_runs
                SET output_json = $2::jsonb
                WHERE id = $1::uuid
              `,
              [seeded.textNodeRunId, JSON.stringify({ text: "final text" })],
            );
          },
          appPool,
        );

        const service = new WorkflowNodeExecutionService({
          nodeExecuteQueue: createFakeNodeExecuteQueue().queue,
          pool: appPool,
          textGenerationRuntime: {
            async generateText() {
              throw new Error("should not be called");
            },
          },
        });

        await processNodeExecuteJob(
          {
            data: {
              nodeRunId: seeded.outputNodeRunId,
              tenantId: seeded.tenantId,
              traceId: "trace-output",
              workflowRunId: seeded.workflowRunId,
            },
            id: "job-output",
            queueName: QUEUE_NAMES.nodeExecute,
          } as never,
          createTestLogger(),
          { executionService: service },
        );

        const workflowRun = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const result = await client.query<{ status: string; output_json: Record<string, unknown> }>(
              "SELECT status, output_json FROM workflow_runs WHERE id = $1::uuid",
              [seeded.workflowRunId],
            );
            return result.rows[0];
          },
          appPool,
        );

        expect(workflowRun.status).toBe("succeeded");
        expect(workflowRun.output_json).toEqual({ text: "final text" });
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("failed text.generate marks node and workflow failed", async () => {
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
          textNodeStatus: "runnable",
        });

        const service = new WorkflowNodeExecutionService({
          nodeExecuteQueue: createFakeNodeExecuteQueue().queue,
          pool: appPool,
          textGenerationRuntime: {
            async generateText() {
              throw new Error("mock generation failure");
            },
          },
        });

        await expect(
          processNodeExecuteJob(
            {
              data: {
                nodeRunId: seeded.textNodeRunId,
                tenantId: seeded.tenantId,
                traceId: "trace-failed",
                workflowRunId: seeded.workflowRunId,
              },
              id: "job-failed",
              queueName: QUEUE_NAMES.nodeExecute,
            } as never,
            createTestLogger(),
            { executionService: service },
          ),
        ).rejects.toThrow("mock generation failure");

        const state = await withTenantTransaction(
          { tenantId: seeded.tenantId, userId: seeded.userId },
          async (client) => {
            const nodeRun = await client.query<{ status: string; error_json: Record<string, unknown> }>(
              "SELECT status, error_json FROM node_runs WHERE id = $1::uuid",
              [seeded.textNodeRunId],
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
        expect(state.nodeRun.error_json.message).toBe("mock generation failure");
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });

  test("integration harness executes input -> text.generate -> output to success", async () => {
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
                { source: "input", target: "text" },
                { source: "text", target: "output" },
              ],
              nodes: [
                { id: "input", type: "input", data: { inputKey: "prompt" } },
                { id: "text", type: "text.generate", data: { routeKey: "default-text" } },
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
              prompt: "integration hello",
            },
          },
          url: `/api/v2/flows/${flow.json().id}/runs`,
        });
        expect(createRun.statusCode).toBe(201);

        const workerService = new WorkflowNodeExecutionService({
          nodeExecuteQueue: fakeQueue.queue,
          pool: appPool,
          textGenerationRuntime: {
            async generateText() {
              return {
                modelKey: "mock-model",
                outputText: "integration result",
                providerKey: "mock-provider",
                providerRequest: {},
                providerResponse: {},
                status: "succeeded" as const,
                usage: {
                  inputTokens: 2,
                  outputTokens: 2,
                  totalTokens: 4,
                },
              };
            },
          },
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
        expect(runState.json().workflowRun.outputJson.text).toBe("integration result");

        const events = await api.inject({
          headers: {
            authorization: `Bearer ${owner.accessToken}`,
          },
          method: "GET",
          url: `/api/v2/workflow-runs/${createRun.json().runId}/events`,
        });
        const sequences = events.json().map((row: { sequence: number }) => row.sequence);
        expect(sequences).toEqual([...sequences].sort((a, b) => a - b));

        await api.close();
      } finally {
        await appPool.end();
        await adminPool.end();
      }
    });
  });
});
