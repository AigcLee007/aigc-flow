export type AiGatewayErrorCode =
  | "ADAPTER_NOT_FOUND"
  | "ADAPTER_OPERATION_NOT_SUPPORTED"
  | "CREDENTIAL_REQUIRED"
  | "MODEL_REQUIRED"
  | "PROVIDER_AUTH_FAILED"
  | "PROVIDER_BAD_REQUEST"
  | "PROVIDER_INTERNAL_ERROR"
  | "PROVIDER_INVALID_RESPONSE"
  | "PROVIDER_RATE_LIMIT"
  | "PROVIDER_TIMEOUT"
  | "ROUTE_NOT_FOUND";

export class AiGatewayError extends Error {
  readonly code: AiGatewayErrorCode;
  readonly details: unknown;
  readonly providerRequest: unknown;
  readonly providerResponse: unknown;
  readonly statusCode: number;

  constructor(options: {
    code: AiGatewayErrorCode;
    details?: unknown;
    message: string;
    providerRequest?: unknown;
    providerResponse?: unknown;
    statusCode?: number;
  }) {
    super(options.message);
    this.code = options.code;
    this.details = options.details;
    this.name = "AiGatewayError";
    this.providerRequest = options.providerRequest ?? null;
    this.providerResponse = options.providerResponse ?? null;
    this.statusCode = options.statusCode ?? 500;
  }
}
