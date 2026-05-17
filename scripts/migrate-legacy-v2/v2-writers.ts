import { randomUUID } from "node:crypto";

import { createPgPool } from "../../packages/db/src/db.ts";
import { withTenantTransaction } from "../../packages/db/src/transaction.ts";
import { buildAssetObjectKey, S3StorageProvider } from "../../packages/storage/src/index.ts";

import type {
  AssetWriteInput,
  MigrationStorage,
  MigrationWriter,
  ProjectWriteInput,
} from "./types.ts";

export function resolveAssetObjectKey(tenantId: string, assetId: string, originalFilename: string): string {
  return buildAssetObjectKey({
    assetId,
    filename: originalFilename || `${assetId}-${randomUUID()}`,
    tenantId,
  });
}

export function createMigrationStorage(): MigrationStorage {
  const region = process.env.S3_REGION?.trim();
  const bucket = process.env.S3_BUCKET?.trim();
  if (!region || !bucket) {
    throw new Error("S3_REGION and S3_BUCKET are required for legacy asset migration");
  }

  const provider = new S3StorageProvider({
    accessKeyId: process.env.S3_ACCESS_KEY_ID?.trim(),
    endpoint: process.env.S3_ENDPOINT?.trim(),
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim().toLowerCase() === "true",
    region,
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY?.trim(),
  });

  return {
    async putObject(input) {
      await provider.putObject(input);
    },
  };
}

export function createMigrationWriter(): MigrationWriter {
  const pool = createPgPool();
  const bucket = process.env.S3_BUCKET?.trim();
  if (!bucket) {
    throw new Error("S3_BUCKET is required for legacy asset migration");
  }

  return {
    getBucketName() {
      return bucket;
    },
    async writeAsset(input: AssetWriteInput) {
      await withTenantTransaction(input.context, async (client) => {
        await client.query(
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
              metadata,
              status
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              NULL,
              $3::uuid,
              $4,
              $5,
              $6,
              $7,
              $8,
              $9::bigint,
              $10,
              $11::jsonb,
              'available'
            )
            ON CONFLICT (id) DO UPDATE
            SET
              tenant_id = EXCLUDED.tenant_id,
              owner_user_id = EXCLUDED.owner_user_id,
              kind = EXCLUDED.kind,
              mime_type = EXCLUDED.mime_type,
              bucket = EXCLUDED.bucket,
              object_key = EXCLUDED.object_key,
              original_filename = EXCLUDED.original_filename,
              size_bytes = EXCLUDED.size_bytes,
              checksum_sha256 = EXCLUDED.checksum_sha256,
              metadata = EXCLUDED.metadata,
              status = 'available'
          `,
          [
            input.v2AssetId,
            input.context.tenantId,
            input.context.userId,
            input.kind,
            input.mimeType,
            input.bucket,
            input.objectKey,
            input.originalFilename,
            input.sizeBytes,
            input.checksumSha256,
            JSON.stringify({
              legacyAssetKey: input.legacyAssetKey,
              legacyRelativePath: input.relativePath,
            }),
          ],
        );
      }, pool);
    },
    async writeProject(input: ProjectWriteInput) {
      await withTenantTransaction(input.context, async (client) => {
        await client.query(
          `
            INSERT INTO projects (
              id,
              tenant_id,
              name,
              description,
              created_by,
              created_at,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3,
              $4,
              $5::uuid,
              COALESCE($6::timestamptz, now()),
              COALESCE($7::timestamptz, now())
            )
            ON CONFLICT (id) DO UPDATE
            SET
              name = EXCLUDED.name,
              description = EXCLUDED.description,
              updated_at = EXCLUDED.updated_at
          `,
          [
            input.projectId,
            input.context.tenantId,
            input.title,
            `Migrated from legacy flow project ${input.legacyProjectId}`,
            input.context.userId,
            input.createdAt,
            input.updatedAt,
          ],
        );

        await client.query(
          `
            INSERT INTO flows (
              id,
              tenant_id,
              project_id,
              title,
              description,
              status,
              current_version_id,
              created_by,
              updated_by,
              created_at,
              updated_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              $4,
              $5,
              $6,
              $7::uuid,
              $8::uuid,
              $8::uuid,
              COALESCE($9::timestamptz, now()),
              COALESCE($10::timestamptz, now())
            )
            ON CONFLICT (id) DO UPDATE
            SET
              title = EXCLUDED.title,
              description = EXCLUDED.description,
              status = EXCLUDED.status,
              updated_by = EXCLUDED.updated_by,
              updated_at = EXCLUDED.updated_at
          `,
          [
            input.flowId,
            input.context.tenantId,
            input.projectId,
            input.title,
            `Migrated from legacy flow project ${input.legacyProjectId}`,
            input.compileError ? "draft" : "published",
            input.compileError ? null : input.flowVersionId,
            input.context.userId,
            input.createdAt,
            input.updatedAt,
          ],
        );

        if (input.compileError || !input.compiledGraph) {
          return;
        }

        await client.query(
          `
            INSERT INTO flow_versions (
              id,
              tenant_id,
              flow_id,
              version,
              graph_json,
              compiled_graph_json,
              checksum,
              changelog,
              published_by,
              published_at,
              created_at
            )
            VALUES (
              $1::uuid,
              $2::uuid,
              $3::uuid,
              1,
              $4::jsonb,
              $5::jsonb,
              $6,
              $7,
              $8::uuid,
              COALESCE($9::timestamptz, now()),
              COALESCE($9::timestamptz, now())
            )
            ON CONFLICT (id) DO UPDATE
            SET
              graph_json = EXCLUDED.graph_json,
              compiled_graph_json = EXCLUDED.compiled_graph_json,
              checksum = EXCLUDED.checksum,
              changelog = EXCLUDED.changelog,
              published_by = EXCLUDED.published_by,
              published_at = EXCLUDED.published_at
          `,
          [
            input.flowVersionId,
            input.context.tenantId,
            input.flowId,
            JSON.stringify(input.graph),
            JSON.stringify(input.compiledGraph),
            input.checksum,
            `Migrated from legacy flow project ${input.legacyProjectId}`,
            input.context.userId,
            input.updatedAt ?? input.createdAt,
          ],
        );

        await client.query(
          `
            UPDATE flows
            SET
              current_version_id = $2::uuid,
              status = 'published',
              updated_by = $3::uuid,
              updated_at = COALESCE($4::timestamptz, now())
            WHERE id = $1::uuid
          `,
          [input.flowId, input.flowVersionId, input.context.userId, input.updatedAt ?? input.createdAt],
        );
      }, pool);
    },
  };
}
