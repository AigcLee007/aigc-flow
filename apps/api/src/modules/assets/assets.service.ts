import { randomUUID } from "node:crypto";

import { createPgPool, withTenantTransaction } from "@aigc-flow/db";
import {
  buildAssetObjectKey,
  type StorageProvider,
} from "@aigc-flow/storage";
import type { Pool, PoolClient } from "pg";

import type { CompleteUploadInput, PresignedUploadInput } from "./assets.schemas.js";

type PgPool = Pool;

type AssetContext = {
  tenantId: string;
  userId: string | null;
};

type AssetRecord = {
  bucket: string;
  checksum_sha256: string | null;
  created_at: string;
  deleted_at: string | null;
  duration_ms: number | null;
  height: number | null;
  id: string;
  kind: string;
  metadata: Record<string, string>;
  mime_type: string;
  object_key: string;
  original_filename: string | null;
  owner_user_id: string | null;
  project_id: string | null;
  size_bytes: string | null;
  status: string;
  storage_provider: string;
  tenant_id: string;
  width: number | null;
};

type AssetVariantRecord = {
  bucket: string;
  height: number | null;
  id: string;
  metadata: Record<string, string>;
  mime_type: string;
  object_key: string;
  size_bytes: string | null;
  variant_key: string;
  width: number | null;
};

export type AssetVariantView = {
  bucket: string;
  height: number | null;
  id: string;
  metadata: Record<string, string>;
  mimeType: string;
  objectKey: string;
  sizeBytes: number | null;
  variantKey: string;
  width: number | null;
};

export type AssetView = {
  bucket: string;
  checksumSha256: string | null;
  createdAt: string;
  deletedAt: string | null;
  durationMs: number | null;
  height: number | null;
  id: string;
  kind: string;
  metadata: Record<string, string>;
  mimeType: string;
  objectKey: string;
  originalFilename: string | null;
  ownerUserId: string | null;
  projectId: string | null;
  sizeBytes: number | null;
  status: string;
  storageProvider: string;
  tenantId: string;
  variants: AssetVariantView[];
  width: number | null;
};

type AssetForStorage = {
  bucket: string;
  id: string;
  mimeType: string;
  objectKey: string;
  originalFilename: string | null;
  status: string;
};

export class AssetsApiError extends Error {
  readonly code: string;
  readonly statusCode: number;

  constructor(statusCode: number, code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "AssetsApiError";
    this.statusCode = statusCode;
  }
}

