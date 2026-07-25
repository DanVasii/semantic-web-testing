import type { JsonValue } from "./persistence.js";

export const AI_PROVIDER_IDS = ["none", "ollama", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TASKS = [
  "analyze_step",
  "generate_test",
  "repair_locator",
] as const;
export type AiTask = (typeof AI_TASKS)[number];

export interface AiModelInfo {
  id: string;
  displayName: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
}

export interface AiSettingsSummary {
  provider: AiProviderId;
  ollama: {
    baseUrl: string;
    model: string;
  };
  gemini: {
    model: string;
    apiKeyConfigured: boolean;
  };
  updatedAt?: string;
}

export interface SaveAiSettingsInput {
  provider: AiProviderId;
  ollamaBaseUrl: string;
  ollamaModel: string;
  geminiModel: string;
  geminiApiKey?: string;
  clearGeminiApiKey?: boolean;
}

export interface AiConnectionTestResult {
  provider: Exclude<AiProviderId, "none">;
  success: boolean;
  message: string;
  latencyMs: number;
  models: AiModelInfo[];
}

export interface CreateAiRequestPreviewInput {
  task: AiTask;
  context: JsonValue;
  provider?: AiProviderId;
  model?: string;
}

export interface AiRequestPreview {
  task: AiTask;
  provider: AiProviderId;
  model: string;
  systemInstruction: string;
  prompt: string;
  outputSchema: JsonValue;
  contextPreview: JsonValue;
  estimatedInputTokens: number;
  originalContextBytes: number;
  sentContextBytes: number;
  omittedPaths: string[];
}

export interface AiTokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiGenerationResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  output: JsonValue;
  usage: AiTokenUsage;
}
