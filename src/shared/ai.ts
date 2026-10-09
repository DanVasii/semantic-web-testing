import type { JsonValue } from "./persistence.js";
import type {
  ActionStep,
  CheckStep,
  DatasetPrimitive,
  ElementCheckConfig,
  JsEvalCheckConfig,
  VisualCheckConfig,
  AdaptiveCheckConfig,
  TextCheckConfig,
  UrlCheckConfig,
} from "./test-model.js";

export const AI_PROVIDER_IDS = [
  "none",
  "ollama",
  "lm_studio",
  "gemini",
  "openai",
] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

export const AI_TASKS = [
  "analyze_step",
  "edit_step",
  "create_step",
  "adapt_run",
  "generate_test",
  "generate_form_tests",
  "repair_locator",
  "evaluate_post_run",
  "select_google_pay_card",
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
  lmStudio: {
    baseUrl: string;
    model: string;
  };
  gemini: {
    model: string;
    apiKeyConfigured: boolean;
  };
  openai: {
    model: string;
    apiKeyConfigured: boolean;
  };
  updatedAt?: string;
}

export interface SaveAiSettingsInput {
  provider: AiProviderId;
  ollamaBaseUrl: string;
  ollamaModel: string;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  geminiModel: string;
  geminiApiKey?: string;
  clearGeminiApiKey?: boolean;
  openaiModel?: string;
  openaiApiKey?: string;
  clearOpenaiApiKey?: boolean;
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

export type PricedAiProviderId = Extract<AiProviderId, "gemini" | "openai">;

export interface AiModelPricing {
  provider: PricedAiProviderId;
  model: string;
  status: "available" | "unavailable";
  source?: "litellm" | "manual";
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  cachedInputPerMillionUsd?: number;
  matchedModelId?: string;
  fetchedAt?: string;
  expiresAt?: string;
  message?: string;
  staleManualInputPerMillionUsd?: number;
  staleManualOutputPerMillionUsd?: number;
}

export interface SaveAiModelPricingInput {
  provider: PricedAiProviderId;
  model: string;
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
}

export interface AiVisualCheckInput {
  prompt: string;
  imagesBase64: string[];
  mimeType: "image/jpeg" | "image/png";
  aiProvider?: Exclude<AiProviderId, "none">;
  aiModel?: string;
}

export interface AiVisualCheckResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  passed: boolean;
  confidence: number;
  explanation: string;
  evidence: string[];
  usage: AiTokenUsage;
}

export interface AiVisualActionHistoryEntry {
  actionNumber: number;
  x: number;
  y: number;
  observation: string;
}

export interface AiVisualActionInput {
  instruction: string;
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png";
  actionCount: number;
  maxActions: 5;
  history: AiVisualActionHistoryEntry[];
  aiProvider?: Exclude<AiProviderId, "none">;
  aiModel?: string;
}

export interface AiVisualActionResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  status: "click" | "done" | "loading" | "error" | "failed";
  /** Coordonate normalizate în imaginea primită. */
  x?: number;
  y?: number;
  confidence: number;
  observation: string;
  usage: AiTokenUsage;
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
  checkType?: "element" | "text" | "url" | "js_eval" | "visual" | "adaptive";
  checkConfig?:
    | ElementCheckConfig
    | TextCheckConfig
    | UrlCheckConfig
    | JsEvalCheckConfig
    | VisualCheckConfig
    | AdaptiveCheckConfig;
  timeoutMs?: number;
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
    | "primaryLocator"
    | "checkType"
    | "checkConfig"
    | "timeoutMs";
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

export interface AiSimilarTestDatasetValue {
  key: string;
  value: DatasetPrimitive;
}

export interface AiSimilarTestDatasetProposal {
  name: string;
  values: AiSimilarTestDatasetValue[];
}

export interface AiSimilarTestStepInsertion {
  anchorStepId: string;
  position: "before" | "after";
  step: ActionStep | CheckStep;
  rationale: string;
}

export interface AiSimilarTestStepRemoval {
  stepId: string;
  rationale: string;
}

export interface AiSimilarTestProposal {
  summary: string;
  name: string;
  description: string;
  datasets: AiSimilarTestDatasetProposal[];
  changes: AiStepChangeProposal[];
  insertions: AiSimilarTestStepInsertion[];
  removals: AiSimilarTestStepRemoval[];
}

export const AI_SIMILAR_TEST_CONTEXT_MODES = [
  "economic",
  "balanced",
  "full",
] as const;
export type AiSimilarTestContextMode =
  (typeof AI_SIMILAR_TEST_CONTEXT_MODES)[number];

export interface AiSimilarTestTokenBreakdown {
  instructions: number;
  sourceTest: number;
  datasets: number;
  pageContext: number;
  outputSchema: number;
  estimatedTotal: number;
}

export interface AiSimilarTestInput {
  projectId: string;
  sourceTestId: string;
  instruction: string;
  contextMode?: AiSimilarTestContextMode;
  provider?: AiProviderId;
  model?: string;
}

export interface AiSimilarTestRequestPreview {
  request: AiRequestPreview;
  baseVersion: number;
  stepIds: string[];
  datasetNames: string[];
  contextMode: AiSimilarTestContextMode;
  tokenBreakdown: AiSimilarTestTokenBreakdown;
}

export type AiSimilarTestDiffKind =
  | "metadata"
  | "dataset_added"
  | "step_modified"
  | "step_added"
  | "step_removed";

export interface AiSimilarTestDiff {
  kind: AiSimilarTestDiffKind;
  label: string;
  stepId?: string;
  before?: JsonValue;
  after?: JsonValue;
  rationale?: string;
}

export interface AiSimilarTestResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  baseVersion: number;
  proposal: AiSimilarTestProposal;
  diffs: AiSimilarTestDiff[];
  usage: AiTokenUsage;
}

export interface CreateAiSimilarTestInput {
  projectId: string;
  sourceTestId: string;
  baseVersion: number;
  instruction: string;
  provider: Exclude<AiProviderId, "none">;
  model: string;
  proposal: AiSimilarTestProposal;
}

export interface CreateAiSimilarTestResult {
  test: import("./persistence.js").TestDefinition;
  datasets: import("./test-model.js").TestDataset[];
}
