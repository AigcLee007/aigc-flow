import { Pool, type PoolConfig } from "pg";

export function getDatabaseUrl(): string {
  const value = process.env.DATABASE_URL?.trim();
  if (!value) {
    throw new Error("DATABASE_URL is required to run v2 PostgreSQL migrations");
  }
  return value;
}

export function createPgPool(config: PoolConfig = {}): Pool {
  return new Pool({
    connectionString: getDatabaseUrl(),
    ...config,
  });
}
