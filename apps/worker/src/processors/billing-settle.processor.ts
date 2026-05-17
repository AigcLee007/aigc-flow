import type { Job } from "bullmq";

import type { BillingSettleJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";

export async function processBillingSettleJob(
  job: Job<BillingSettleJobPayload>,
  logger: WorkerLogger,
): Promise<ProcessorResult> {
  const result: ProcessorResult = {
    jobId: job.id ?? null,
    queueName: job.queueName,
    status: "no-op",
    tenantId: job.data.tenantId,
    traceId: job.data.traceId ?? null,
  };

  logger.info(
    {
      jobId: result.jobId,
      queueName: result.queueName,
      tenantId: result.tenantId,
      traceId: result.traceId,
      usageEventId: job.data.usageEventId,
    },
    "processed billing.settle skeleton job",
  );

  return result;
}
