import { Redis, type RedisOptions } from "ioredis";

export const DEFAULT_DEV_REDIS_URL = "redis://localhost:6379";
export const DEFAULT_QUEUE_PREFIX = "aigc-flow:v2";

export type RedisConnectionOptions = {
  redisUrl: string;
} & RedisOptions;

export function resolveRedisUrl(options?: {
  nodeEnv?: string;
  redisUrl?: string | null;
}): string {
  const nodeEnv = options?.nodeEnv?.trim() || process.env.NODE_ENV?.trim() || "development";
  const isProduction = nodeEnv === "production";
  const redisUrl = options?.redisUrl?.trim() || process.env.REDIS_URL?.trim() || "";

  if (redisUrl) {
    return redisUrl;
  }

  if (isProduction) {
    throw new Error("REDIS_URL is required to start Redis-backed v2 services");
  }

  return DEFAULT_DEV_REDIS_URL;
}

export function resolveQueuePrefix(queuePrefix?: string | null): string {
  const value = queuePrefix?.trim() || process.env.QUEUE_PREFIX?.trim() || "";
  return value || DEFAULT_QUEUE_PREFIX;
}

export function createRedisConnection(options?: Partial<RedisConnectionOptions>): Redis {
  const { redisUrl: redisUrlOverride, ...redisOptions } = options ?? {};
  const redisUrl = resolveRedisUrl({
    nodeEnv: process.env.NODE_ENV,
    redisUrl: redisUrlOverride,
  });

  return new Redis(redisUrl, {
    lazyConnect: redisOptions.lazyConnect ?? false,
    maxRetriesPerRequest: redisOptions.maxRetriesPerRequest ?? null,
    ...redisOptions,
  });
}

export async function closeRedisConnection(connection: Redis): Promise<void> {
  try {
    await connection.quit();
  } catch {
    connection.disconnect();
  }
}
