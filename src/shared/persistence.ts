export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type BrowserType = "chrome" | "chromium" | "firefox" | "webkit";
export type BrowserSessionMode =
  "temporary" | "reusable" | "persistent_profile" | "external_chrome_debug";

export interface BrowserConfig {
  browserType: BrowserType;
  sessionMode: BrowserSessionMode;
  headless: false;
  chromeExecutablePath?: string;
  profilePath?: string;
  remoteDebuggingPort?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

export interface Project {
  id: string;
  name: string;
  baseUrl: string;
  normalizedBaseUrl: string;
  createdAt: string;
  updatedAt: string;
  browserConfig: BrowserConfig;
  aiConfig: JsonValue;
  mysqlConfig?: JsonValue;
  shortcutConfig: JsonValue;
}

export interface Page {
  id: string;
  projectId: string;
  name: string;
  url: string;
  normalizedUrl: string;
  createdAt: string;
  updatedAt: string;
}

export interface PageVersion {
  id: string;
  pageId: string;
  versionNumber: number;
  createdAt: string;
  normalizedUrl: string;
  domFilePath: string;
  cssFilePath: string;
  accessibilityFilePath: string;
  analysisFilePath: string;
  semanticHash: string;
  change?: SemanticChangeSummary;
}

export type TestStatus = "draft" | "valid" | "invalidated";
export type TestStartMode = "base_url" | "current_page";
export type TestMode = "recorded" | "dynamic_ai";
export type TestWorkflowState =
  | "not_recorded"
  | "recording"
  | "recorded"
  | "analyzing_flow"
  | "flow_analyzed"
  | "ready";

export interface TestDefinition {
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: TestStatus;
  version: number;
  testMode: TestMode;
  wipeBeforeRun: boolean;
  startMode: TestStartMode;
  startUrl: string;
  normalizedStartUrl: string;
  workflowState: TestWorkflowState;
  createdAt: string;
  updatedAt: string;
  flowItems: TestFlowItem[];
  /** Canonical multi-flow structure. Missing means a legacy single-flow test. */
  stages?: import("./test-stages.js").TestStage[];
  postRunChecks?: import("./post-run-checks.js").TestPostRunChecks;
  aiGeneration?: {
    sourceType?: "test" | "form";
    sourceTestId?: string;
    sourceFormId?: string;
    instruction: string;
    provider: string;
    model: string;
    generatedAt: string;
  };
  invalidation?: TestInvalidation;
}

export interface TestInvalidation {
  pageId: string;
  pageVersionId: string;
  detectedAt: string;
  score: number;
  threshold: number;
}

export interface TestVersion {
  id: string;
  testId: string;
  versionNumber: number;
  source: "manual" | "recorder" | "ai" | "import";
  createdAt: string;
  snapshotFilePath: string;
}

export type TestDataset = DeclarativeTestDataset;

export interface TestRun {
  id: string;
  projectId: string;
  testId: string;
  testVersion: number;
  datasetId?: string;
  startedAt: string;
  endedAt?: string;
  status: "running" | "passed" | "passed_with_warnings" | "failed" | "stopped";
  browserType: BrowserType;
  pageVersionIds: string[];
  warnings?: JsonValue[];
  datasetSnapshot?: JsonValue;
  postRunResult?: JsonValue;
  error?: JsonValue;
}

export interface StepRunResult {
  id: string;
  runId: string;
  stepId: string;
  stageId?: string;
  status:
    | "pending"
    | "running"
    | "passed"
    | "passed_with_fallback"
    | "skipped"
    | "failed"
    | "stopped";
  startedAt?: string;
  endedAt?: string;
  locatorUsed?: JsonValue;
  fallbackIndex?: number;
  error?: JsonValue;
  logs: JsonValue[];
}

export interface ImapAccount {
  id: string;
  projectId: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  mailbox: string;
}

export interface ProjectSettings {
  projectId: string;
  urlPatterns: string[];
  semanticChangeThreshold: number;
  settings: Record<string, JsonValue>;
  updatedAt: string;
}
import type {
  TestDataset as DeclarativeTestDataset,
  TestFlowItem,
} from "./test-model.js";
import type { SemanticChangeSummary } from "./page-analysis.js";
