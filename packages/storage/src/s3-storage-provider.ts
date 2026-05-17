import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  CreatePresignedUrlResult,
  DeleteObjectInput,
  HeadObjectInput,
  HeadObjectResult,
  PutObjectInput,
  StorageProvider,
} from "./storage-provider.js";

export type S3StorageProviderOptions = {
  accessKeyId?: string;
  endpoint?: string;
  forcePathStyle?: boolean;
  region: string;
  secretAccessKey?: string;
};

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;

  constructor(options: S3StorageProviderOptions) {
    this.client = new S3Client({
      credentials:
        options.accessKeyId && options.secretAccessKey
          ? {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            }
          : undefined,
      endpoint: options.endpoint,
      forcePathStyle: options.forcePathStyle ?? false,
      region: options.region,
    });
  }

  async putObject(input: PutObjectInput): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Body: input.body,
        Bucket: input.bucket,
        ContentType: input.contentType,
        Key: input.key,
        Metadata: input.metadata,
      }),
    );
  }

  async headObject(input: HeadObjectInput): Promise<HeadObjectResult> {
    const result = await this.client.send(
      new HeadObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );

    return {
      contentLength: result.ContentLength ?? null,
      contentType: result.ContentType ?? null,
      eTag: result.ETag ?? null,
      lastModified: result.LastModified?.toISOString() ?? null,
      metadata: result.Metadata ?? {},
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: input.bucket,
        Key: input.key,
      }),
    );
  }

  async createPresignedPutUrl(input: {
    bucket: string;
    contentLength?: number | null;
    contentType?: string | null;
    expiresInSeconds: number;
    key: string;
    metadata?: Record<string, string>;
  }): Promise<CreatePresignedUrlResult> {
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      ContentLength: input.contentLength ?? undefined,
      ContentType: input.contentType ?? undefined,
      Key: input.key,
      Metadata: input.metadata,
    });
    const url = await getSignedUrl(this.client as unknown as Parameters<typeof getSignedUrl>[0], command, {
      expiresIn: input.expiresInSeconds,
    });

    return {
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: input.contentType ? { "content-type": input.contentType } : {},
      method: "PUT",
      url,
    };
  }

  async createPresignedGetUrl(input: {
    bucket: string;
    expiresInSeconds: number;
    key: string;
    responseContentDisposition?: string | null;
    responseContentType?: string | null;
  }): Promise<CreatePresignedUrlResult> {
    const command = new GetObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      ResponseContentDisposition: input.responseContentDisposition ?? undefined,
      ResponseContentType: input.responseContentType ?? undefined,
    });
    const url = await getSignedUrl(this.client as unknown as Parameters<typeof getSignedUrl>[0], command, {
      expiresIn: input.expiresInSeconds,
    });

    return {
      expiresAt: new Date(Date.now() + input.expiresInSeconds * 1000).toISOString(),
      headers: {},
      method: "GET",
      url,
    };
  }
}
