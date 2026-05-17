import { AiGatewayError } from "./errors.js";
import type { ProviderAdapter } from "./provider-adapter.js";
import type {
  ProviderCallContext,
  ProviderTextGenerationResult,
  TextGenerationRequest,
} from "./types.js";

type FetchLike = typeof fetch;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

async function readResponseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

export class OpenAiCompatibleTextAdapter implements ProviderAdapter {
  private readonly fetchImplementation: FetchLike;

  constructor(options?: { fetchImplementation?: FetchLike }) {
    this.fetchImplementation = options?.fetchImplementation ?? fetch;
  }

  async generateText(
    context: ProviderCallContext,
    request: TextGenerationRequest,
  ): Promise<ProviderTextGenerationResult> {
    const requestConfig = asRecord(context.requestConfig);
    const payload = {
      max_tokens:
        request.maxTokens ??
        getNumber(requestConfig.maxTokens) ??
        getNumber(requestConfig.max_tokens),
      messages: request.messages,
      model: request.model?.trim() || context.modelKey,
      temperature:
        request.temperature ??
        getNumber(requestConfig.temperature),
    };
    const providerRequest = {
      body: payload,
      headers: {
        Authorization: `Bearer ${context.apiKey}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      url: `${context.baseUrl.replace(/\/$/, "")}/chat/completions`,
    };

    let response: Response;
    try {
      response = await this.fetchImplementation(providerRequest.url, {
        body: JSON.stringify(payload),
        headers: providerRequest.headers,
        method: "POST",
        signal: AbortSignal.timeout(context.timeoutMs),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        throw new AiGatewayError({
          code: "PROVIDER_TIMEOUT",
          message: "The provider request timed out",
          providerRequest,
          statusCode: 504,
        });
      }

      throw new AiGatewayError({
        code: "PROVIDER_INTERNAL_ERROR",
        details: error instanceof Error ? error.message : String(error),
        message: "The provider request failed before a response was received",
        providerRequest,
        statusCode: 502,
      });
    }

    const providerResponse = {
      body: await readResponseBody(response),
      status: response.status,
    };

    if (!response.ok) {
      throw this.mapError(response.status, providerRequest, providerResponse);
    }

    const responseBody = asRecord(providerResponse.body);
    const choices = Array.isArray(responseBody.choices) ? responseBody.choices : [];
    const firstChoice = asRecord(choices[0]);
    const message = asRecord(firstChoice.message);
    const content = message.content;

    if (typeof content !== "string" || !content.length) {
      throw new AiGatewayError({
        code: "PROVIDER_INVALID_RESPONSE",
        message: "The provider response did not contain text output",
        providerRequest,
        providerResponse,
        statusCode: 502,
      });
    }

    const usage = asRecord(responseBody.usage);

    return {
      modelKey: payload.model,
      outputText: content,
      providerRequest,
      providerResponse,
      usage: {
        inputTokens: getNumber(usage.prompt_tokens),
        outputTokens: getNumber(usage.completion_tokens),
        totalTokens: getNumber(usage.total_tokens),
      },
    };
  }

  private mapError(
    status: number,
    providerRequest: unknown,
    providerResponse: unknown,
  ): AiGatewayError {
    if (status === 401 || status === 403) {
      return new AiGatewayError({
        code: "PROVIDER_AUTH_FAILED",
        message: "The provider rejected the credential",
        providerRequest,
        providerResponse,
        statusCode: 502,
      });
    }

    if (status === 429) {
      return new AiGatewayError({
        code: "PROVIDER_RATE_LIMIT",
        message: "The provider rate limit was exceeded",
        providerRequest,
        providerResponse,
        statusCode: 429,
      });
    }

    if (status === 400) {
      return new AiGatewayError({
        code: "PROVIDER_BAD_REQUEST",
        message: "The provider rejected the request payload",
        providerRequest,
        providerResponse,
        statusCode: 400,
      });
    }

    if (status >= 500) {
      return new AiGatewayError({
        code: "PROVIDER_INTERNAL_ERROR",
        message: "The provider returned an internal error",
        providerRequest,
        providerResponse,
        statusCode: 502,
      });
    }

    return new AiGatewayError({
      code: "PROVIDER_INTERNAL_ERROR",
      message: "The provider request failed",
      providerRequest,
      providerResponse,
      statusCode: 502,
    });
  }
}
