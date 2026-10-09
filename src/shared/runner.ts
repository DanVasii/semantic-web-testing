import type { JsonValue, StepRunResult, TestRun } from "./persistence.js";
import type { ImapMatchedMessage } from "./imap.js";
import type { AiProviderId, AiRunPlanProposal } from "./ai.js";
import type { MySqlCleanupRowSelection, MySqlRunDetails } from "./mysql.js";
import type {
  LocatorDefinition,
  TargetFrameContext,
  TestFlowItem,
} from "./test-model.js";
import type {
  PostRunAiEvaluation,
  RunPostRunSelection,
} from "./post-run-checks.js";
import type {
  SessionVariableType,
  SessionVariableValue,
  TestStage,
} from "./test-stages.js";

export const RUNNER_STATES = [
  "idle",
  "preparing",
  "browser_starting",
  "resolving_stage_entry",
  "capturing_stage_baseline",
  "waiting_for_basic_auth",
  "waiting_for_start",
  "running",
  "waiting_at_breakpoint",
  "waiting_after_step",
  "waiting_for_missing_data",
  "waiting_for_fallback_decision",
  "waiting_for_manual_intervention",
  "waiting_for_mysql_check",
  "waiting_for_imap_check",
  "waiting_for_ai_analysis",
  "waiting_for_variable",
  "transitioning_stage",
  "paused_on_error",
  "completed",
  "failed",
  "stopped",
] as const;

export type RunnerState = (typeof RUNNER_STATES)[number];

export const RUN_MODES = ["automatic", "breakpoints", "step_by_step"] as const;
export type RunMode = (typeof RUN_MODES)[number];

export type RunnerErrorCode =
  | "browser_unavailable"
  | "browser_disconnected"
  | "navigation_timeout"
  | "dataset_missing"
  | "invalid_test"
  | "locator_not_found"
  | "locator_ambiguous"
  | "missing_data"
  | "missing_variable"
  | "mysql_failed"
  | "imap_failed"
  | "wipe_failed"
  | "step_failed"
  | "unsupported_step";

export interface VisualCheckDebug {
  [key: string]: JsonValue;
  dataUrls: string[];
  mimeType: "image/jpeg" | "image/png";
  byteLength: number;
  prompt: string;
}

export interface VisualStepContextCapture {
  imageBase64: string;
  mimeType: "image/jpeg";
  viewportWidth: number;
  viewportHeight: number;
  capturedAt: string;
}

export interface RunnerErrorDetails {
  code: RunnerErrorCode;
  message: string;
  count?: number;
  stepId?: string;
  operation?: string;
  technicalDetails?: string;
  causeMessage?: string;
  occurredAt?: string;
  retryable?: boolean;
  severity?: "error" | "warning";
  visualCheckDebug?: VisualCheckDebug;
}

export class RunnerError extends Error {
  public constructor(
    public readonly code: RunnerErrorCode,
    message: string,
    public readonly details: Omit<RunnerErrorDetails, "code" | "message"> = {},
  ) {
    super(message);
    this.name = "RunnerError";
  }
}

export interface FallbackDecision {
  index: number;
  total: number;
  humanDescription: string;
  whyExplanation: string;
  locator: LocatorDefinition;
}

export interface RunnerPauseDetails {
  kind: "before_start" | "breakpoint" | "manual_intervention" | "after_step";
  title: string;
  instructions?: string;
  previousStepId?: string;
  nextStepId?: string;
}

export type MissingDataInputKind =
  "text" | "password" | "checkbox" | "select" | "radio" | "file";

export interface MissingDataDetails {
  fieldId: string;
  valueKey: string;
  inputKind: MissingDataInputKind;
  locator: LocatorDefinition;
  frame?: TargetFrameContext;
}

export type WipeResource =
  | "navigation"
  | "cookies"
  | "localStorage"
  | "sessionStorage"
  | "indexedDB"
  | "cacheStorage"
  | "serviceWorkers"
  | "permissions";

export const MANUAL_WIPE_RESOURCES = [
  "cookies",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
] as const satisfies readonly WipeResource[];

export type ManualWipeResource = (typeof MANUAL_WIPE_RESOURCES)[number];

