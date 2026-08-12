import type { MySqlRunDiff } from "./mysql.js";
import type { JsonValue, StepRunResult, TestRun } from "./persistence.js";

export interface RunHistoryFilters {
  testId?: string;
  statuses?: TestRun["status"][];
}

export interface RunHistoryEntry {
  run: TestRun;
  testName: string;
  datasetName?: string;
  durationMs?: number;
  stepCount: number;
  failedStepCount: number;
  fallbackStepCount: number;
}

export interface RunHistoryDataset {
  id?: string;
  name?: string;
  values: JsonValue;
}

export interface RunHistoryImapResult {
  stepId: string;
  status: StepRunResult["status"];
  error?: JsonValue;
  logs: JsonValue[];
}

export interface RunHistoryDetails {
  entry: RunHistoryEntry;
  steps: StepRunResult[];
  dataset?: RunHistoryDataset;
  mysqlDiffs: MySqlRunDiff[];
  imapResults: RunHistoryImapResult[];
  postRunResult?: JsonValue;
  error?: JsonValue;
}

export interface RunStorageUsage {
  runCount: number;
  metadataBytes: number;
  logsBytes: number;
  snapshotsBytes: number;
  totalBytes: number;
}

export type RunHistoryPurgeTarget = "snapshots" | "logs";

export interface RunHistoryMutationResult {
  affected: number;
  storage: RunStorageUsage;
}
