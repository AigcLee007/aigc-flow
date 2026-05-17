export type MigrationEntityType = "project" | "asset";

export type LegacyFlowProjectRecord = {
  createdAt?: string | null;
  edges: unknown[];
  id: string;
  nodes: unknown[];
  title: string;
  updatedAt?: string | null;
  userId?: string | null;
  version?: number | null;
  viewport?: Record<string, unknown> | null;
};

export type LegacyAssetRecord = {
  absolutePath: string;
  legacyAssetKey: string;
  originalFilename: string;
  relativePath: string;
};

export type LegacyUserMetadata = {
  createdAt?: string | null;
  displayName?: string | null;
  email?: string | null;
  role?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  userId: string;
};

export type LegacyBillingSummary = {
  accounts: number;
  ledgerEntries: number;
  pendingTasks: number;
  totalBalancePoints: number;
};

export type LegacyDataset = {
  assets: LegacyAssetRecord[];
  billingSummary: LegacyBillingSummary | null;
  projects: LegacyFlowProjectRecord[];
  users: LegacyUserMetadata[];
};

export type MigrationOptions = {
  dryRun: boolean;
  legacySource: string;
  limit: number | null;
  reportPath: string | null;
  resume: boolean;
  statePath: string;
  tenantId: string;
  userId: string | null;
};

export type MigrationIssue = {
  code: string;
  entityKey?: string;
  entityType?: MigrationEntityType | "billing" | "user";
  message: string;
};

export type MigrationReport = {
  dryRun: boolean;
  errors: MigrationIssue[];
  generatedAt: string;
  legacySource: string;
  migratedCount: {
    assets: number;
    flows: number;
    flowVersions: number;
    projects: number;
  };
  planned: {
    assets: number;
    billingSummary: LegacyBillingSummary | null;
    flows: number;
    projects: number;
    users: number;
  };
  skippedCount: {
    assets: number;
    projects: number;
  };
  tenantId: string;
  userId: string | null;
  warnings: MigrationIssue[];
};

export type MigrationState = {
  completed: {
    assets: Record<string, string>;
    projects: Record<string, string>;
  };
  mappings: {
    assets: Record<string, string>;
    flowVersions: Record<string, string>;
    flows: Record<string, string>;
    projects: Record<string, string>;
    users: Record<string, string>;
  };
  updatedAt: string;
  version: 1;
};

export type ProjectMigrationPlan = {
  checksum: string;
  compileError: string | null;
  compiledGraph: Record<string, unknown> | null;
  flowId: string;
  flowVersionId: string;
  graph: Record<string, unknown>;
  legacyProjectId: string;
  legacyUserId: string | null;
  projectId: string;
  title: string;
  updatedAt: string | null;
};

export type AssetMigrationPlan = {
  absolutePath: string;
  assetId: string;
  checksumSha256: string;
  kind: string;
  legacyAssetKey: string;
  mimeType: string;
  objectKey: string;
  originalFilename: string;
  relativePath: string;
  sizeBytes: number;
  tenantId: string;
};

export type ProjectWriteInput = {
  checksum: string;
  compileError: string | null;
  compiledGraph: Record<string, unknown> | null;
  context: {
    tenantId: string;
    userId: string | null;
  };
  createdAt: string | null;
  flowId: string;
  flowVersionId: string;
  graph: Record<string, unknown>;
  legacyProjectId: string;
  projectId: string;
  title: string;
  updatedAt: string | null;
};

export type AssetWriteInput = {
  bucket: string;
  checksumSha256: string;
  context: {
    tenantId: string;
    userId: string | null;
  };
  kind: string;
  legacyAssetKey: string;
  mimeType: string;
  objectKey: string;
  originalFilename: string;
  relativePath: string;
  sizeBytes: number;
  v2AssetId: string;
};

export type MigrationWriter = {
  getBucketName(): string;
  writeAsset(input: AssetWriteInput): Promise<void>;
  writeProject(input: ProjectWriteInput): Promise<void>;
};

export type MigrationStorage = {
  putObject(input: {
    body: Buffer;
    bucket: string;
    contentType: string;
    key: string;
    metadata?: Record<string, string>;
  }): Promise<void>;
};
