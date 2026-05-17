import { z } from "zod";

const jsonRecordSchema = z.record(z.string(), z.unknown());

export const routeIdParamsSchema = z.object({
  routeId: z.string().uuid(),
});

export const credentialIdParamsSchema = z.object({
  credentialId: z.string().uuid(),
});

export const createProviderSchema = z.object({
  capabilities: jsonRecordSchema.optional(),
  defaultBaseUrl: z.string().trim().url().nullable().optional(),
  key: z.string().trim().min(1).max(100),
  kind: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(255),
  status: z.string().trim().min(1).max(50).optional(),
});

export const createModelSchema = z.object({
  capabilities: jsonRecordSchema.optional(),
  contextWindow: z.number().int().positive().nullable().optional(),
  displayName: z.string().trim().min(1).max(255),
  modality: z.string().trim().min(1).max(100),
  modelKey: z.string().trim().min(1).max(255),
  providerId: z.string().uuid(),
  status: z.string().trim().min(1).max(50).optional(),
});

export const createRouteSchema = z.object({
  baseUrlOverride: z.string().trim().url().nullable().optional(),
  credentialId: z.string().uuid().nullable().optional(),
  fallbackGroup: z.string().trim().min(1).max(255).nullable().optional(),
  modality: z.string().trim().min(1).max(100),
  modelId: z.string().uuid().nullable().optional(),
  pricing: jsonRecordSchema.optional(),
  priority: z.number().int().min(0).optional(),
  providerId: z.string().uuid(),
  rateLimit: jsonRecordSchema.optional(),
  requestConfig: jsonRecordSchema.optional(),
  routeKey: z.string().trim().min(1).max(255),
  status: z.string().trim().min(1).max(50).optional(),
  weight: z.number().int().min(0).optional(),
});

export const updateRouteSchema = z
  .object({
    baseUrlOverride: z.string().trim().url().nullable().optional(),
    credentialId: z.string().uuid().nullable().optional(),
    fallbackGroup: z.string().trim().min(1).max(255).nullable().optional(),
    modelId: z.string().uuid().nullable().optional(),
    pricing: jsonRecordSchema.optional(),
    priority: z.number().int().min(0).optional(),
    rateLimit: jsonRecordSchema.optional(),
    requestConfig: jsonRecordSchema.optional(),
    status: z.string().trim().min(1).max(50).optional(),
    weight: z.number().int().min(0).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one route field must be provided",
  });

export const createCredentialSchema = z.object({
  name: z.string().trim().min(1).max(255),
  providerId: z.string().uuid(),
  secret: z.string().trim().min(1).max(4000),
  status: z.string().trim().min(1).max(50).optional(),
});

export const updateCredentialSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    status: z.string().trim().min(1).max(50).optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: "At least one credential field must be provided",
  });

export const rotateCredentialSchema = z.object({
  secret: z.string().trim().min(1).max(4000),
});

export const textMessageSchema = z.object({
  content: z.string().min(1).max(20000),
  role: z.enum(["assistant", "system", "user"]),
});

export const generateTextSchema = z.object({
  maxTokens: z.number().int().positive().nullable().optional(),
  messages: z.array(textMessageSchema).min(1),
  model: z.string().trim().min(1).max(255).nullable().optional(),
  routeKey: z.string().trim().min(1).max(255).nullable().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
});

export type CreateCredentialInput = z.infer<typeof createCredentialSchema>;
export type CreateModelInput = z.infer<typeof createModelSchema>;
export type CreateProviderInput = z.infer<typeof createProviderSchema>;
export type CreateRouteInput = z.infer<typeof createRouteSchema>;
export type CredentialIdParams = z.infer<typeof credentialIdParamsSchema>;
export type GenerateTextInput = z.infer<typeof generateTextSchema>;
export type RotateCredentialInput = z.infer<typeof rotateCredentialSchema>;
export type RouteIdParams = z.infer<typeof routeIdParamsSchema>;
export type UpdateCredentialInput = z.infer<typeof updateCredentialSchema>;
export type UpdateRouteInput = z.infer<typeof updateRouteSchema>;
