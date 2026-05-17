import { resolveQueuePrefix, resolveRedisUrl } from "@aigc-flow/redis";

export type WorkerEnv = {
  credentialKeyVersion: string;
  credentialMasterKey: string;
  nodeEnv: string;
  queuePrefix: string;
  redisUrl: string;
  workerConcurrency: number;
  workerName: string;
};

const DEV_CREDENTIAL_KEY_VERSION = "v1";
const DEV_CREDENTIAL_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const DEFAULT_WORKER_CONCURRENCY = 2;
const DEFAULT_WORKER_NAME = "aigc-flow-v2-worker";

export function getWorkerEnv(): WorkerEnv {
  const nodeEnv = process.env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const credentialMasterKey =
    process.env.CREDENTIAL_MASTER_KEY?.trim() ||
    (isProduction ? "" : DEV_CREDENTIAL_MASTER_KEY);
  const credentialKeyVersion =
    process.env.CREDENTIAL_KEY_VERSION?.trim() ||
    DEV_CREDENTIAL_KEY_VERSION;
  const workerConcurrencyRaw = process.env.WORKER_CONCURRENCY?.trim() || "";
  const workerConcurrency = workerConcurrencyRaw ? Number(workerConcurrencyRaw) : DEFAULT_WORKER_CONCURRENCY;

  if (!Number.isInteger(workerConcurrency) || workerConcurrency <= 0) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer when provided");
  }

  if (!credentialMasterKey) {
    throw new Error("CREDENTIAL_MASTER_KEY is required to start the v2 worker");
  }

  return {
    credentialKeyVersion,
    credentialMasterKey,
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
