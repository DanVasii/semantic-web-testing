import type { StepRunResult, TestRun } from "./persistence.js";
import type { ImapMatchedMessage } from "./imap.js";
import type { AiRunPlanProposal } from "./ai.js";
import type { MySqlCleanupRowSelection, MySqlRunDetails } from "./mysql.js";
import type { LocatorDefinition, TestFlowItem } from "./test-model.js";
import type {
  PostRunAiEvaluation,
  RunPostRunSelection,
} from "./post-run-checks.js";

export const RUNNER_STATES = [
  "idle",
  "preparing",
  "browser_starting",
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
  | "mysql_failed"
  | "imap_failed"
  | "wipe_failed"
  | "step_failed"
  | "unsupported_step";

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
  kind: "before_start" | "breakpoint" | "after_step";
  title: string;
  instructions?: string;
  previousStepId?: string;
  nextStepId?: string;
}

export type MissingDataInputKind =
  "text" | "password" | "checkbox" | "select" | "radio";

export interface MissingDataDetails {
  fieldId: string;
  valueKey: string;
  inputKind: MissingDataInputKind;
  locator: LocatorDefinition;
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
}

export interface RunnerSnapshot {
  state: RunnerState;
  run?: TestRun;
  currentStepIndex: number;
  totalSteps: number;
  flowItems?: TestFlowItem[];
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
  canStop: boolean;
  canRetry: boolean;
}

export interface StartRunInput {
  projectId: string;
  testId: string;
  datasetId?: string;
  mode?: RunMode;
  waitBeforeStart?: boolean;
  aiPlan?: {
    baseVersion: number;
    instruction: string;
    proposal: AiRunPlanProposal;
  };
  postRun?: RunPostRunSelection;
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