export interface WipeLogEntry {
  resource: WipeResource;
  status: "cleared" | "skipped" | "failed";
  message: string;
  count?: number;
}

export interface WipeDetails {
  origin: string;
  status: "completed" | "failed";
  entries: WipeLogEntry[];
}

export interface ImapRunDetails {
  stepId: string;
  status: "waiting" | "matched" | "abandoned";
  message: string;
  startedAt: string;
  lastCheckedAt?: string;
  matchedAt?: string;
  accountId?: string;
  accountName?: string;
  matchedMessages?: ImapMatchedMessage[];
  allEvidence?: unknown;
}

export interface AiRunRequestDetail {
  id: string;
  reason: string;
  provider: Exclude<AiProviderId, "none">;
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd?: number;
  local: boolean;
  payload: JsonValue;
  response: JsonValue;
  createdAt: string;
}

export interface AiRunCost {
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedUsd: number;
  unpricedRequests: number;
  localOnly: boolean;
  /** Lipsește numai pentru rulările salvate înainte de introducerea detaliilor. */
  requests?: AiRunRequestDetail[];
}

export interface RunnerSnapshot {
  state: RunnerState;
  run?: TestRun;
  currentStepIndex: number;
  totalSteps: number;
  flowItems?: TestFlowItem[];
  checkItems?: Extract<TestFlowItem, { type: "check" }>[];
  currentStepId?: string;
  message?: string;
  error?: RunnerErrorDetails;
  fallback?: FallbackDecision;
  pause?: RunnerPauseDetails;
  missingData?: MissingDataDetails;
  wipe?: WipeDetails;
  cleanup?: WipeDetails;
  mysql?: MySqlRunDetails;
  imap?: ImapRunDetails;
  postRunAi?: PostRunAiEvaluation;
  aiCost?: AiRunCost;
  stages?: TestStage[];
  stage?: {
    stageId: string;
    stageIndex: number;
    totalStages: number;
    phase:
      | "resolving_entry"
      | "capturing_baseline"
      | "running_flow"
      | "running_checks"
      | "completed";
    currentCheckIndex: number;
    totalChecks: number;
  };
  variables?: SessionVariableValue[];
  missingVariable?: {
    variableName: string;
    expectedType: SessionVariableType;
    stageId: string;
    consumerId: string;
    producerId?: string;
    reason:
      | "not_produced"
      | "empty_value"
      | "type_mismatch"
      | "no_rows"
      | "ambiguous_rows"
      | "missing_column"
      | "invalid_url"
      | "collision";
    message: string;
    candidateCount?: number;
    canRetryProducer: boolean;
    canProvideManualValue: boolean;
  };
  canStop: boolean;
  canRetry: boolean;
}

export interface StartRunInput {
  projectId: string;
  testId: string;
  datasetId?: string;
  mode?: RunMode;
  waitBeforeStart?: boolean;
  clearSessionBeforeRun?: boolean;
  aiPlan?: {
    baseVersion: number;
    instruction: string;
    proposal: AiRunPlanProposal;
  };
  postRun?: RunPostRunSelection;
  aiProvider?: Exclude<AiProviderId, "none">;
  aiModel?: string;
  missingVariablePolicy?: "pause" | "fail";
  /** Rulează numai pașii flow-ului, fără checks și post-run. */
  flowOnly?: boolean;
  /** Limitează rularea la etapa selectată. */
  stageId?: string;
}

export interface RunDetails {
  snapshot: RunnerSnapshot;
  stepResults: StepRunResult[];
}

export interface PreviewMySqlCleanupInput {
  runId: string;
  diffId: string;
  rows: MySqlCleanupRowSelection[];
}

export const isRunnerSnapshot = (value: unknown): value is RunnerSnapshot => {
  if (typeof value !== "object" || value === null) return false;
  return (
    "state" in value &&
    typeof value.state === "string" &&
    (RUNNER_STATES as readonly string[]).includes(value.state) &&
    "currentStepIndex" in value &&
    typeof value.currentStepIndex === "number" &&
    "totalSteps" in value &&
    typeof value.totalSteps === "number" &&
    "canStop" in value &&
    typeof value.canStop === "boolean" &&
    "canRetry" in value &&
    typeof value.canRetry === "boolean"
  );
};
