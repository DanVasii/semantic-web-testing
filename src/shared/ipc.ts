import type { ProjectInput, ProjectOverview } from "./projects.js";
import type {
  BrowserConfig,
  StepRunResult,
  TestDefinition,
  TestRun,
  TestVersion,
} from "./persistence.js";
import type { RunnerSnapshot, StartRunInput } from "./runner.js";
import type { TestFlowItem } from "./test-model.js";
import type {
  AnalyzedPageSummary,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "./page-analysis.js";
import type { TestInput } from "./tests.js";
import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  BasicAuthCredentials,
  DetectedBrowser,
} from "./browser-manager.js";

export type AppInfoChannel = "app:get-info";

export const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

export const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  updateBrowserConfig: "projects:update-browser-config",
  delete: "projects:delete",
} as const;

export const BROWSER_CHANNELS = {
  detect: "browsers:detect",
  launch: "browsers:launch",
  openProjectUrl: "browsers:open-project-url",
  submitBasicAuth: "browsers:submit-basic-auth",
  cancelBasicAuth: "browsers:cancel-basic-auth",
  close: "browsers:close",
  closeProjectTabs: "browsers:close-project-tabs",
  recover: "browsers:recover",
  selectProfilePath: "browsers:select-profile-path",
  getStatus: "browsers:get-status",
  statusChanged: "browsers:status-changed",
} as const;

export const PAGE_ANALYSIS_CHANNELS = {
  getCurrentTarget: "pages:get-current-analysis-target",
  analyzeCurrent: "pages:analyze-current",
  list: "pages:list-analyses",
  progress: "pages:analysis-progress",
} as const;

export const TEST_CHANNELS = {
  list: "tests:list",
  get: "tests:get",
  create: "tests:create",
  update: "tests:update",
  saveFlow: "tests:save-flow",
  listVersions: "tests:list-versions",
  delete: "tests:delete",
} as const;

export const RUNNER_CHANNELS = {
  start: "runner:start",
  stop: "runner:stop",
  retry: "runner:retry",
  getStatus: "runner:get-status",
  listRuns: "runner:list-runs",
  listStepResults: "runner:list-step-results",
  statusChanged: "runner:status-changed",
} as const;

export interface AppInfo {
  version: string;
  electronVersion: string;
}

export interface SemanticAppApi {
  getAppInfo: () => Promise<AppInfo>;
  listProjects: () => Promise<ProjectOverview[]>;
  createProject: (input: ProjectInput) => Promise<ProjectOverview>;
  updateProject: (
    projectId: string,
    input: ProjectInput,
  ) => Promise<ProjectOverview>;
  updateBrowserConfig: (
    projectId: string,
    config: BrowserConfig,
  ) => Promise<ProjectOverview>;
  deleteProject: (projectId: string) => Promise<boolean>;
  detectBrowsers: () => Promise<DetectedBrowser[]>;
  launchBrowser: (options: BrowserLaunchOptions) => Promise<BrowserSession>;
  openProjectUrl: (
    projectId: string,
    url: string,
  ) => Promise<BrowserNavigationResult>;
  submitBasicAuth: (
    credentials: BasicAuthCredentials,
  ) => Promise<BrowserNavigationResult>;
  cancelBasicAuth: () => Promise<void>;
  closeBrowser: () => Promise<void>;
  closeProjectTabs: (projectId: string) => Promise<void>;
  recoverBrowserConnection: () => Promise<BrowserSession>;
  selectBrowserProfilePath: () => Promise<string | undefined>;
  getBrowserStatus: () => Promise<BrowserManagerStatus>;
  onBrowserStatusChange: (
    listener: (status: BrowserManagerStatus) => void,
  ) => () => void;
  getCurrentPageAnalysisTarget: (
    projectId: string,
  ) => Promise<PageAnalysisTarget>;
  analyzeCurrentPage: (projectId: string) => Promise<PageAnalysisResult>;
  listAnalyzedPages: (projectId: string) => Promise<AnalyzedPageSummary[]>;
  onPageAnalysisProgress: (
    listener: (progress: PageAnalysisProgress) => void,
  ) => () => void;
  listTests: (projectId: string) => Promise<TestDefinition[]>;
  getTest: (projectId: string, testId: string) => Promise<TestDefinition>;
  createTest: (projectId: string, input: TestInput) => Promise<TestDefinition>;
  updateTest: (
    projectId: string,
    testId: string,
    input: TestInput,
  ) => Promise<TestDefinition>;
  saveTestFlow: (
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
  ) => Promise<TestDefinition>;
  listTestVersions: (
    projectId: string,
    testId: string,
  ) => Promise<TestVersion[]>;
  deleteTest: (projectId: string, testId: string) => Promise<boolean>;
  startRun: (input: StartRunInput) => Promise<RunnerSnapshot>;
  stopRun: (runId: string) => Promise<RunnerSnapshot>;
  retryRunStep: (runId: string) => Promise<RunnerSnapshot>;
  getRunnerStatus: (
    projectId: string,
    testId: string,
  ) => Promise<RunnerSnapshot>;
  listTestRuns: (projectId: string, testId: string) => Promise<TestRun[]>;
  listRunStepResults: (
    projectId: string,
    testId: string,
    runId: string,
  ) => Promise<StepRunResult[]>;
  onRunnerStatusChange: (
    listener: (snapshot: RunnerSnapshot) => void,
  ) => () => void;
}
