import { resolveQueuePrefix, resolveRedisUrl } from "@aigc-flow/redis";

export type WorkerEnv = {
  nodeEnv: string;
  queuePrefix: string;
  redisUrl: string;
  workerConcurrency: number;
  workerName: string;
};

const DEFAULT_WORKER_CONCURRENCY = 2;
const DEFAULT_WORKER_NAME = "aigc-flow-v2-worker";

export function getWorkerEnv(): WorkerEnv {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const workerConcurrencyRaw = process.env.WORKER_CONCURRENCY?.trim() || "";
  const workerConcurrency = workerConcurrencyRaw ? Number(workerConcurrencyRaw) : DEFAULT_WORKER_CONCURRENCY;

  if (!Number.isInteger(workerConcurrency) || workerConcurrency <= 0) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer when provided");
  }

  return {
    nodeEnv,
    queuePrefix: resolveQueuePrefix(process.env.QUEUE_PREFIX),
    redisUrl: resolveRedisUrl({
      nodeEnv,
      redisUrl: process.env.REDIS_URL,
    }),
    workerConcurrency,
    workerName: process.env.WORKER_NAME?.trim() || DEFAULT_WORKER_NAME,
  };
}
