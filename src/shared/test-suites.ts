export interface TestSuiteItem {
  testId: string;
  datasetId?: string;
}

export interface TestSuiteSettings {
  clearSessionBeforeEach: boolean;
  continueOnFailure: boolean;
  maxStepRetries: number;
}

export interface TestSuite {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  items: TestSuiteItem[];
  settings: TestSuiteSettings;
  createdAt: string;
  updatedAt: string;
}

export interface SaveTestSuiteInput {
  name: string;
  description?: string;
  items: TestSuiteItem[];
  settings: TestSuiteSettings;
}

export type BatchRunStatus = "running" | "passed" | "failed" | "stopped";

export type BatchRunItemStatus =
  "queued" | "running" | "passed" | "flaky" | "failed" | "stopped" | "skipped";

export interface BatchRunItem {
  id: string;
  batchRunId: string;
  testId: string;
  testName: string;
  position: number;
  datasetId?: string;
  runId?: string;
  status: BatchRunItemStatus;
  retryCount: number;
  error?: string;
}

export interface BatchRun {
  id: string;
  projectId: string;
  suiteId?: string;
  name: string;
  status: BatchRunStatus;
  settings: TestSuiteSettings;
  startedAt: string;
  endedAt?: string;
  cleanupStatus?: "preserved" | "completed" | "failed";
  items: BatchRunItem[];
}

export interface CreateBatchRunInput {
  projectId: string;
  suiteId?: string;
  name: string;
  settings: TestSuiteSettings;
  items: Array<{
    testId: string;
    testName: string;
    datasetId?: string;
  }>;
}

export interface UpdateBatchRunItemInput {
  itemId: string;
  status: BatchRunItemStatus;
  runId?: string;
  retryCount: number;
  error?: string;
}

export interface FlakyTestStatistic {
  testId: string;
  testName: string;
  totalRuns: number;
  flakyRuns: number;
  failedRuns: number;
  flakyRate: number;
}

export type RunArtifactKind =
  "screenshot" | "html" | "console" | "network" | "trace";

export interface RunArtifact {
  id: string;
  runId: string;
  kind: RunArtifactKind;
  filePath: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
