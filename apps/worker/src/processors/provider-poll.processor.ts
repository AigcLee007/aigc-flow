import type { Job } from "bullmq";

import type { ProviderPollJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";

export async function processProviderPollJob(
  job: Job<ProviderPollJobPayload>,
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
      nodeRunId: job.data.nodeRunId ?? null,
      providerTaskId: job.data.providerTaskId,
      queueName: result.queueName,
      tenantId: result.tenantId,
      traceId: result.traceId,
      workflowRunId: job.data.workflowRunId ?? null,
    },
    "processed provider.poll skeleton job",
  );

  return result;
}
