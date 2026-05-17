import type { Job } from "bullmq";

import type { ProviderPollJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";
import type { WorkflowNodeExecutionService } from "../workflow-runtime/service.js";

export async function processProviderPollJob(
  job: Job<ProviderPollJobPayload>,
  logger: WorkerLogger,
  options?: {
    executionService?: WorkflowNodeExecutionService;
  },
): Promise<ProcessorResult> {
  if (options?.executionService) {
    logger.info(
      {
        jobId: job.id ?? null,
        nodeRunId: job.data.nodeRunId,
        providerTaskId: job.data.providerTaskId,
        queueName: job.queueName,
        tenantId: job.data.tenantId,
        traceId: job.data.traceId ?? null,
        workflowRunId: job.data.workflowRunId,
      },
      "processing provider.poll job",
    );
    const result = await options.executionService.pollProviderTask(job.data, logger);
    logger.info(
      {
        jobId: job.id ?? null,
        nodeRunId: job.data.nodeRunId,
        providerTaskId: job.data.providerTaskId,
        queueName: job.queueName,
        status: result.status,
        tenantId: job.data.tenantId,
        traceId: job.data.traceId ?? null,
        workflowRunId: job.data.workflowRunId,
      },
      "completed provider.poll job",
    );
    return {
      ...result,
      jobId: job.id ?? null,
    };
  }

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
