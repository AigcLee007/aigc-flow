import path from "node:path";

import type { MigrationOptions } from "./types.ts";

function readFlagValue(argv: string[], name: string): string | null {
  const index = argv.indexOf(name);
  if (index === -1) {
    return null;
  }
  return argv[index + 1] ?? null;
}

function hasFlag(argv: string[], name: string): boolean {
  return argv.includes(name);
}

export function parseMigrationOptions(argv: string[], cwd: string): MigrationOptions {
  const tenantId = readFlagValue(argv, "--tenant-id");
  if (!tenantId) {
    throw new Error("--tenant-id is required");
  }

  const legacySource = readFlagValue(argv, "--legacy-source") ?? cwd;
  const reportPath = readFlagValue(argv, "--report");
  const limitRaw = readFlagValue(argv, "--limit");
  const limit = limitRaw ? Number.parseInt(limitRaw, 10) : null;

  return {
    dryRun: hasFlag(argv, "--dry-run"),
    legacySource: path.resolve(cwd, legacySource),
    limit: Number.isFinite(limit) && (limit as number) > 0 ? (limit as number) : null,
    reportPath: reportPath ? path.resolve(cwd, reportPath) : null,
    resume: hasFlag(argv, "--resume"),
    statePath: path.resolve(cwd, "scripts", "migrate-legacy-v2", ".migration-state.json"),
    tenantId,
    userId: readFlagValue(argv, "--user-id"),
  };
}
