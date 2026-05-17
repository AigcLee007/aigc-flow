import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MigrationEntityType, MigrationState } from "./types.ts";

export function createEmptyState(): MigrationState {
  return {
    completed: {
      assets: {},
      projects: {},
    },
    mappings: {
      assets: {},
      flowVersions: {},
      flows: {},
      projects: {},
      users: {},
    },
    updatedAt: new Date(0).toISOString(),
    version: 1,
  };
}

export async function loadMigrationState(statePath: string): Promise<MigrationState> {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MigrationState>;
    return {
      completed: {
        assets: parsed.completed?.assets ?? {},
        projects: parsed.completed?.projects ?? {},
      },
      mappings: {
        assets: parsed.mappings?.assets ?? {},
        flowVersions: parsed.mappings?.flowVersions ?? {},
        flows: parsed.mappings?.flows ?? {},
        projects: parsed.mappings?.projects ?? {},
        users: parsed.mappings?.users ?? {},
      },
      updatedAt: parsed.updatedAt ?? new Date(0).toISOString(),
      version: 1,
    };
  } catch {
    return createEmptyState();
  }
}

export async function saveMigrationState(statePath: string, state: MigrationState): Promise<void> {
  await mkdir(path.dirname(statePath), { recursive: true });
  await writeFile(
    statePath,
    JSON.stringify(
      {
        ...state,
        updatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
    "utf8",
  );
}

export function markCompleted(
  state: MigrationState,
  entityType: MigrationEntityType,
  legacyKey: string,
): void {
  const now = new Date().toISOString();
  if (entityType === "project") {
    state.completed.projects[legacyKey] = now;
    return;
  }
  state.completed.assets[legacyKey] = now;
}

export function shouldSkipCompleted(
  state: MigrationState,
  entityType: MigrationEntityType,
  legacyKey: string,
): boolean {
  return entityType === "project"
    ? Boolean(state.completed.projects[legacyKey])
    : Boolean(state.completed.assets[legacyKey]);
}
