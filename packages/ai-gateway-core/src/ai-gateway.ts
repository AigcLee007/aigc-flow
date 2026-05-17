import { AiGatewayError } from "./errors.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type {
  AiGatewayTextResult,
  ProviderCallContext,
  ResolvedRoute,
  TextGenerationRequest,
} from "./types.js";

export class AiGateway {
  private readonly adapters: Map<string, ProviderAdapter>;

  constructor(adapters: Record<string, ProviderAdapter>) {
    this.adapters = new Map(Object.entries(adapters));
  }

  async generateText(options: {
    apiKey: string;
    request: TextGenerationRequest;
    route: ResolvedRoute;
  }): Promise<AiGatewayTextResult> {
    const adapter = this.adapters.get(options.route.provider.kind);
    if (!adapter) {
      throw new AiGatewayError({
        code: "ADAPTER_NOT_FOUND",
        message: `No provider adapter is registered for ${options.route.provider.kind}`,
        statusCode: 500,
      });
    }

    const modelKey = options.request.model?.trim() || options.route.model.modelKey;
    if (!modelKey) {
      throw new AiGatewayError({
        code: "MODEL_REQUIRED",
        message: "A text generation model is required for the selected route",
        statusCode: 400,
      });
    }

    const context: ProviderCallContext = {
      apiKey: options.apiKey,
      baseUrl: options.route.baseUrl,
      modelKey,
      providerKey: options.route.provider.key,
      requestConfig: options.route.requestConfig,
      routeId: options.route.routeId,
      routeKey: options.route.routeKey,
      timeoutMs: this.resolveTimeout(options.route.requestConfig),
    };

    const result = await adapter.generateText(context, options.request);

    return {
      modelKey: result.modelKey,
      outputText: result.outputText,
      providerKey: options.route.provider.key,
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
      status: "succeeded",
      usage: result.usage,
    };
  }

  private resolveTimeout(requestConfig: Record<string, unknown>): number {
    const raw = requestConfig.timeoutMs;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 10_000;
  }
}
