import type {
  ImageGenerationRequest,
  PollTaskRequest,
  ProviderCallContext,
  ProviderMediaGenerationResult,
  ProviderTaskResult,
  ProviderTextGenerationResult,
  TextGenerationRequest,
  VideoGenerationRequest,
} from "./types.js";

export interface ProviderAdapter {
  generateText?(
    context: ProviderCallContext,
    request: TextGenerationRequest,
  ): Promise<ProviderTextGenerationResult>;

  generateImage?(
    context: ProviderCallContext,
    request: ImageGenerationRequest,
  ): Promise<ProviderMediaGenerationResult>;

  generateVideo?(
    context: ProviderCallContext,
    request: VideoGenerationRequest,
  ): Promise<ProviderMediaGenerationResult>;

  pollTask?(
    context: ProviderCallContext,
    request: PollTaskRequest,
  ): Promise<ProviderTaskResult>;
}
