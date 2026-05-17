import { fileURLToPath } from "node:url";

import { CredentialVault, DatabaseTextGenerationRuntime } from "@aigc-flow/ai-gateway-core";
import { createPgPool } from "@aigc-flow/db";
import {
  closeRedisConnection,
  createQueueFactory,
  createRedisConnection,
  QUEUE_NAMES,
  type NodeExecuteJobPayload,
  type QueueName,
} from "@aigc-flow/redis";
import type { Redis } from "ioredis";
import type { Pool } from "pg";

import { getWorkerEnv, type WorkerEnv } from "./config/env.js";
import { createConsoleWorkerLogger, type WorkerLogger } from "./logger.js";
import { registerWorkerQueues } from "./queues/registry.js";
import { WorkflowNodeExecutionService } from "./workflow-runtime/service.js";

type Closable = {
  close: () => Promise<unknown>;
};

type QueueFactoryLike = {
  createQueue: (
    name: QueueName,
  ) => {
    add: (name: string, data: NodeExecuteJobPayload) => Promise<unknown>;
    close: () => Promise<unknown>;
  };
  createQueueEvents: (name: QueueName) => Closable;
  createWorker: (
    name: QueueName,
    processor: (job: unknown) => Promise<unknown>,
    options: { concurrency: number },
  ) => Closable;
};

export type WorkerRuntime = {
  queueNames: string[];
  shutdown: () => Promise<void>;
};

export function createWorkerRuntime(options?: {
  env?: WorkerEnv;
  logger?: WorkerLogger;
  pool?: Pool;
  queueFactory?: QueueFactoryLike;
  redisConnection?: Redis;
  workflowNodeExecutionService?: WorkflowNodeExecutionService;
}) {
  const env = options?.env ?? getWorkerEnv();
  const logger = options?.logger ?? createConsoleWorkerLogger();
  const ownedPool = !options?.pool;
  const ownedRedisConnection = !options?.redisConnection;
  const pool = options?.pool ?? createPgPool();
  const redisConnection =
    options?.redisConnection ??
    createRedisConnection({
      redisUrl: env.redisUrl,
    });
  const queueFactory =
    options?.queueFactory ??
    createQueueFactory({
      connection: redisConnection,
      prefix: env.queuePrefix,
    });
  const credentialVault = new CredentialVault({
    keyVersion: env.credentialKeyVersion,
    masterKey: env.credentialMasterKey,
  });
  const nodeExecuteQueue = queueFactory.createQueue(QUEUE_NAMES.nodeExecute);
  const workflowNodeExecutionService =
    options?.workflowNodeExecutionService ??
    new WorkflowNodeExecutionService({
      nodeExecuteQueue,
      pool,
      textGenerationRuntime: new DatabaseTextGenerationRuntime({
        credentialVault,
        pool,
      }),
    });

  const registration = registerWorkerQueues({
    concurrency: env.workerConcurrency,
    logger,
    queueFactory,
    workflowNodeExecutionService,
  });

  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    logger.info(
      {
        queueCount: registration.queueNames.length,
        workerName: env.workerName,
      },
      "shutting down worker runtime",
    );

    await Promise.all(registration.workers.map((worker) => worker.close()));
    await Promise.all(registration.queueEvents.map((queueEvents) => queueEvents.close()));
    await nodeExecuteQueue.close();

    if (ownedRedisConnection) {
      await closeRedisConnection(redisConnection);
    }

    if (ownedPool) {
      await pool.end();
    }
  }

  return {
    queueNames: registration.queueNames,
    shutdown,
  } satisfies WorkerRuntime;
}

async function main() {
  const env = getWorkerEnv();
  const logger = createConsoleWorkerLogger();
  const runtime = createWorkerRuntime({
    env,
    logger,
  });

  logger.info(
    {
      queueNames: runtime.queueNames,
      queuePrefix: env.queuePrefix,
      workerConcurrency: env.workerConcurrency,
      workerName: env.workerName,
    },
    "v2 worker runtime ready",
  );

  const shutdownAndExit = async (signal: string) => {
    logger.info(
      {
        signal,
        workerName: env.workerName,
      },
      "received worker shutdown signal",
    );

    try {
      await runtime.shutdown();
      process.exit(0);
    } catch (error) {
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          signal,
          workerName: env.workerName,
        },
        "worker shutdown failed",
      );
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdownAndExit("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdownAndExit("SIGTERM");
  });

  if (process.env.WORKER_ONESHOT === "true") {
    await runtime.shutdown();
    return;
  }

  process.stdin.resume();
}

const isDirectExecution = process.argv[1]
  ? fileURLToPath(import.meta.url) === process.argv[1]
  : false;

if (isDirectExecution) {
  void main();
}
