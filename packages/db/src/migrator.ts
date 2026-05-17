import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

export type MigrationFile = {
  checksum: string;
  filename: string;
  sql: string;
  version: bigint;
};

export type AppliedMigration = {
  checksum: string;
  executedAt: string;
  filename: string;
  version: string;
};

export type MigrationRunResult = {
  appliedMigrations: string[];
  skippedMigrations: string[];
};

export class MigrationFailedError extends Error {
  readonly cause: unknown;
  readonly filename: string;

  constructor(filename: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`Migration failed: ${filename} (${detail})`);
    this.name = "MigrationFailedError";
    this.filename = filename;
    this.cause = cause;
  }
}

const migrationsDirFromModule = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../migrations",
);

function checksumFor(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function versionFromFilename(filename: string): bigint {
  const match = filename.match(/^(\d+)_/);
  if (!match) {
    throw new Error(
      `Migration filename must begin with a numeric prefix followed by "_": ${filename}`,
    );
  }
  return BigInt(match[1]);
}

export function getDefaultMigrationsDir(): string {
  return migrationsDirFromModule;
}

export async function loadMigrationFiles(migrationsDir = getDefaultMigrationsDir()): Promise<MigrationFile[]> {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const migrationNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const migrations = await Promise.all(
    migrationNames.map(async (filename) => {
      const sql = await fs.readFile(path.join(migrationsDir, filename), "utf8");
      return {
        checksum: checksumFor(sql),
        filename,
        sql,
        version: versionFromFilename(filename),
      };
    }),
  );

  return migrations;
}

async function ensureSchemaMigrationsTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version bigint PRIMARY KEY,
      filename text NOT NULL UNIQUE,
      checksum text NOT NULL,
      executed_at timestamptz NOT NULL DEFAULT now()
    )
  `);
}

export async function listAppliedMigrations(pool: Pool): Promise<AppliedMigration[]> {
  await ensureSchemaMigrationsTable(pool);
  const result = await pool.query<AppliedMigration>(
    `
      SELECT
        version::text AS version,
        filename,
        checksum,
        executed_at::text AS "executedAt"
      FROM schema_migrations
      ORDER BY version ASC
    `,
  );
  return result.rows;
}

export async function runMigrations(
  pool: Pool,
  migrationsDir = getDefaultMigrationsDir(),
): Promise<MigrationRunResult> {
  await ensureSchemaMigrationsTable(pool);

  const migrations = await loadMigrationFiles(migrationsDir);
  const appliedRows = await listAppliedMigrations(pool);
  const appliedByFilename = new Map(appliedRows.map((row) => [row.filename, row]));

  const appliedMigrations: string[] = [];
  const skippedMigrations: string[] = [];

  for (const migration of migrations) {
    const existing = appliedByFilename.get(migration.filename);
    if (existing) {
      if (existing.checksum !== migration.checksum) {
        throw new Error(
          `Applied migration checksum mismatch for ${migration.filename}: expected ${existing.checksum}, got ${migration.checksum}`,
        );
      }
      skippedMigrations.push(migration.filename);
      continue;
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(migration.sql);
      await client.query(
        `
          INSERT INTO schema_migrations (version, filename, checksum)
          VALUES ($1, $2, $3)
        `,
        [migration.version.toString(), migration.filename, migration.checksum],
      );
      await client.query("COMMIT");
      appliedMigrations.push(migration.filename);
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw new MigrationFailedError(migration.filename, error);
    } finally {
      client.release();
    }
  }

  return {
    appliedMigrations,
    skippedMigrations,
  };
}
