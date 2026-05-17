import { AiGatewayError } from "./errors.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type {
  AiGatewayMediaResult,
  AiGatewayTextResult,
  ImageGenerationRequest,
  PollTaskRequest,
  ProviderCallContext,
  ProviderTaskResult,
  ResolvedRoute,
  TextGenerationRequest,
  VideoGenerationRequest,
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
    const { adapter, context } = this.createProviderContext(
      options.apiKey,
      options.route,
      options.request.model ?? null,
      "text generation",
    );
    if (!adapter.generateText) {
      throw this.unsupportedOperationError(options.route.provider.kind, "text generation");
    }

    const result = await adapter.generateText(context, options.request);

    return {
      modelId: options.route.model.id,
      modelKey: result.modelKey,
      outputText: result.outputText,
      providerId: options.route.provider.id,
      providerKey: options.route.provider.key,
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
      routeId: options.route.routeId,
      status: "succeeded",
      usage: result.usage,
    };
  }

  async generateImage(options: {
    apiKey: string;
    request: ImageGenerationRequest;
    route: ResolvedRoute;
  }): Promise<AiGatewayMediaResult> {
    const { adapter, context } = this.createProviderContext(
      options.apiKey,
      options.route,
      options.request.model ?? null,
      "image generation",
    );
    if (!adapter.generateImage) {
      throw this.unsupportedOperationError(options.route.provider.kind, "image generation");
    }

    const result = await adapter.generateImage(context, options.request);
    return {
      modelId: options.route.model.id,
      modelKey: result.modelKey,
      outputs: result.outputs ?? [],
      providerId: options.route.provider.id,
      providerKey: options.route.provider.key,
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
      providerTaskId: result.providerTaskId ?? null,
      routeId: options.route.routeId,
      status: result.status,
      usage: result.usage,
    };
  }

  async generateVideo(options: {
    apiKey: string;
    request: VideoGenerationRequest;
    route: ResolvedRoute;
  }): Promise<AiGatewayMediaResult> {
    const { adapter, context } = this.createProviderContext(
      options.apiKey,
      options.route,
      options.request.model ?? null,
      "video generation",
    );
    if (!adapter.generateVideo) {
      throw this.unsupportedOperationError(options.route.provider.kind, "video generation");
    }

    const result = await adapter.generateVideo(context, options.request);
    return {
      modelId: options.route.model.id,
      modelKey: result.modelKey,
      outputs: result.outputs ?? [],
      providerId: options.route.provider.id,
      providerKey: options.route.provider.key,
      providerRequest: result.providerRequest,
      providerResponse: result.providerResponse,
      providerTaskId: result.providerTaskId ?? null,
      routeId: options.route.routeId,
      status: result.status,
      usage: result.usage,
    };
  }

  async pollTask(options: {
    apiKey: string;
    request: PollTaskRequest;
    route: ResolvedRoute;
  }): Promise<ProviderTaskResult> {
    const { adapter, context } = this.createProviderContext(
      options.apiKey,
      options.route,
      options.request.model ?? null,
      "task polling",
    );
    if (!adapter.pollTask) {
      throw this.unsupportedOperationError(options.route.provider.kind, "task polling");
    }

    const result = await adapter.pollTask(context, options.request);
    return {
      ...result,
      modelId: options.route.model.id,
      providerId: options.route.provider.id,
      routeId: options.route.routeId,
    };
  }

  private createProviderContext(
    apiKey: string,
    route: ResolvedRoute,
    requestModel: string | null,
    operationLabel: string,
  ): {
    adapter: ProviderAdapter;
    context: ProviderCallContext;
  } {
    const adapter = this.adapters.get(route.provider.kind);
    if (!adapter) {
      throw new AiGatewayError({
        code: "ADAPTER_NOT_FOUND",
        message: `No provider adapter is registered for ${route.provider.kind}`,
        statusCode: 500,
      });
    }

    const modelKey = requestModel?.trim() || route.model.modelKey;
    if (!modelKey) {
      throw new AiGatewayError({
        code: "MODEL_REQUIRED",
        message: `A model is required for ${operationLabel} on the selected route`,
        statusCode: 400,
      });
    }

    return {
      adapter,
      context: {
        apiKey,
        baseUrl: route.baseUrl,
        modelKey,
        providerKey: route.provider.key,
        requestConfig: route.requestConfig,
        routeId: route.routeId,
        routeKey: route.routeKey,
        timeoutMs: this.resolveTimeout(route.requestConfig),
      },
    };
  }

  private resolveTimeout(requestConfig: Record<string, unknown>): number {
    const raw = requestConfig.timeoutMs;
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : 10_000;
  }

  private unsupportedOperationError(providerKind: string, operationLabel: string): AiGatewayError {
    return new AiGatewayError({
      code: "ADAPTER_OPERATION_NOT_SUPPORTED",
      message: `Provider adapter ${providerKind} does not support ${operationLabel}`,
      statusCode: 400,
    });
  }
}
