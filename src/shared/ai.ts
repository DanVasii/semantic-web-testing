import type { JsonValue } from "./persistence.js";

export const AI_PROVIDER_IDS = ["none", "ollama", "gemini"] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TASKS = [
  "analyze_step",
  "edit_step",
  "adapt_run",
  "generate_test",
  "repair_locator",
  "evaluate_post_run",
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
  outputSchema?: JsonValue;
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

export interface AiEditableStepPatch {
  title?: string;
  humanDescription?: string;
  whyExplanation?: string;
  instructions?: string;
  primaryLocator?: {
    type:
      | "css"
      | "role"
      | "label"
      | "text"
      | "title"
      | "placeholder"
      | "data_attribute";
    operator:
      | "equals"
      | "contains"
      | "contains_all_keywords"
      | "contains_any_keyword"
      | "starts_with"
      | "ends_with"
      | "regex";
    value: string;
    role?: string;
    attribute?: string;
  };
}

export interface AiStepChangeProposal {
  stepId: string;
  patch: AiEditableStepPatch;
  rationale: string;
}

export interface AiStepEditProposal {
  summary: string;
  currentStepChange: AiStepChangeProposal;
  downstreamChanges: AiStepChangeProposal[];
}

export interface AiStepEditInput {
  projectId: string;
  testId: string;
  selectedStepId: string;
  instruction: string;
  provider?: AiProviderId;
  model?: string;
}

export interface AiStepContextSummary {
  selectedStepId: string;
  previousStepIds: string[];
  nextStepIds: string[];
  pageIds: string[];
}

export interface AiStepEditPreview {
  request: AiRequestPreview;
  context: AiStepContextSummary;
}

export interface AiStepFieldDiff {
  stepId: string;
  field:
    | "title"
    | "humanDescription"
    | "whyExplanation"
    | "instructions"
    | "primaryLocator";
  before?: JsonValue;
  after: JsonValue;
}

export interface AiStepEditResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  proposal: AiStepEditProposal;
  diffs: AiStepFieldDiff[];
  usage: AiTokenUsage;
}

export interface ApplyAiStepChangesInput {
  projectId: string;
  testId: string;
  baseVersion: number;
  selectedStepId: string;
  proposal: AiStepEditProposal;
  approvedDownstreamStepIds: string[];
}

export interface ApplyAiStepChangesResult {
  test: import("./persistence.js").TestDefinition;
  appliedStepIds: string[];
  aiVersion: number;
}

export interface UndoAiStepChangeInput {
  projectId: string;
  testId: string;
  aiVersion: number;
}

export interface AiRunStepPatch {
  primaryLocator?: AiEditableStepPatch["primaryLocator"];
  repeat?: number;
  repeatUntil?: {
    target: NonNullable<AiEditableStepPatch["primaryLocator"]>;
    operator:
      | "equals"
      | "contains"
      | "contains_all_keywords"
      | "contains_any_keyword"
      | "starts_with"
      | "ends_with"
      | "regex";
    value: string;
    maxAttempts: number;
  };
  datasetValue?: string;
}

export interface AiRunStepChange {
  stepId: string;
  patch: AiRunStepPatch;
  rationale: string;
}

export interface AiRunStepInsertion {
  anchorStepId: string;
  position: "before" | "after";
  action: {
    actionType:
      "click" | "calendar_select" | "select_option" | "wait_for_element";
    title: string;
    humanDescription: string;
    whyExplanation: string;
    primaryLocator: NonNullable<AiEditableStepPatch["primaryLocator"]>;
    datasetValue?: string;
    repeat?: number;
    repeatUntil?: NonNullable<AiRunStepPatch["repeatUntil"]>;
  };
  rationale: string;
}

export interface AiRunPlanProposal {
  summary: string;
  changes: AiRunStepChange[];
  insertions: AiRunStepInsertion[];
}

export interface AiRunPlanInput {
  projectId: string;
  testId: string;
  instruction: string;
  provider?: AiProviderId;
  model?: string;
}

export interface AiRunPlanPreview {
  request: AiRequestPreview;
  stepIds: string[];
  pageIds: string[];
}

export interface AiRunPlanResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  proposal: AiRunPlanProposal;
  usage: AiTokenUsage;
}
