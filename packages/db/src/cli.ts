import { createPgPool } from "./db.js";
import { getDefaultMigrationsDir, runMigrations } from "./migrator.js";

async function main(): Promise<void> {
  const pool = createPgPool();

  try {
    const result = await runMigrations(pool, getDefaultMigrationsDir());
    for (const filename of result.appliedMigrations) {
      console.log(`[db:migrate] applied ${filename}`);
    }
    for (const filename of result.skippedMigrations) {
      console.log(`[db:migrate] skipped ${filename}`);
    }
    if (
      result.appliedMigrations.length === 0 &&
      result.skippedMigrations.length === 0
    ) {
      console.log("[db:migrate] no migration files found");
    }
  } catch (error) {
    console.error("[db:migrate] failed");
    console.error(error);
    process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main();
