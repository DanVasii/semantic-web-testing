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
