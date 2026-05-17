export type TextMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type AssetReferenceInput = {
  assetId: string;
  durationMs?: number | null;
  height?: number | null;
  kind?: string | null;
  metadata?: Record<string, unknown> | null;
  mimeType?: string | null;
  width?: number | null;
};

export type TextGenerationRequest = {
  maxTokens?: number | null;
  messages: TextMessage[];
  model?: string | null;
  routeKey?: string | null;
  temperature?: number | null;
};

export type ImageGenerationRequest = {
  inputAssets?: AssetReferenceInput[] | null;
  metadata?: Record<string, unknown> | null;
  model?: string | null;
  prompt: string;
  routeKey?: string | null;
};

export type VideoGenerationRequest = {
  inputAssets?: AssetReferenceInput[] | null;
  metadata?: Record<string, unknown> | null;
  model?: string | null;
  prompt: string;
  routeKey?: string | null;
};

export type AiGatewayUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
};

export type AiGatewayTextResult = {
  modelKey: string;
  outputText: string;
  providerKey: string;
  providerRequest: unknown;
  providerResponse: unknown;
  status: "succeeded";
  usage: AiGatewayUsage;
};

export type MediaOutput = {
  base64?: string | null;
  durationMs?: number | null;
  filename?: string | null;
  height?: number | null;
  mimeType?: string | null;
  url?: string | null;
  width?: number | null;
};

export type PollTaskRequest = {
  model?: string | null;
  providerTaskId: string;
  routeId?: string | null;
  routeKey?: string | null;
};

export type ProviderCallContext = {
  apiKey: string;
  baseUrl: string;
  modelKey: string;
  providerKey: string;
  requestConfig: Record<string, unknown>;
  routeId: string;
  routeKey: string;
  timeoutMs: number;
};

export type ProviderTextGenerationResult = {
  modelKey: string;
  outputText: string;
  providerRequest: unknown;
  providerResponse: unknown;
  usage: AiGatewayUsage;
};

export type ProviderMediaGenerationResult = {
  modelKey: string;
  outputs?: MediaOutput[] | null;
  providerRequest: unknown;
  providerResponse: unknown;
  providerTaskId?: string | null;
  status: "succeeded" | "waiting_provider";
  usage: AiGatewayUsage;
};

export type ProviderTaskResult = {
  error?: Record<string, unknown> | null;
  mimeType?: string | null;
  outputBase64?: string[] | null;
  outputUrls?: string[] | null;
  outputs?: MediaOutput[] | null;
  providerRequest?: unknown;
  providerResponse?: unknown;
  providerTaskId?: string | null;
  status: "pending" | "running" | "succeeded" | "failed";
  usage?: AiGatewayUsage | null;
};

export type AiGatewayMediaResult = {
  modelKey: string;
  outputs?: MediaOutput[] | null;
  providerKey: string;
  providerRequest: unknown;
  providerResponse: unknown;
  providerTaskId?: string | null;
  status: "succeeded" | "waiting_provider" | "failed";
  usage?: AiGatewayUsage | null;
};

export type ResolvedRoute = {
  baseUrl: string;
  credential: {
    authTag: Buffer | null;
    encryptedSecret: Buffer | null;
    id: string | null;
    nonce: Buffer | null;
  };
  model: {
    id: string | null;
    modelKey: string | null;
  };
  priority: number;
  provider: {
    defaultBaseUrl: string | null;
    id: string;
    key: string;
    kind: string;
  };
  requestConfig: Record<string, unknown>;
  routeId: string;
  routeKey: string;
  status: string;
  tenantId: string | null;
  weight: number;
};
