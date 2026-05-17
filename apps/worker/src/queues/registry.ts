import type { QueueEvents, Worker } from "bullmq";

import { QUEUE_NAMES, type QueueName } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import { processAssetIngestJob } from "../processors/asset-ingest.processor.js";
import { processBillingSettleJob } from "../processors/billing-settle.processor.js";
import { processNodeExecuteJob } from "../processors/node-execute.processor.js";
import { processProviderPollJob } from "../processors/provider-poll.processor.js";
import { processWorkflowStartJob } from "../processors/workflow-start.processor.js";

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

export function registerWorkerQueues(options: {
  concurrency: number;
  logger: WorkerLogger;
  queueFactory: QueueFactoryLike;
}) {
  const workers: Closable[] = [];
  const queueEvents: Closable[] = [];

  const processors = {
    [QUEUE_NAMES.assetIngest]: processAssetIngestJob,
    [QUEUE_NAMES.billingSettle]: processBillingSettleJob,
    [QUEUE_NAMES.nodeExecute]: processNodeExecuteJob,
    [QUEUE_NAMES.providerPoll]: processProviderPollJob,
    [QUEUE_NAMES.workflowStart]: processWorkflowStartJob,
  } as const;

  for (const queueName of WORKER_QUEUE_NAMES) {
    const queueEventsInstance = options.queueFactory.createQueueEvents(queueName);
    queueEvents.push(queueEventsInstance);

    const worker = options.queueFactory.createWorker(
      queueName,
      async (job) => {
        try {
          return await processors[queueName](job as never, options.logger);
        } catch (error) {
          const typedJob = job as {
            data?: {
              tenantId?: string;
              traceId?: string;
            };
            id?: string | null;
          };
          options.logger.error(
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
      },
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
