import { describe, expect, test, vi } from "vitest";

import { QUEUE_NAMES } from "@aigc-flow/redis";

import { createWorkerRuntime } from "../src/main.js";
import type { WorkerLogger } from "../src/logger.js";
import { WORKER_QUEUE_NAMES } from "../src/queues/registry.js";
import { processWorkflowStartJob } from "../src/processors/workflow-start.processor.js";

describe("worker skeleton", () => {
  test("registers the expected queue names", () => {
    const workerClose = vi.fn(async () => {});
    const eventsClose = vi.fn(async () => {});
    const createdQueues: string[] = [];

    const runtime = createWorkerRuntime({
      env: {
        nodeEnv: "test",
        queuePrefix: "test-prefix",
        redisUrl: "redis://localhost:6379",
        workerConcurrency: 2,
        workerName: "test-worker",
      },
      logger: {
        error() {
          return;
        },
        info() {
          return;
        },
      },
      queueFactory: {
        createQueueEvents(name: string) {
          createdQueues.push(`events:${name}`);
          return { close: eventsClose };
        },
        createWorker(name: string) {
          createdQueues.push(`worker:${name}`);
          return { close: workerClose };
        },
      },
    });

    expect(runtime.queueNames).toEqual([...WORKER_QUEUE_NAMES]);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.workflowStart}`);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.nodeExecute}`);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.providerPoll}`);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.assetIngest}`);
    expect(createdQueues).toContain(`worker:${QUEUE_NAMES.billingSettle}`);
  });

  test("processor skeleton returns a no-op result with tenantId and traceId", async () => {
    const logs: Array<{ fields: Record<string, unknown>; message: string }> = [];
    const logger: WorkerLogger = {
      error() {
        return;
      },
      info(fields, message) {
        logs.push({ fields, message });
      },
    };

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
      logger,
    );

    expect(result).toEqual({
      jobId: "job-1",
      queueName: QUEUE_NAMES.workflowStart,
      status: "no-op",
      tenantId: "tenant-1",
      traceId: "trace-1",
    });
    expect(logs[0]?.fields.tenantId).toBe("tenant-1");
    expect(logs[0]?.fields.traceId).toBe("trace-1");
  });

  test("graceful shutdown closes worker resources", async () => {
    const workerClose = vi.fn(async () => {});
    const eventsClose = vi.fn(async () => {});

    const runtime = createWorkerRuntime({
      env: {
        nodeEnv: "test",
        queuePrefix: "test-prefix",
        redisUrl: "redis://localhost:6379",
        workerConcurrency: 2,
        workerName: "test-worker",
      },
      logger: {
        error() {
          return;
        },
        info() {
          return;
        },
      },
      queueFactory: {
        createQueueEvents() {
          return { close: eventsClose };
        },
        createWorker() {
          return { close: workerClose };
        },
      },
    });

    await runtime.shutdown();

    expect(workerClose).toHaveBeenCalledTimes(WORKER_QUEUE_NAMES.length);
    expect(eventsClose).toHaveBeenCalledTimes(WORKER_QUEUE_NAMES.length);
  });
});
