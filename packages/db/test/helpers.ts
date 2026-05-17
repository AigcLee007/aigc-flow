import { randomUUID } from "node:crypto";
import { Client, type Pool, type PoolClient } from "pg";

export function hasDatabaseEnv(): boolean {
  return Boolean(
    process.env.DATABASE_URL?.trim() || process.env.TEST_DATABASE_ADMIN_URL?.trim(),
  );
}

export function getAdminDatabaseUrl(): string {
  const raw =
    process.env.TEST_DATABASE_ADMIN_URL?.trim() ||
    process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error(
      "DATABASE_URL or TEST_DATABASE_ADMIN_URL is required for database tests",
    );
  }
  const url = new URL(raw);
  if (!process.env.TEST_DATABASE_ADMIN_URL) {
    url.pathname = "/postgres";
  }
  return url.toString();
}

export function getTestDatabaseUrl(databaseName: string): string {
  const raw = process.env.DATABASE_URL?.trim();
  if (!raw) {
    throw new Error("DATABASE_URL is required for database tests");
  }
  const url = new URL(raw);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function getDatabaseName(databaseUrl: string): string {
  const databaseName = new URL(databaseUrl).pathname.replace(/^\//, "");
  if (!databaseName) {
    throw new Error(`Could not determine database name from URL: ${databaseUrl}`);
  }
  return databaseName;
}

async function createDatabase(databaseName: string): Promise<void> {
  const client = new Client({ connectionString: getAdminDatabaseUrl() });
  await client.connect();
  try {
    await client.query(`CREATE DATABASE "${databaseName}"`);
  } finally {
    await client.end();
  }
}

async function dropDatabase(databaseName: string): Promise<void> {
  const client = new Client({ connectionString: getAdminDatabaseUrl() });
  await client.connect();
  try {
    await client.query(
      `
        SELECT pg_terminate_backend(pid)
        FROM pg_stat_activity
        WHERE datname = $1
          AND pid <> pg_backend_pid()
      `,
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS "${databaseName}"`);
  } finally {
    await client.end();
  }
}

export async function withDatabase<T>(
  run: (context: {
    createAppDatabaseUrl: () => Promise<string>;
    databaseUrl: string;
  }) => Promise<T>,
): Promise<T> {
  const databaseName = `aigc_flow_test_${randomUUID().replace(/-/g, "")}`;
  await createDatabase(databaseName);
  const createdRoles: string[] = [];
  const databaseUrl = getTestDatabaseUrl(databaseName);

  try {
    return await run({
      createAppDatabaseUrl: async () => {
        const roleName = `aigc_flow_app_${randomUUID().replace(/-/g, "")}`;
        const password = randomUUID();
        const adminClient = new Client({ connectionString: getAdminDatabaseUrl() });
        await adminClient.connect();
        try {
          await adminClient.query(
            `CREATE ROLE "${roleName}" WITH LOGIN PASSWORD '${password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT`,
          );
          await adminClient.query(
            `GRANT CONNECT ON DATABASE "${databaseName}" TO "${roleName}"`,
          );
        } finally {
          await adminClient.end();
        }

        const databaseAdminClient = new Client({ connectionString: databaseUrl });
        await databaseAdminClient.connect();
        try {
          await databaseAdminClient.query(`GRANT USAGE ON SCHEMA public TO "${roleName}"`);
          await databaseAdminClient.query(`GRANT USAGE ON SCHEMA app TO "${roleName}"`);
          await databaseAdminClient.query(
            `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO "${roleName}"`,
          );
          await databaseAdminClient.query(
            `GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO "${roleName}"`,
          );
          await databaseAdminClient.query(
            `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA app TO "${roleName}"`,
          );
        } finally {
          await databaseAdminClient.end();
        }

        createdRoles.push(roleName);
        const appUrl = new URL(databaseUrl);
        appUrl.username = roleName;
        appUrl.password = password;
        return appUrl.toString();
      },
      databaseUrl,
    });
  } finally {
    await dropDatabase(databaseName);
    for (const roleName of createdRoles) {
      const adminClient = new Client({ connectionString: getAdminDatabaseUrl() });
      await adminClient.connect();
      try {
        await adminClient.query(`DROP ROLE IF EXISTS "${roleName}"`);
      } finally {
        await adminClient.end();
      }
    }
  }
}

export async function insertUser(
  pool: Pool,
  values: {
    email: string;
    id?: string;
    displayName?: string;
  },
): Promise<string> {
  const result = await pool.query<{ id: string }>(
    `
      INSERT INTO users (id, email, display_name)
      VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3)
      RETURNING id::text AS id
    `,
    [values.id ?? null, values.email, values.displayName ?? null],
  );
  return result.rows[0].id;
}

export async function withAppContextTransaction<T>(
  pool: Pool,
  context: {
    tenantId?: string | null;
    userId?: string | null;
  },
  run: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [
      context.tenantId ?? "",
    ]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [
      context.userId ?? "",
    ]);

    const result = await run(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