function toNumberOrNull(value: string | null): number | null {
  if (value === null) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapVariant(row: AssetVariantRecord): AssetVariantView {
  return {
    bucket: row.bucket,
    height: row.height,
    id: row.id,
    metadata: row.metadata ?? {},
    mimeType: row.mime_type,
    objectKey: row.object_key,
    sizeBytes: toNumberOrNull(row.size_bytes),
    variantKey: row.variant_key,
    width: row.width,
  };
}

function mapAsset(row: AssetRecord, variants: AssetVariantView[]): AssetView {
  return {
    bucket: row.bucket,
    checksumSha256: row.checksum_sha256,
    createdAt: row.created_at,
    deletedAt: row.deleted_at,
    durationMs: row.duration_ms,
    height: row.height,
    id: row.id,
    kind: row.kind,
    metadata: row.metadata ?? {},
    mimeType: row.mime_type,
    objectKey: row.object_key,
    originalFilename: row.original_filename,
    ownerUserId: row.owner_user_id,
    projectId: row.project_id,
    sizeBytes: toNumberOrNull(row.size_bytes),
    status: row.status,
    storageProvider: row.storage_provider,
    tenantId: row.tenant_id,
    variants,
    width: row.width,
  };
}

function buildDownloadFilename(asset: AssetForStorage): string {
  return asset.originalFilename?.trim() || `asset-${asset.id}`;
}

export class AssetsService {
  readonly bucket: string;
  readonly pool: PgPool;
  readonly storageProvider: StorageProvider;

  constructor(options: {
    bucket: string;
    pool?: PgPool;
    storageProvider: StorageProvider;
  }) {
    this.bucket = options.bucket;
    this.pool = options.pool ?? createPgPool();
    this.storageProvider = options.storageProvider;
  }

  async createPresignedUpload(
    context: AssetContext,
    input: PresignedUploadInput,
  ): Promise<{
    asset: AssetView;
    upload: {
      expiresAt: string;
      headers: Record<string, string>;
      method: "PUT";
      url: string;
    };
  }> {
    const assetId = randomUUID();

    return withTenantTransaction(context, async (client) => {
      if (input.projectId) {
        const project = await client.query<{ id: string }>(
          `
            SELECT id::text AS id
            FROM projects
            WHERE id = $1::uuid
              AND deleted_at IS NULL
            LIMIT 1
          `,
          [input.projectId],
        );

        if (!project.rows[0]) {
          throw new AssetsApiError(404, "PROJECT_NOT_FOUND", "Project not found");
        }
      }

      const objectKey = buildAssetObjectKey({
        assetId,
        filename: input.originalFilename,
        tenantId: context.tenantId,
      });

      const created = await client.query<AssetRecord>(
        `
          INSERT INTO assets (
            id,
            tenant_id,
            project_id,
            owner_user_id,
            kind,
            mime_type,
            bucket,
            object_key,
            original_filename,
            size_bytes,
            checksum_sha256,
            width,
            height,
            duration_ms,
            metadata,
            status
          )
          VALUES (
            $1::uuid,
            $2::uuid,
            $3::uuid,
            $4::uuid,
            $5,
            $6,
            $7,
            $8,
            $9,
            $10::bigint,
            $11,
            $12::int,
            $13::int,
            $14::int,
            $15::jsonb,
            'uploading'
          )
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            project_id::text AS project_id,
            owner_user_id::text AS owner_user_id,
            kind,
            mime_type,
            storage_provider,
            bucket,
            object_key,
            original_filename,
            size_bytes::text AS size_bytes,
            checksum_sha256,
            width,
            height,
            duration_ms,
            metadata,
            status,
            created_at::text AS created_at,
            deleted_at::text AS deleted_at
        `,
        [
          assetId,
          context.tenantId,
          input.projectId ?? null,
          context.userId,
          input.kind.trim(),
          input.mimeType.trim(),
          this.bucket,
          objectKey,
          input.originalFilename.trim(),
          input.sizeBytes ?? null,
          input.checksumSha256?.trim() ?? null,
          input.width ?? null,
          input.height ?? null,
          input.durationMs ?? null,
          JSON.stringify(input.metadata ?? {}),
        ],
      );

      const upload = await this.storageProvider.createPresignedPutUrl({
        bucket: this.bucket,
        contentLength: input.sizeBytes ?? null,
        contentType: input.mimeType,
        expiresInSeconds: 900,
        key: objectKey,
      });

      return {
        asset: mapAsset(created.rows[0], []),
        upload: {
          expiresAt: upload.expiresAt,
          headers: upload.headers,
          method: "PUT",
          url: upload.url,
        },
      };
    }, this.pool);
  }

  async completeUpload(
    context: AssetContext,
    assetId: string,
    input: CompleteUploadInput,
  ): Promise<AssetView> {
    return withTenantTransaction(context, async (client) => {
      const asset = await this.getAssetRowForUpdate(client, assetId);
      if (asset.deleted_at) {
        throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
      }

      const head = await this.storageProvider.headObject({
        bucket: asset.bucket,
        key: asset.object_key,
      });

      const updated = await client.query<AssetRecord>(
        `
          UPDATE assets
          SET
            mime_type = COALESCE($2, mime_type),
            size_bytes = COALESCE($3::bigint, size_bytes),
            checksum_sha256 = COALESCE($4, checksum_sha256),
            width = COALESCE($5::int, width),
            height = COALESCE($6::int, height),
            duration_ms = COALESCE($7::int, duration_ms),
            status = 'available'
          WHERE id = $1::uuid
          RETURNING
            id::text AS id,
            tenant_id::text AS tenant_id,
            project_id::text AS project_id,
            owner_user_id::text AS owner_user_id,
            kind,
            mime_type,
            storage_provider,
            bucket,
            object_key,
            original_filename,
            size_bytes::text AS size_bytes,
            checksum_sha256,
            width,
            height,
            duration_ms,
            metadata,
            status,
            created_at::text AS created_at,
            deleted_at::text AS deleted_at
        `,
        [
          assetId,
          head.contentType ?? null,
          input.sizeBytes ?? head.contentLength ?? null,
          input.checksumSha256?.trim() ?? null,
          input.width ?? null,
          input.height ?? null,
          input.durationMs ?? null,
        ],
      );

      return mapAsset(updated.rows[0], await this.listVariants(client, assetId));
    }, this.pool);
  }

  async getAsset(context: AssetContext, assetId: string): Promise<AssetView> {
    return withTenantTransaction(context, async (client) => {
      const asset = await this.getAssetRow(client, assetId);
      if (asset.deleted_at) {
        throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
      }

      return mapAsset(asset, await this.listVariants(client, assetId));
    }, this.pool);
  }

  async createDownloadUrl(
    context: AssetContext,
    assetId: string,
  ): Promise<{
    expiresAt: string;
    method: "GET";
    url: string;
  }> {
    return withTenantTransaction(context, async (client) => {
      const asset = await this.getAssetRow(client, assetId);
      if (asset.deleted_at) {
        throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
      }
      if (asset.status !== "available") {
        throw new AssetsApiError(409, "ASSET_NOT_AVAILABLE", "Asset is not available");
      }

      const download = await this.storageProvider.createPresignedGetUrl({
        bucket: asset.bucket,
        expiresInSeconds: 900,
        key: asset.object_key,
        responseContentDisposition: `attachment; filename="${buildDownloadFilename({
          bucket: asset.bucket,
          id: asset.id,
          mimeType: asset.mime_type,
          objectKey: asset.object_key,
          originalFilename: asset.original_filename,
          status: asset.status,
        })}"`,
        responseContentType: asset.mime_type,
      });

      return {
        expiresAt: download.expiresAt,
        method: "GET",
        url: download.url,
      };
    }, this.pool);
  }

  async deleteAsset(context: AssetContext, assetId: string): Promise<{ ok: true }> {
    return withTenantTransaction(context, async (client) => {
      const result = await client.query<{ id: string }>(
        `
          UPDATE assets
          SET deleted_at = now()
          WHERE id = $1::uuid
            AND deleted_at IS NULL
          RETURNING id::text AS id
        `,
        [assetId],
      );

      if (!result.rows[0]?.id) {
        throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
      }

      return { ok: true as const };
    }, this.pool);
  }

  private async getAssetRow(
    client: PoolClient,
    assetId: string,
  ): Promise<AssetRecord> {
    const result = await client.query<AssetRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          project_id::text AS project_id,
          owner_user_id::text AS owner_user_id,
          kind,
          mime_type,
          storage_provider,
          bucket,
          object_key,
          original_filename,
          size_bytes::text AS size_bytes,
          checksum_sha256,
          width,
          height,
          duration_ms,
          metadata,
          status,
          created_at::text AS created_at,
          deleted_at::text AS deleted_at
        FROM assets
        WHERE id = $1::uuid
        LIMIT 1
      `,
      [assetId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    return row;
  }

  private async getAssetRowForUpdate(
    client: PoolClient,
    assetId: string,
  ): Promise<AssetRecord> {
    const result = await client.query<AssetRecord>(
      `
        SELECT
          id::text AS id,
          tenant_id::text AS tenant_id,
          project_id::text AS project_id,
          owner_user_id::text AS owner_user_id,
          kind,
          mime_type,
          storage_provider,
          bucket,
          object_key,
          original_filename,
          size_bytes::text AS size_bytes,
          checksum_sha256,
          width,
          height,
          duration_ms,
          metadata,
          status,
          created_at::text AS created_at,
          deleted_at::text AS deleted_at
        FROM assets
        WHERE id = $1::uuid
        LIMIT 1
        FOR UPDATE
      `,
      [assetId],
    );

    const row = result.rows[0];
    if (!row) {
      throw new AssetsApiError(404, "ASSET_NOT_FOUND", "Asset not found");
    }

    return row;
  }

  private async listVariants(
    client: PoolClient,
    assetId: string,
  ): Promise<AssetVariantView[]> {
    const result = await client.query<AssetVariantRecord>(
      `
        SELECT
          id::text AS id,
          variant_key,
          bucket,
          object_key,
          mime_type,
          width,
          height,
          size_bytes::text AS size_bytes,
          metadata
        FROM asset_variants
        WHERE asset_id = $1::uuid
        ORDER BY created_at ASC, id ASC
      `,
      [assetId],
    );

    return result.rows.map(mapVariant);
  }
}
