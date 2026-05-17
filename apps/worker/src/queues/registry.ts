import type { QueueEvents, Worker } from "bullmq";

import { QUEUE_NAMES, type QueueName } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import { processAssetIngestJob } from "../processors/asset-ingest.processor.js";
import { processBillingSettleJob } from "../processors/billing-settle.processor.js";
import { processNodeExecuteJob } from "../processors/node-execute.processor.js";
import { processProviderPollJob } from "../processors/provider-poll.processor.js";
import { processWorkflowStartJob } from "../processors/workflow-start.processor.js";
import type { WorkflowNodeExecutionService } from "../workflow-runtime/service.js";

type Closable = {
  close: () => Promise<unknown>;
};

type QueueFactoryLike = {
  createQueueEvents: (name: QueueName) => QueueEvents | Closable;
  createWorker: (
    name: QueueName,
    processor: (job: unknown) => Promise<unknown>,
    options: { concurrency: number },
  ) => Worker | Closable;
};

export const WORKER_QUEUE_NAMES = [
  QUEUE_NAMES.workflowStart,
  QUEUE_NAMES.nodeExecute,
  QUEUE_NAMES.providerPoll,
  QUEUE_NAMES.assetIngest,
  QUEUE_NAMES.billingSettle,
] as const;

function withWorkerErrorLogging(
  queueName: QueueName,
  logger: WorkerLogger,
  processor: (job: unknown) => Promise<unknown>,
) {
  return async (job: unknown) => {
    try {
      return await processor(job);
    } catch (error) {
      const typedJob = job as {
        data?: {
          tenantId?: string;
          traceId?: string;
        };
        id?: string | null;
      };
      logger.error(
        {
          err: error instanceof Error ? error.message : String(error),
          jobId: typedJob.id ?? null,
          queueName,
          tenantId: typedJob.data?.tenantId ?? null,
          traceId: typedJob.data?.traceId ?? null,
        },
        "worker skeleton job failed",
      );
      throw error;
    }
  };
}

export function registerWorkerQueues(options: {
  concurrency: number;
  logger: WorkerLogger;
  queueFactory: QueueFactoryLike;
  workflowNodeExecutionService?: WorkflowNodeExecutionService;
}) {
  const workers: Closable[] = [];
  const queueEvents: Closable[] = [];

  for (const queueName of WORKER_QUEUE_NAMES) {
    const queueEventsInstance = options.queueFactory.createQueueEvents(queueName);
    queueEvents.push(queueEventsInstance);

    const processor =
      queueName === QUEUE_NAMES.workflowStart
        ? (job: unknown) => processWorkflowStartJob(job as never, options.logger)
        : queueName === QUEUE_NAMES.nodeExecute
          ? (job: unknown) =>
              processNodeExecuteJob(job as never, options.logger, {
                executionService: options.workflowNodeExecutionService,
              })
          : queueName === QUEUE_NAMES.providerPoll
            ? (job: unknown) => processProviderPollJob(job as never, options.logger)
            : queueName === QUEUE_NAMES.assetIngest
              ? (job: unknown) => processAssetIngestJob(job as never, options.logger)
              : (job: unknown) => processBillingSettleJob(job as never, options.logger);

    const worker = options.queueFactory.createWorker(
      queueName,
      withWorkerErrorLogging(queueName, options.logger, processor),
      {
        concurrency: options.concurrency,
      },
    );

    workers.push(worker);
  }

  return {
    queueEvents,
    queueNames: [...WORKER_QUEUE_NAMES],
    workers,
  };
}
