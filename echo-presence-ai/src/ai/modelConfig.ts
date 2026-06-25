/**
 * Centralized model configuration for the Lumi AI pipeline.
 *
 * TODO: wire real model identifiers / endpoints once integrations are chosen.
 * Keep this file as the single source of truth so individual stages stay swappable.
 */

export type ModelProvider = "local" | "api" | "mock";

export interface ModelDescriptor {
  provider: ModelProvider;
  /** Model identifier — e.g. "phowhisper-large", "xtts-v2", "qwen-2.5-7b". */
  model: string;
  /** Optional endpoint for API-hosted models. */
  endpoint?: string;
  /** Free-form extra options passed to the implementation. */
  options?: Record<string, unknown>;
}

export interface LumiModelConfig {
  addresseeDetection: ModelDescriptor;
  semanticVAD: ModelDescriptor;
  asr: ModelDescriptor;
  speakerVerification: ModelDescriptor;
  emotionRecognition: ModelDescriptor;
  llm: ModelDescriptor;
  tts: ModelDescriptor;
}

/** Default configuration — all stages are mocked until real models are wired in. */
export const defaultModelConfig: LumiModelConfig = {
  addresseeDetection: { provider: "mock", model: "addressee-mock-v0" },
  semanticVAD: { provider: "mock", model: "semantic-vad-mock-v0" },
  asr: { provider: "mock", model: "phowhisper-mock-v0" },
  speakerVerification: { provider: "mock", model: "ecapa-mock-v0" },
  emotionRecognition: { provider: "mock", model: "emotion-mock-v0" },
  llm: { provider: "mock", model: "empathetic-llm-mock-v0" },
  tts: { provider: "mock", model: "xtts-mock-v0" },
};
