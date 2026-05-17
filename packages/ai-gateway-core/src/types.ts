export type TextMessage = {
  content: string;
  role: "assistant" | "system" | "user";
};

export type TextGenerationRequest = {
  maxTokens?: number | null;
  messages: TextMessage[];
  model?: string | null;
  routeKey?: string | null;
  temperature?: number | null;
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
