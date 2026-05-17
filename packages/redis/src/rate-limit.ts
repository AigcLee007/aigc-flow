import type { Redis } from "ioredis";

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  retryAfterMs: number;
};

export class RedisRateLimiter {
  constructor(private readonly connection: Redis) {}

  async consume(key: string, options: RateLimitOptions): Promise<RateLimitResult> {
    const total = await this.connection.incr(key);

    if (total === 1) {
      await this.connection.pexpire(key, options.windowMs);
    }

    const ttlMs = Math.max(await this.connection.pttl(key), 0);
    const remaining = Math.max(options.limit - total, 0);

    return {
      allowed: total <= options.limit,
      remaining,
      resetAt: Date.now() + ttlMs,
      retryAfterMs: total <= options.limit ? 0 : ttlMs,
    };
  }
}
