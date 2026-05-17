import { afterAll, describe, expect, test } from "vitest";

import {
  DEFAULT_QUEUE_PREFIX,
  QUEUE_NAMES,
  RedisLockManager,
  RedisRateLimiter,
  closeRedisConnection,
  createRedisConnection,
  resolveQueuePrefix,
  resolveRedisUrl,
} from "../src/index.js";

const originalNodeEnv = process.env.NODE_ENV;
const originalRedisUrl = process.env.REDIS_URL;
const describeWithRedis = process.env.REDIS_URL?.trim() ? describe : describe.skip;

afterAll(() => {
  if (originalNodeEnv === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = originalNodeEnv;
  }

  if (originalRedisUrl === undefined) {
    delete process.env.REDIS_URL;
  } else {
    process.env.REDIS_URL = originalRedisUrl;
  }
});

describe("@aigc-flow/redis config", () => {
  test("resolveRedisUrl reads REDIS_URL", () => {
    process.env.REDIS_URL = "redis://example.com:6380/1";
    process.env.NODE_ENV = "test";

    expect(resolveRedisUrl()).toBe("redis://example.com:6380/1");
  });

  test("resolveRedisUrl falls back to the dev default outside production", () => {
    delete process.env.REDIS_URL;
    process.env.NODE_ENV = "development";

    expect(resolveRedisUrl()).toBe("redis://localhost:6379");
  });

  test("resolveQueuePrefix uses the default v2 prefix", () => {
    expect(resolveQueuePrefix()).toBe(DEFAULT_QUEUE_PREFIX);
  });

  test("queue name constants stay stable", () => {
    expect(QUEUE_NAMES.workflowStart).toBe("workflow.start");
    expect(QUEUE_NAMES.nodeExecute).toBe("node.execute");
    expect(QUEUE_NAMES.providerPoll).toBe("provider.poll");
    expect(QUEUE_NAMES.assetIngest).toBe("asset.ingest");
    expect(QUEUE_NAMES.billingSettle).toBe("billing.settle");
    expect(QUEUE_NAMES.emailSend).toBe("email.send");
    expect(QUEUE_NAMES.auditFlush).toBe("audit.flush");
  });
});

describeWithRedis("@aigc-flow/redis integration", () => {
  test("lock acquire and release works", async () => {
    const connection = createRedisConnection();

    try {
      const key = `test:lock:${Date.now()}`;
      const lockManager = new RedisLockManager(connection);
      const firstLock = await lockManager.acquire(key, 5_000);
      expect(firstLock).not.toBeNull();

      const secondLock = await lockManager.acquire(key, 5_000);
      expect(secondLock).toBeNull();

      const released = await lockManager.release(firstLock!);
      expect(released).toBe(true);
    } finally {
      await closeRedisConnection(connection);
    }
  });

  test("rate limit basic behavior works", async () => {
    const connection = createRedisConnection();

    try {
      const key = `test:rate:${Date.now()}`;
      const limiter = new RedisRateLimiter(connection);
      const first = await limiter.consume(key, {
        limit: 2,
        windowMs: 30_000,
      });
      const second = await limiter.consume(key, {
        limit: 2,
        windowMs: 30_000,
      });
      const third = await limiter.consume(key, {
        limit: 2,
        windowMs: 30_000,
      });

      expect(first.allowed).toBe(true);
      expect(second.allowed).toBe(true);
      expect(third.allowed).toBe(false);
      expect(third.retryAfterMs).toBeGreaterThan(0);
    } finally {
      await closeRedisConnection(connection);
    }
  });
});
