import { z } from "zod";

const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_VALUE_LENGTH = 4000;

export const assetIdParamsSchema = z.object({
  assetId: z.string().uuid(),
});

export const assetMetadataSchema = z
  .record(z.string(), z.string().max(MAX_METADATA_VALUE_LENGTH))
  .refine((value) => Object.keys(value).length <= MAX_METADATA_ENTRIES, {
    message: "metadata must not exceed 32 entries",
  });

export const presignedUploadSchema = z.object({
  checksumSha256: z.string().trim().min(1).max(128).optional(),
  durationMs: z.number().int().nonnegative().nullable().optional(),
  height: z.number().int().positive().nullable().optional(),
  kind: z.string().trim().min(1).max(64),
  metadata: assetMetadataSchema.optional(),
  mimeType: z.string().trim().min(1).max(255),
  originalFilename: z.string().trim().min(1).max(255),
  projectId: z.string().uuid().nullable().optional(),
  sizeBytes: z.number().int().nonnegative().nullable().optional(),
  width: z.number().int().positive().nullable().optional(),
});

export const completeUploadSchema = z
  .object({
    checksumSha256: z.string().trim().min(1).max(128).optional(),
    durationMs: z.number().int().nonnegative().nullable().optional(),
    height: z.number().int().positive().nullable().optional(),
    sizeBytes: z.number().int().nonnegative().nullable().optional(),
    width: z.number().int().positive().nullable().optional(),
  })
  .optional()
  .default({});

export type AssetIdParams = z.infer<typeof assetIdParamsSchema>;
export type CompleteUploadInput = z.infer<typeof completeUploadSchema>;
export type PresignedUploadInput = z.infer<typeof presignedUploadSchema>;
