import type { Job } from "bullmq";

import type { NodeExecuteJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";

export async function processNodeExecuteJob(
  job: Job<NodeExecuteJobPayload>,
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
      nodeRunId: job.data.nodeRunId,
      queueName: result.queueName,
      tenantId: result.tenantId,
      traceId: result.traceId,
      workflowRunId: job.data.workflowRunId,
    },
    "processed node.execute skeleton job",
  );

  return result;
}
