import { createRequire } from "node:module";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import type {
  LegacyAssetRecord,
  LegacyBillingSummary,
  LegacyDataset,
  LegacyFlowProjectRecord,
  LegacyUserMetadata,
} from "./types.ts";

const require = createRequire(import.meta.url);
const legacyDb = require("../../db.cjs") as {
  isMySqlConfigured: () => boolean;
  query: (sql: string, params?: unknown[]) => Promise<unknown[]>;
};

async function entryExists(targetPath: string): Promise<boolean> {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function resolveExistingPath(candidates: string[]): Promise<string | null> {
  for (const candidate of candidates) {
    if (await entryExists(candidate)) {
      return candidate;
    }
  }
  return null;
}

function toLegacyProjectRecord(input: Record<string, unknown>): LegacyFlowProjectRecord | null {
  const id = String(input.id ?? "").trim();
  if (!id) {
    return null;
  }

  return {
    createdAt: typeof input.createdAt === "string" ? input.createdAt : null,
    edges: Array.isArray(input.edges) ? input.edges : [],
    id,
    nodes: Array.isArray(input.nodes) ? input.nodes : [],
    title: String(input.title ?? "").trim() || `Legacy Flow ${id}`,
    updatedAt:
      typeof input.updatedAt === "string"
        ? input.updatedAt
        : typeof input.createdAt === "string"
          ? input.createdAt
          : null,
    userId: typeof input.userId === "string" ? input.userId : null,
    version: typeof input.version === "number" ? input.version : null,
    viewport:
      input.viewport && typeof input.viewport === "object" && !Array.isArray(input.viewport)
        ? (input.viewport as Record<string, unknown>)
        : {},
  };
}

async function readLegacyProjectsFromJson(legacySource: string): Promise<LegacyFlowProjectRecord[]> {
  const filePath =
    (await resolveExistingPath([
      path.join(legacySource, "flow_projects.local.json"),
      path.join(path.dirname(legacySource), "flow_projects.local.json"),
      path.join(process.cwd(), "flow_projects.local.json"),
    ])) ?? path.join(legacySource, "flow_projects.local.json");
  const records = await readJsonFile<unknown[]>(filePath, []);
  return records
    .map((item) => (item && typeof item === "object" ? toLegacyProjectRecord(item as Record<string, unknown>) : null))
    .filter((item): item is LegacyFlowProjectRecord => Boolean(item));
}

async function readLegacyProjectsFromMysql(): Promise<LegacyFlowProjectRecord[]> {
  if (!legacyDb.isMySqlConfigured()) {
    return [];
  }

  const rows = (await legacyDb.query(
    `
      SELECT id, user_id, title, nodes_json, edges_json, viewport_json, version, created_at, updated_at
      FROM flow_projects
      ORDER BY updated_at DESC, id ASC
    `,
  )) as Array<Record<string, unknown>>;

  return rows
    .map((row) => {
      try {
        return toLegacyProjectRecord({
          createdAt: row.created_at,
          edges: JSON.parse(String(row.edges_json ?? "[]")),
          id: row.id,
          nodes: JSON.parse(String(row.nodes_json ?? "[]")),
          title: row.title,
          updatedAt: row.updated_at,
          userId: row.user_id,
          version: Number(row.version ?? 1),
          viewport: JSON.parse(String(row.viewport_json ?? "{}")),
        });
      } catch {
        return null;
      }
    })
    .filter((item): item is LegacyFlowProjectRecord => Boolean(item));
}

async function readLegacyUsersFromJson(legacySource: string): Promise<LegacyUserMetadata[]> {
  const filePath =
    (await resolveExistingPath([
      path.join(legacySource, "auth-data.json"),
      path.join(path.dirname(legacySource), "auth-data.json"),
      path.join(process.cwd(), "auth-data.json"),
    ])) ?? path.join(legacySource, "auth-data.json");
  const store = await readJsonFile<Record<string, unknown>>(filePath, {});
  const users = store.users && typeof store.users === "object" ? Object.values(store.users as Record<string, unknown>) : [];
  return users
    .map((item) => {
      if (!item || typeof item !== "object") {
        return null;
      }
      const row = item as Record<string, unknown>;
      const userId = String(row.userId ?? "").trim();
      if (!userId) {
        return null;
      }
      return {
        createdAt: typeof row.createdAt === "string" ? row.createdAt : null,
        displayName: typeof row.displayName === "string" ? row.displayName : null,
        email: typeof row.email === "string" ? row.email : null,
        role: typeof row.role === "string" ? row.role : null,
        status: typeof row.status === "string" ? row.status : null,
        updatedAt: typeof row.updatedAt === "string" ? row.updatedAt : null,
        userId,
      };
    })
    .filter((item): item is LegacyUserMetadata => Boolean(item));
}

async function readLegacyUsersFromMysql(): Promise<LegacyUserMetadata[]> {
  if (!legacyDb.isMySqlConfigured()) {
    return [];
  }

  const rows = (await legacyDb.query(
    `
      SELECT user_id, email, display_name, role, status, created_at, updated_at
      FROM auth_users
      ORDER BY created_at ASC, user_id ASC
    `,
  )) as Array<Record<string, unknown>>;

  return rows.map((row) => ({
    createdAt: typeof row.created_at === "string" ? row.created_at : null,
    displayName: typeof row.display_name === "string" ? row.display_name : null,
    email: typeof row.email === "string" ? row.email : null,
    role: typeof row.role === "string" ? row.role : null,
    status: typeof row.status === "string" ? row.status : null,
    updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
    userId: String(row.user_id ?? "").trim(),
  }));
}

async function readBillingSummaryFromJson(legacySource: string): Promise<LegacyBillingSummary | null> {
  const filePath =
    (await resolveExistingPath([
      path.join(legacySource, "billing-data.json"),
      path.join(path.dirname(legacySource), "billing-data.json"),
      path.join(process.cwd(), "billing-data.json"),
    ])) ?? path.join(legacySource, "billing-data.json");
  const store = await readJsonFile<Record<string, unknown>>(filePath, {});
  const accounts = store.accounts && typeof store.accounts === "object" ? Object.values(store.accounts as Record<string, unknown>) : [];
  const ledger = Array.isArray(store.ledger) ? store.ledger : [];
  const pendingTasks =
    store.pendingTasks && typeof store.pendingTasks === "object"
      ? Object.values(store.pendingTasks as Record<string, unknown>)
      : [];

  if (!accounts.length && !ledger.length && !pendingTasks.length) {
    return null;
  }

  const totalBalancePoints = accounts.reduce((sum, account) => {
    const points = account && typeof account === "object" ? Number((account as Record<string, unknown>).points ?? 0) : 0;
    return sum + (Number.isFinite(points) ? points : 0);
  }, 0);

  return {
    accounts: accounts.length,
    ledgerEntries: ledger.length,
    pendingTasks: pendingTasks.length,
    totalBalancePoints,
  };
}

async function readBillingSummaryFromMysql(): Promise<LegacyBillingSummary | null> {
  if (!legacyDb.isMySqlConfigured()) {
    return null;
  }

  const [accountRow, ledgerRow, pendingRow] = (await Promise.all([
    legacyDb.query("SELECT COUNT(*) AS total, COALESCE(SUM(points), 0) AS total_points FROM billing_accounts"),
    legacyDb.query("SELECT COUNT(*) AS total FROM billing_ledger"),
    legacyDb.query("SELECT COUNT(*) AS total FROM billing_pending_tasks WHERE settled_at IS NULL"),
  ])) as Array<Array<Record<string, unknown>>>;

  return {
    accounts: Number(accountRow[0]?.total ?? 0),
    ledgerEntries: Number(ledgerRow[0]?.total ?? 0),
    pendingTasks: Number(pendingRow[0]?.total ?? 0),
    totalBalancePoints: Number(accountRow[0]?.total_points ?? 0),
  };
}

async function listFilesRecursively(rootDir: string): Promise<string[]> {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursively(absolutePath)));
      continue;
    }
    if (entry.isFile()) {
      files.push(absolutePath);
    }
  }

  return files;
}

