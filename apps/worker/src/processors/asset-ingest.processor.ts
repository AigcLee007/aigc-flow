import type { Job } from "bullmq";

import type { AssetIngestJobPayload } from "@aigc-flow/redis";

import type { WorkerLogger } from "../logger.js";
import type { ProcessorResult } from "./shared.js";

export async function processAssetIngestJob(
  job: Job<AssetIngestJobPayload>,
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
      assetId: job.data.assetId,
      jobId: result.jobId,
      queueName: result.queueName,
      tenantId: result.tenantId,
      traceId: result.traceId,
    },
    "processed asset.ingest skeleton job",
  );

  return result;
}
