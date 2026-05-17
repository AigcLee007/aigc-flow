// @vitest-environment node

import path from "node:path";

import { describe, expect, test, vi } from "vitest";

import { createEmptyState } from "../checkpoint-store.ts";
import { runLegacyMigration } from "../migrate.ts";

import type {
  LegacyDataset,
  MigrationStorage,
  MigrationWriter,
} from "../types.ts";

function createDataset(): LegacyDataset {
  return {
    assets: [
      {
        absolutePath: path.resolve("missing-file.png"),
        legacyAssetKey: "missing-file.png",
        originalFilename: "missing-file.png",
        relativePath: "missing-file.png",
      },
      {
        absolutePath: path.resolve("scripts", "migrate-legacy-v2", "fixtures", "storage", "generated", "line4", "original", "2026", "05", "17", "user_demo", "demo-route", "demo-record", "sample.png"),
        legacyAssetKey: "sample.png",
        originalFilename: "sample.png",
        relativePath: "2026/05/17/user_demo/demo-route/demo-record/sample.png",
      },
    ],
    billingSummary: {
      accounts: 1,
      ledgerEntries: 2,
      pendingTasks: 0,
      totalBalancePoints: 120,
    },
    projects: [
      {
        createdAt: "2026-05-10T10:00:00.000Z",
        edges: [{ source: "a", target: "b" }],
        id: "legacy-project-valid",
        nodes: [
          { id: "a", type: "input", data: {} },
          { id: "b", type: "output", data: {} },
        ],
        title: "Valid Project",
        updatedAt: "2026-05-10T10:00:00.000Z",
        userId: "legacy-user",
        viewport: { x: 0, y: 0, zoom: 1 },
      },
      {
        createdAt: "2026-05-10T10:00:00.000Z",
        edges: [{ source: "a", target: "missing" }],
        id: "legacy-project-invalid",
        nodes: [{ id: "a", type: "input", data: {} }],
        title: "Invalid Project",
        updatedAt: "2026-05-10T10:00:00.000Z",
        userId: "legacy-user",
        viewport: { x: 0, y: 0, zoom: 1 },
      },
    ],
    users: [
      {
        createdAt: "2026-05-01T00:00:00.000Z",
        displayName: "Legacy User",
        email: "legacy@example.com",
        role: "admin",
        status: "active",
        updatedAt: "2026-05-10T00:00:00.000Z",
        userId: "legacy-user",
      },
    ],
  };
}

function createWriter(): MigrationWriter & {
  assets: unknown[];
  projects: unknown[];
} {
  const assets: unknown[] = [];
  const projects: unknown[] = [];
  return {
    assets,
    getBucketName() {
      return "test-bucket";
    },
    projects,
    async writeAsset(input) {
      assets.push(input);
    },
    async writeProject(input) {
      projects.push(input);
    },
  };
}

function createStorage(): MigrationStorage & { uploads: unknown[] } {
  const uploads: unknown[] = [];
  return {
    async putObject(input) {
      uploads.push(input);
    },
    uploads,
  };
}

describe("legacy migration runner", () => {
  test("dry-run does not write DB or S3", async () => {
    const writer = createWriter();
    const storage = createStorage();
    const report = await runLegacyMigration(
      {
        dryRun: true,
        legacySource: path.resolve("scripts", "migrate-legacy-v2", "fixtures"),
        limit: null,
        reportPath: null,
        resume: false,
        statePath: path.resolve(".tmp-legacy-migration-state.json"),
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: null,
      },
      {
        loadDataset: vi.fn().mockResolvedValue(createDataset()),
        state: createEmptyState(),
        storage,
        writer,
      },
    );

    expect(writer.projects).toHaveLength(0);
    expect(writer.assets).toHaveLength(0);
    expect(storage.uploads).toHaveLength(0);
    expect(report.migratedCount.projects).toBe(2);
    expect(report.migratedCount.assets).toBe(1);
  });

  test("resume skips already migrated items", async () => {
    const writer = createWriter();
    const storage = createStorage();
    const state = createEmptyState();
    state.completed.projects["legacy-project-valid"] = "2026-05-17T00:00:00.000Z";
    state.completed.assets["sample.png"] = "2026-05-17T00:00:00.000Z";

    const report = await runLegacyMigration(
      {
        dryRun: false,
        legacySource: path.resolve("scripts", "migrate-legacy-v2", "fixtures"),
        limit: null,
        reportPath: null,
        resume: true,
        statePath: path.resolve(".tmp-legacy-migration-state.json"),
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
      },
      {
        loadDataset: vi.fn().mockResolvedValue(createDataset()),
        state,
        storage,
        writer,
      },
    );

    expect(report.skippedCount.projects).toBe(1);
    expect(report.skippedCount.assets).toBe(1);
  });

  test("invalid graphs record an error without crashing the batch", async () => {
    const report = await runLegacyMigration(
      {
        dryRun: true,
        legacySource: path.resolve("scripts", "migrate-legacy-v2", "fixtures"),
        limit: null,
        reportPath: null,
        resume: false,
        statePath: path.resolve(".tmp-legacy-migration-state.json"),
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: null,
      },
      {
        loadDataset: vi.fn().mockResolvedValue(createDataset()),
        state: createEmptyState(),
      },
    );

    expect(report.errors.some((item) => item.code === "LEGACY_GRAPH_INVALID")).toBe(true);
    expect(report.migratedCount.projects).toBe(2);
  });

  test("missing asset files record a warning without crashing the batch", async () => {
    const report = await runLegacyMigration(
      {
        dryRun: true,
        legacySource: path.resolve("scripts", "migrate-legacy-v2", "fixtures"),
        limit: null,
        reportPath: null,
        resume: false,
        statePath: path.resolve(".tmp-legacy-migration-state.json"),
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: null,
      },
      {
        loadDataset: vi.fn().mockResolvedValue(createDataset()),
        state: createEmptyState(),
      },
    );

    expect(report.warnings.some((item) => item.code === "LEGACY_ASSET_MISSING")).toBe(true);
    expect(report.migratedCount.assets).toBe(1);
  });

  test("asset migration writes object content to storage but not to the DB writer payload, and includes tenant scope", async () => {
    const writer = createWriter();
    const storage = createStorage();
    await runLegacyMigration(
      {
        dryRun: false,
        legacySource: path.resolve("scripts", "migrate-legacy-v2", "fixtures"),
        limit: null,
        reportPath: null,
        resume: false,
        statePath: path.resolve(".tmp-legacy-migration-state.json"),
        tenantId: "00000000-0000-0000-0000-000000000001",
        userId: "00000000-0000-0000-0000-000000000002",
      },
      {
        loadDataset: vi.fn().mockResolvedValue(createDataset()),
        state: createEmptyState(),
        storage,
        writer,
      },
    );

    expect(storage.uploads).toHaveLength(1);
    expect((storage.uploads[0] as { body: Buffer }).body).toBeInstanceOf(Buffer);
    expect(writer.assets).toHaveLength(1);
    expect(writer.assets[0]).toMatchObject({
      context: {
        tenantId: "00000000-0000-0000-0000-000000000001",
      },
    });
    expect(writer.assets[0]).not.toHaveProperty("body");
  });
});
