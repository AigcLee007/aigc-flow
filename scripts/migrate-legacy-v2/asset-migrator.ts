import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { resolveAssetObjectKey } from "./v2-writers.ts";
import { stableUuid } from "./mapping.ts";

import type {
  LegacyAssetRecord,
  MigrationIssue,
  MigrationStorage,
  MigrationWriter,
} from "./types.ts";

const MIME_BY_EXT: Record<string, string> = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
  ".png": "image/png",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export function inferAssetKind(relativePath: string): string {
  const extension = path.extname(relativePath).toLowerCase();
  return extension === ".mp4" || extension === ".mov" || extension === ".webm" ? "video" : "image";
}

export function inferMimeType(relativePath: string): string {
  return MIME_BY_EXT[path.extname(relativePath).toLowerCase()] ?? "application/octet-stream";
}

export async function planAssetMigration(
  asset: LegacyAssetRecord,
  tenantId: string,
  bucket: string,
): Promise<{
  issue?: MigrationIssue;
  plan?: {
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
}> {
  try {
    const [fileStat, content] = await Promise.all([stat(asset.absolutePath), readFile(asset.absolutePath)]);
    const assetId = stableUuid("asset", asset.legacyAssetKey);
    return {
      plan: {
        absolutePath: asset.absolutePath,
        assetId,
        checksumSha256: createHash("sha256").update(content).digest("hex"),
        kind: inferAssetKind(asset.relativePath),
        legacyAssetKey: asset.legacyAssetKey,
        mimeType: inferMimeType(asset.relativePath),
        objectKey: resolveAssetObjectKey(tenantId, assetId, asset.originalFilename),
        originalFilename: asset.originalFilename,
        relativePath: asset.relativePath,
        sizeBytes: fileStat.size,
        tenantId,
      },
    };
  } catch (error) {
    return {
      issue: {
        code: "LEGACY_ASSET_MISSING",
        entityKey: asset.legacyAssetKey,
        entityType: "asset",
        message: error instanceof Error ? error.message : "Legacy asset is missing",
      },
    };
  }
}

export async function migrateAsset(
  writer: MigrationWriter,
  storage: MigrationStorage,
  plan: Awaited<ReturnType<typeof planAssetMigration>>["plan"] extends infer T ? Exclude<T, undefined> : never,
  context: { tenantId: string; userId: string | null },
): Promise<void> {
  const content = await readFile(plan.absolutePath);
  await storage.putObject({
    body: content,
    bucket: writer.getBucketName(),
    contentType: plan.mimeType,
    key: plan.objectKey,
    metadata: {
      legacyAssetKey: plan.legacyAssetKey,
      legacyRelativePath: plan.relativePath,
    },
  });

  await writer.writeAsset({
    bucket: writer.getBucketName(),
    checksumSha256: plan.checksumSha256,
    context,
    kind: plan.kind,
    legacyAssetKey: plan.legacyAssetKey,
    mimeType: plan.mimeType,
    objectKey: plan.objectKey,
    originalFilename: plan.originalFilename,
    relativePath: plan.relativePath,
    sizeBytes: plan.sizeBytes,
    v2AssetId: plan.assetId,
  });
}
