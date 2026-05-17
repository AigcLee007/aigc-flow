import { createHash, randomUUID } from "node:crypto";

import {
  buildAssetObjectKey,
  type StorageProvider,
} from "@aigc-flow/storage";
import type { PoolClient } from "pg";

import type { MediaOutput } from "@aigc-flow/ai-gateway-core";

export type FetchResponseLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  headers: {
    get(name: string): string | null;
  };
  ok: boolean;
  status: number;
};

export type FetchLike = (url: string) => Promise<FetchResponseLike>;

export type AssetRef = {
  assetId: string;
  durationMs?: number;
  height?: number;
  kind: "image" | "video";
  mimeType: string;
  width?: number;
};

function defaultMimeType(kind: "image" | "video"): string {
  return kind === "image" ? "image/png" : "video/mp4";
}

function mimeTypeToExtension(mimeType: string): string {
  switch (mimeType.toLowerCase()) {
    case "image/jpeg":
      return ".jpg";
    case "image/png":
      return ".png";
    case "image/webp":
      return ".webp";
    case "video/mp4":
      return ".mp4";
    case "video/webm":
      return ".webm";
    default:
      return "";
  }
}

function parseBase64Payload(input: string): {
  buffer: Buffer;
  mimeType: string | null;
} {
  const dataUrlMatch = input.match(/^data:([^;]+);base64,(.+)$/i);
  if (dataUrlMatch) {
    return {
      buffer: Buffer.from(dataUrlMatch[2] ?? "", "base64"),
      mimeType: dataUrlMatch[1] ?? null,
    };
  }

  return {
    buffer: Buffer.from(input, "base64"),
    mimeType: null,
  };
}

function inferFilename(options: {
  explicitFilename?: string | null;
  index: number;
  kind: "image" | "video";
  mimeType: string;
  url?: string | null;
}): string {
  if (options.explicitFilename?.trim()) {
    return options.explicitFilename.trim();
  }

  if (options.url) {
    try {
      const parsed = new URL(options.url);
      const pathname = parsed.pathname.split("/").filter(Boolean).pop();
      if (pathname) {
        return pathname;
      }
    } catch {
      // Ignore URL parsing failures and use the generated fallback below.
    }
  }

  const extension = mimeTypeToExtension(options.mimeType) || (options.kind === "image" ? ".png" : ".mp4");
  return `${options.kind}-output-${options.index + 1}${extension}`;
}

async function resolveOutputBinary(
  fetchFn: FetchLike,
  kind: "image" | "video",
  output: MediaOutput,
  index: number,
): Promise<{
  body: Buffer;
  filename: string;
  mimeType: string;
}> {
  if (output.url?.trim()) {
    const response = await fetchFn(output.url.trim());
    if (!response.ok) {
      throw new Error(`Failed to download provider output: HTTP ${response.status}`);
    }

    const mimeType = output.mimeType?.trim() || response.headers.get("content-type") || defaultMimeType(kind);
    return {
      body: Buffer.from(await response.arrayBuffer()),
      filename: inferFilename({
        explicitFilename: output.filename ?? null,
        index,
        kind,
        mimeType,
        url: output.url,
      }),
      mimeType,
    };
  }

  if (output.base64?.trim()) {
    const parsed = parseBase64Payload(output.base64.trim());
    const mimeType = output.mimeType?.trim() || parsed.mimeType || defaultMimeType(kind);
    return {
      body: parsed.buffer,
      filename: inferFilename({
        explicitFilename: output.filename ?? null,
        index,
        kind,
        mimeType,
      }),
      mimeType,
    };
  }

  throw new Error("Provider output did not include a supported url or base64 payload");
}

export class MediaAssetStore {
  readonly assetBucket: string;
  readonly fetchFn: FetchLike;
  readonly storageProvider: StorageProvider;

  constructor(options: {
    assetBucket: string;
    fetchFn?: FetchLike;
    storageProvider: StorageProvider;
  }) {
    this.assetBucket = options.assetBucket;
    this.fetchFn =
      options.fetchFn ??
      (async (url: string) => {
        const response = await fetch(url);
        return {
          arrayBuffer: () => response.arrayBuffer(),
          headers: {
            get: (name: string) => response.headers.get(name),
          },
          ok: response.ok,
          status: response.status,
        };
      });
    this.storageProvider = options.storageProvider;
  }

  async persistOutputs(
    client: PoolClient,
    input: {
      kind: "image" | "video";
      nodeRunId: string;
      outputs: MediaOutput[];
      projectId: string | null;
      tenantId: string;
      workflowRunId: string;
    },
  ): Promise<AssetRef[]> {
    const assetRefs: AssetRef[] = [];

    for (let index = 0; index < input.outputs.length; index += 1) {
      const output = input.outputs[index];
      if (!output) {
        continue;
      }

      const binary = await resolveOutputBinary(this.fetchFn, input.kind, output, index);
      const assetId = randomUUID();
      const objectKey = buildAssetObjectKey({
        assetId,
        filename: binary.filename,
        tenantId: input.tenantId,
      });
      const checksumSha256 = createHash("sha256").update(binary.body).digest("hex");

      await this.storageProvider.putObject({
        body: binary.body,
        bucket: this.assetBucket,
        contentType: binary.mimeType,
        key: objectKey,
        metadata: {
          nodeRunId: input.nodeRunId,
          workflowRunId: input.workflowRunId,
        },
      });

      await client.query(
        `
          INSERT INTO assets (
            id,
            tenant_id,
            project_id,
            workflow_run_id,
            node_run_id,
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
            $5::uuid,
            NULL,
            $6,
            $7,
            $8,
            $9,
            $10,
            $11::bigint,
            $12,
            $13::int,
            $14::int,
            $15::int,
            $16::jsonb,
            'available'
          )
        `,
        [
          assetId,
          input.tenantId,
          input.projectId,
          input.workflowRunId,
          input.nodeRunId,
          input.kind,
          binary.mimeType,
          this.assetBucket,
          objectKey,
          binary.filename,
          binary.body.byteLength,
          checksumSha256,
          output.width ?? null,
          output.height ?? null,
          output.durationMs ?? null,
          JSON.stringify({
            source: "workflow-runner",
          }),
        ],
      );

      assetRefs.push({
        assetId,
        durationMs: output.durationMs ?? undefined,
        height: output.height ?? undefined,
        kind: input.kind,
        mimeType: binary.mimeType,
        width: output.width ?? undefined,
      });
    }

    return assetRefs;
  }
}
