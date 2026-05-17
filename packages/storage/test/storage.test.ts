import { describe, expect, test } from "vitest";

import { buildAssetObjectKey, sanitizeObjectFilename } from "../src/asset-key.js";
import { S3StorageProvider } from "../src/s3-storage-provider.js";

describe("@aigc-flow/storage", () => {
  test("asset object key contains tenantId and assetId", () => {
    const key = buildAssetObjectKey({
      assetId: "asset-123",
      filename: "poster final.png",
      tenantId: "tenant-456",
    });

    expect(key).toContain("tenant-456");
    expect(key).toContain("asset-123");
    expect(key).toContain("original-poster-final.png");
  });

  test("sanitize filename blocks path traversal", () => {
    expect(sanitizeObjectFilename("../unsafe/../../avatar.png")).toBe("avatar.png");
    expect(sanitizeObjectFilename("..\\unsafe\\nested\\clip.mp4")).toBe("clip.mp4");
  });

  test("creates presigned PUT and GET URLs", async () => {
    const provider = new S3StorageProvider({
      accessKeyId: "minio",
      endpoint: "http://localhost:9000",
      forcePathStyle: true,
      region: "us-east-1",
      secretAccessKey: "minio123456",
    });

    const putUrl = await provider.createPresignedPutUrl({
      bucket: "aigc-flow-dev",
      contentLength: 128,
      contentType: "image/png",
      expiresInSeconds: 900,
      key: "tenants/tenant-1/assets/asset-1/original-image.png",
    });
    const getUrl = await provider.createPresignedGetUrl({
      bucket: "aigc-flow-dev",
      expiresInSeconds: 900,
      key: "tenants/tenant-1/assets/asset-1/original-image.png",
      responseContentDisposition: 'attachment; filename="image.png"',
      responseContentType: "image/png",
    });

    expect(putUrl.method).toBe("PUT");
    expect(putUrl.headers["content-type"]).toBe("image/png");
    expect(putUrl.url).toContain("aigc-flow-dev");
    expect(putUrl.url).toContain("X-Amz-Signature");

    expect(getUrl.method).toBe("GET");
    expect(getUrl.url).toContain("response-content-disposition=attachment%3B%20filename%3D%22image.png%22");
    expect(getUrl.url).toContain("X-Amz-Signature");
  });
});
