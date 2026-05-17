import { resolveQueuePrefix, resolveRedisUrl } from "@aigc-flow/redis";

export type WorkerEnv = {
  credentialKeyVersion: string;
  credentialMasterKey: string;
  nodeEnv: string;
  queuePrefix: string;
  redisUrl: string;
  s3AccessKeyId: string;
  s3Bucket: string;
  s3Endpoint: string;
  s3ForcePathStyle: boolean;
  s3Region: string;
  s3SecretAccessKey: string;
  workerConcurrency: number;
  workerName: string;
};

const DEV_CREDENTIAL_KEY_VERSION = "v1";
const DEV_CREDENTIAL_MASTER_KEY = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=";
const DEV_S3_ACCESS_KEY_ID = "minio";
const DEV_S3_BUCKET = "aigc-flow-dev";
const DEV_S3_ENDPOINT = "http://localhost:9000";
const DEV_S3_REGION = "us-east-1";
const DEV_S3_SECRET_ACCESS_KEY = "minio123456";
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
  const s3Endpoint =
    process.env.S3_ENDPOINT?.trim() ||
    (isProduction ? "" : DEV_S3_ENDPOINT);
  const s3Region =
    process.env.S3_REGION?.trim() ||
    (isProduction ? "" : DEV_S3_REGION);
  const s3Bucket =
    process.env.S3_BUCKET?.trim() ||
    (isProduction ? "" : DEV_S3_BUCKET);
  const s3AccessKeyId =
    process.env.S3_ACCESS_KEY_ID?.trim() ||
    (isProduction ? "" : DEV_S3_ACCESS_KEY_ID);
  const s3SecretAccessKey =
    process.env.S3_SECRET_ACCESS_KEY?.trim() ||
    (isProduction ? "" : DEV_S3_SECRET_ACCESS_KEY);
  const s3ForcePathStyleRaw = process.env.S3_FORCE_PATH_STYLE?.trim();
  const workerConcurrencyRaw = process.env.WORKER_CONCURRENCY?.trim() || "";
  const workerConcurrency = workerConcurrencyRaw ? Number(workerConcurrencyRaw) : DEFAULT_WORKER_CONCURRENCY;

  if (!Number.isInteger(workerConcurrency) || workerConcurrency <= 0) {
    throw new Error("WORKER_CONCURRENCY must be a positive integer when provided");
  }

  if (!credentialMasterKey) {
    throw new Error("CREDENTIAL_MASTER_KEY is required to start the v2 worker");
  }
  if (!s3Endpoint) {
    throw new Error("S3_ENDPOINT is required to start the v2 worker");
  }
  if (!s3Region) {
    throw new Error("S3_REGION is required to start the v2 worker");
  }
  if (!s3Bucket) {
    throw new Error("S3_BUCKET is required to start the v2 worker");
  }
  if (!s3AccessKeyId) {
    throw new Error("S3_ACCESS_KEY_ID is required to start the v2 worker");
  }
  if (!s3SecretAccessKey) {
    throw new Error("S3_SECRET_ACCESS_KEY is required to start the v2 worker");
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
    s3AccessKeyId,
    s3Bucket,
    s3Endpoint,
    s3ForcePathStyle: s3ForcePathStyleRaw === undefined
      ? true
      : s3ForcePathStyleRaw.toLowerCase() === "true",
    s3Region,
    s3SecretAccessKey,
    workerConcurrency,
    workerName: process.env.WORKER_NAME?.trim() || DEFAULT_WORKER_NAME,
  };
}
