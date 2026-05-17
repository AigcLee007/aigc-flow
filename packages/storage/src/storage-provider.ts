export type PutObjectInput = {
  body: Buffer | Uint8Array | string;
  bucket: string;
  contentType?: string;
  key: string;
  metadata?: Record<string, string>;
};

export type HeadObjectInput = {
  bucket: string;
  key: string;
};

export type HeadObjectResult = {
  contentLength: number | null;
  contentType: string | null;
  eTag: string | null;
  lastModified: string | null;
  metadata: Record<string, string>;
};

export type DeleteObjectInput = {
  bucket: string;
  key: string;
};

export type CreatePresignedUrlResult = {
  expiresAt: string;
  headers: Record<string, string>;
  method: "GET" | "PUT";
  url: string;
};

export interface StorageProvider {
  putObject(input: PutObjectInput): Promise<void>;
  headObject(input: HeadObjectInput): Promise<HeadObjectResult>;
  deleteObject(input: DeleteObjectInput): Promise<void>;
  createPresignedPutUrl(input: {
    bucket: string;
    contentLength?: number | null;
    contentType?: string | null;
    expiresInSeconds: number;
    key: string;
    metadata?: Record<string, string>;
  }): Promise<CreatePresignedUrlResult>;
  createPresignedGetUrl(input: {
    bucket: string;
    expiresInSeconds: number;
    key: string;
    responseContentDisposition?: string | null;
    responseContentType?: string | null;
  }): Promise<CreatePresignedUrlResult>;
}
