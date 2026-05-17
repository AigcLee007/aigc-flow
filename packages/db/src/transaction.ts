import type { Pool, PoolClient } from "pg";

import { createPgPool } from "./db.js";

export type TenantDbContext = {
  tenantId: string;
  userId?: string | null;
};

let sharedPool: Pool | null = null;

function getSharedPgPool(): Pool {
  if (!sharedPool) {
    sharedPool = createPgPool();
  }
  return sharedPool;
}

export async function withTenantTransaction<T>(
  ctx: TenantDbContext,
  fn: (client: PoolClient) => Promise<T>,
  pool: Pool = getSharedPgPool(),
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [ctx.tenantId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId ?? ""]);

    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
