import type {
  ProviderCallContext,
  ProviderTextGenerationResult,
  TextGenerationRequest,
} from "./types.js";

export interface ProviderAdapter {
  generateText(
    context: ProviderCallContext,
    request: TextGenerationRequest,
  ): Promise<ProviderTextGenerationResult>;
}
