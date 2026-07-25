import type { StepRunResult, TestRun } from "./persistence.js";
import type { LocatorDefinition } from "./test-model.js";

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
  | "dataset_missing"
  | "invalid_test"
  | "locator_not_found"
  | "locator_ambiguous"
  | "missing_data"
  | "wipe_failed"
  | "step_failed"
  | "unsupported_step";

export interface RunnerErrorDetails {
  code: RunnerErrorCode;
  message: string;
  count?: number;
  stepId?: string;
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

export interface RunnerSnapshot {
  state: RunnerState;
  run?: TestRun;
  currentStepIndex: number;
  totalSteps: number;
  currentStepId?: string;
  message?: string;
  error?: RunnerErrorDetails;
  fallback?: FallbackDecision;
  pause?: RunnerPauseDetails;
  missingData?: MissingDataDetails;
  wipe?: WipeDetails;
  canStop: boolean;
  canRetry: boolean;
}

export interface StartRunInput {
  projectId: string;
  testId: string;
  datasetId?: string;
  mode?: RunMode;
  waitBeforeStart?: boolean;
}

export interface RunDetails {
  snapshot: RunnerSnapshot;
  stepResults: StepRunResult[];
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
