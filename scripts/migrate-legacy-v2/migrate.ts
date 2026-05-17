import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { migrateAsset, planAssetMigration } from "./asset-migrator.ts";
import {
  createEmptyState,
  loadMigrationState,
  markCompleted,
  saveMigrationState,
  shouldSkipCompleted,
} from "./checkpoint-store.ts";
import { buildLegacyFlowKey, buildProjectMigrationPlan, stableUuid } from "./mapping.ts";
import { loadLegacyDataset } from "./legacy-readers.ts";
import { parseMigrationOptions } from "./validate.ts";
import { createMigrationStorage, createMigrationWriter } from "./v2-writers.ts";

import type {
  MigrationIssue,
  MigrationOptions,
  MigrationReport,
  MigrationState,
  MigrationStorage,
  MigrationWriter,
} from "./types.ts";

function createEmptyReport(options: MigrationOptions): MigrationReport {
  return {
    dryRun: options.dryRun,
    errors: [],
    generatedAt: new Date().toISOString(),
    legacySource: options.legacySource,
    migratedCount: {
      assets: 0,
      flows: 0,
      flowVersions: 0,
      projects: 0,
    },
    planned: {
      assets: 0,
      billingSummary: null,
      flows: 0,
      projects: 0,
      users: 0,
    },
    skippedCount: {
      assets: 0,
      projects: 0,
    },
    tenantId: options.tenantId,
    userId: options.userId,
    warnings: [],
  };
}

async function writeReport(reportPath: string | null, report: MigrationReport): Promise<void> {
  if (!reportPath) {
    return;
  }
  await mkdir(path.dirname(reportPath), { recursive: true });
  await writeFile(reportPath, JSON.stringify(report, null, 2), "utf8");
}

function pushIssue(target: MigrationIssue[], issue: MigrationIssue): void {
  target.push(issue);
}

function takeLimited<T>(values: T[], limit: number | null): T[] {
  return limit ? values.slice(0, limit) : values;
}

export async function runLegacyMigration(
  options: MigrationOptions,
  dependencies?: {
    loadDataset?: typeof loadLegacyDataset;
    state?: MigrationState;
    storage?: MigrationStorage;
    writer?: MigrationWriter;
  },
): Promise<MigrationReport> {
  const state =
    dependencies?.state ?? (options.resume ? await loadMigrationState(options.statePath) : createEmptyState());
  const dataset = await (dependencies?.loadDataset ?? loadLegacyDataset)(options.legacySource);
  const report = createEmptyReport(options);
  report.planned.billingSummary = dataset.billingSummary;
  report.planned.users = dataset.users.length;

  const writer = options.dryRun ? null : (dependencies?.writer ?? createMigrationWriter());
  const storage = options.dryRun ? null : (dependencies?.storage ?? createMigrationStorage());
  const context = { tenantId: options.tenantId, userId: options.userId };

  const projects = takeLimited(dataset.projects, options.limit);
  const assets = takeLimited(dataset.assets, options.limit);
  report.planned.projects = projects.length;
  report.planned.flows = projects.length;
  report.planned.assets = assets.length;

  for (const project of projects) {
    const legacyKey = project.id;
    if (options.resume && shouldSkipCompleted(state, "project", legacyKey)) {
      report.skippedCount.projects += 1;
      continue;
    }

    const plan = buildProjectMigrationPlan(project);
    state.mappings.projects[legacyKey] = plan.projectId;
    state.mappings.flows[buildLegacyFlowKey(project)] = plan.flowId;
    state.mappings.flowVersions[`${buildLegacyFlowKey(project)}:${plan.checksum}`] = plan.flowVersionId;

    if (plan.compileError) {
      pushIssue(report.errors, {
        code: "LEGACY_GRAPH_INVALID",
        entityKey: legacyKey,
        entityType: "project",
        message: plan.compileError,
      });
    }

    if (!options.dryRun && writer) {
      await writer.writeProject({
        checksum: plan.checksum,
        compileError: plan.compileError,
        compiledGraph: plan.compiledGraph,
        context,
        createdAt: project.createdAt ?? null,
        flowId: plan.flowId,
        flowVersionId: plan.flowVersionId,
        graph: plan.graph,
        legacyProjectId: plan.legacyProjectId,
        projectId: plan.projectId,
        title: plan.title,
        updatedAt: plan.updatedAt,
      });
      markCompleted(state, "project", legacyKey);
      await saveMigrationState(options.statePath, state);
    }

    report.migratedCount.projects += 1;
    report.migratedCount.flows += 1;
    if (!plan.compileError) {
      report.migratedCount.flowVersions += 1;
    }
  }

  const writerBucket = writer?.getBucketName() ?? "dry-run-bucket";
  for (const asset of assets) {
    if (options.resume && shouldSkipCompleted(state, "asset", asset.legacyAssetKey)) {
      report.skippedCount.assets += 1;
      continue;
    }

    const planned = await planAssetMigration(asset, options.tenantId, writerBucket);
    if (planned.issue) {
      pushIssue(report.warnings, planned.issue);
      continue;
    }
    if (!planned.plan) {
      continue;
    }

    state.mappings.assets[asset.legacyAssetKey] = planned.plan.assetId;

    if (!options.dryRun && writer && storage) {
      await migrateAsset(writer, storage, planned.plan, context);
      markCompleted(state, "asset", asset.legacyAssetKey);
      await saveMigrationState(options.statePath, state);
    }

    report.migratedCount.assets += 1;
  }

  for (const user of dataset.users) {
    state.mappings.users[user.userId] = stableUuid("user-metadata", user.userId);
  }

  pushIssue(report.warnings, {
    code: "AUTH_MIGRATION_MANUAL_CONFIRMATION_REQUIRED",
    entityType: "user",
    message: "User metadata was inventoried, but passwords and sessions were intentionally not migrated.",
  });
  pushIssue(report.warnings, {
    code: "BILLING_MIGRATION_MANUAL_RECONCILIATION_REQUIRED",
    entityType: "billing",
    message: "Billing was summarized for dry-run/reporting only; no v2 billing ledger rows were written.",
  });

  await writeReport(options.reportPath, report);
  return report;
}

async function main(): Promise<void> {
  const options = parseMigrationOptions(process.argv.slice(2), process.cwd());
  const report = await runLegacyMigration(options);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

const isDirectExecution = process.argv[1]
  ? path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
  : false;

if (isDirectExecution) {
  main().catch((error) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  });
}
