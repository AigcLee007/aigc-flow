import type { Job } from "bullmq";

import type { NodeExecuteJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";
import type { WorkflowNodeExecutionService } from "../workflow-runtime/service.js";

export async function processNodeExecuteJob(
  job: Job<NodeExecuteJobPayload>,
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
        queueName: job.queueName,
        tenantId: job.data.tenantId,
        traceId: job.data.traceId ?? null,
        workflowRunId: job.data.workflowRunId,
      },
      "processing node.execute job",
    );
    const result = await options.executionService.executeNode(job.data, logger);
    logger.info(
      {
        jobId: job.id ?? null,
        nodeRunId: job.data.nodeRunId,
        queueName: job.queueName,
        status: result.status,
        tenantId: job.data.tenantId,
        traceId: job.data.traceId ?? null,
        workflowRunId: job.data.workflowRunId,
      },
      "completed node.execute job",
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
