import { randomUUID } from "node:crypto";

import type { Redis } from "ioredis";

export type RedisLock = {
  expiresAt: number;
  key: string;
  token: string;
  ttlMs: number;
};

const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

export class RedisLockManager {
  constructor(private readonly connection: Redis) {}

  async acquire(key: string, ttlMs: number): Promise<RedisLock | null> {
    const token = randomUUID();
    const acquired = await this.connection.set(key, token, "PX", ttlMs, "NX");

    if (acquired !== "OK") {
      return null;
    }

    return {
      expiresAt: Date.now() + ttlMs,
      key,
      token,
      ttlMs,
    };
  }

  async release(lock: RedisLock): Promise<boolean> {
    const released = await this.connection.eval(RELEASE_LOCK_SCRIPT, 1, lock.key, lock.token);
    return released === 1;
  }
}