async function readLegacyAssetsFromFilesystem(legacySource: string): Promise<LegacyAssetRecord[]> {
  const assetRoot =
    (await resolveExistingPath([
      path.join(legacySource, "storage", "generated", "line4", "original"),
      path.join(legacySource, "generated", "line4", "original"),
      path.join(process.cwd(), "storage", "generated", "line4", "original"),
    ])) ?? path.join(legacySource, "storage", "generated", "line4", "original");
  try {
    const files = await listFilesRecursively(assetRoot);
    return files.map((absolutePath) => {
      const relativePath = path.relative(assetRoot, absolutePath).replace(/\\/g, "/");
      return {
        absolutePath,
        legacyAssetKey: relativePath,
        originalFilename: path.basename(absolutePath),
        relativePath,
      };
    });
  } catch {
    return [];
  }
}

export async function loadLegacyDataset(legacySource: string): Promise<LegacyDataset> {
  const [jsonProjects, jsonUsers, jsonBilling, assets] = await Promise.all([
    readLegacyProjectsFromJson(legacySource),
    readLegacyUsersFromJson(legacySource),
    readBillingSummaryFromJson(legacySource),
    readLegacyAssetsFromFilesystem(legacySource),
  ]);
  const mysqlProjects = jsonProjects.length === 0 ? await readLegacyProjectsFromMysql() : [];
  const mysqlUsers = jsonUsers.length === 0 ? await readLegacyUsersFromMysql() : [];
  const mysqlBilling = jsonBilling === null ? await readBillingSummaryFromMysql() : null;

  return {
    assets,
    billingSummary: jsonBilling ?? mysqlBilling,
    projects: jsonProjects.length > 0 ? jsonProjects : mysqlProjects,
    users: jsonUsers.length > 0 ? jsonUsers : mysqlUsers,
  };
}
