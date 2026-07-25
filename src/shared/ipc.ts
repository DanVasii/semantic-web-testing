import type { ProjectInput, ProjectOverview } from "./projects.js";
import type { DatasetCrudApi } from "./datasets.js";
import type {
  BrowserConfig,
  StepRunResult,
  TestDefinition,
  TestRun,
  TestVersion,
} from "./persistence.js";
import type { RunnerSnapshot, StartRunInput } from "./runner.js";
import type { RecorderSnapshot, RecorderStepDraft } from "./recorder.js";
import type { TestFlowItem } from "./test-model.js";
import type {
  AnalyzedPageSummary,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "./page-analysis.js";
import type { TestInput } from "./tests.js";
import type {
  AiConnectionTestResult,
  AiStepEditInput,
  AiStepEditPreview,
  AiStepEditResult,
  AiProviderId,
  AiRequestPreview,
  AiSettingsSummary,
  ApplyAiStepChangesInput,
  ApplyAiStepChangesResult,
  CreateAiRequestPreviewInput,
  SaveAiSettingsInput,
  UndoAiStepChangeInput,
} from "./ai.js";
import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  BasicAuthCredentials,
  DetectedBrowser,
  ProjectBasicAuthSettings,
  SaveProjectBasicAuthInput,
} from "./browser-manager.js";

export type AppInfoChannel = "app:get-info";

export const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

export const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  updateBrowserConfig: "projects:update-browser-config",
  getBasicAuth: "projects:get-basic-auth",
  saveBasicAuth: "projects:save-basic-auth",
  deleteBasicAuth: "projects:delete-basic-auth",
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

export const DATASET_CHANNELS = {
  list: "datasets:list",
  create: "datasets:create",
  duplicate: "datasets:duplicate",
  save: "datasets:save",
  delete: "datasets:delete",
  previewValue: "datasets:preview-value",
} as const;

export const RUNNER_CHANNELS = {
  start: "runner:start",
  stop: "runner:stop",
  retry: "runner:retry",
  continue: "runner:continue",
  configureShortcut: "runner:configure-shortcut",
  runFallback: "runner:run-fallback",
  skipFallback: "runner:skip-fallback",
  getStatus: "runner:get-status",
  listRuns: "runner:list-runs",
  listStepResults: "runner:list-step-results",
  statusChanged: "runner:status-changed",
} as const;

export const RECORDER_CHANNELS = {
  start: "recorder:start",
  stop: "recorder:stop",
  addStep: "recorder:add-step",
  discardStep: "recorder:discard-step",
  retry: "recorder:retry",
  ignoreError: "recorder:ignore-error",
  getStatus: "recorder:get-status",
  statusChanged: "recorder:status-changed",
} as const;

export const AI_CHANNELS = {
  getSettings: "ai:get-settings",
  saveSettings: "ai:save-settings",
  testConnection: "ai:test-connection",
  previewRequest: "ai:preview-request",
  previewStepEdit: "ai:preview-step-edit",
  generateStepEdit: "ai:generate-step-edit",
  applyStepChanges: "ai:apply-step-changes",
  undoStepChange: "ai:undo-step-change",
} as const;

export interface AppInfo {
  version: string;
  electronVersion: string;
}

export interface SemanticAppApi extends DatasetCrudApi {
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
  getProjectBasicAuth: (projectId: string) => Promise<ProjectBasicAuthSettings>;
  saveProjectBasicAuth: (
    projectId: string,
    input: SaveProjectBasicAuthInput,
  ) => Promise<ProjectBasicAuthSettings>;
  deleteProjectBasicAuth: (projectId: string) => Promise<boolean>;
  getAiSettings: () => Promise<AiSettingsSummary>;
  saveAiSettings: (input: SaveAiSettingsInput) => Promise<AiSettingsSummary>;
  testAiConnection: (
    provider: Exclude<AiProviderId, "none">,
  ) => Promise<AiConnectionTestResult>;
  previewAiRequest: (
    input: CreateAiRequestPreviewInput,
  ) => Promise<AiRequestPreview>;
  previewAiStepEdit: (input: AiStepEditInput) => Promise<AiStepEditPreview>;
  generateAiStepEdit: (input: AiStepEditInput) => Promise<AiStepEditResult>;
  applyAiStepChanges: (
    input: ApplyAiStepChangesInput,
  ) => Promise<ApplyAiStepChangesResult>;
  undoAiStepChange: (input: UndoAiStepChangeInput) => Promise<TestDefinition>;
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
  continueRun: (runId: string) => Promise<RunnerSnapshot>;
  configureRunnerShortcut: (
    projectId: string,
    shortcut: string,
  ) => Promise<string>;
  runCurrentFallback: (runId: string) => Promise<RunnerSnapshot>;
  skipCurrentFallback: (runId: string) => Promise<RunnerSnapshot>;
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
  startRecorder: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  stopRecorder: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  addRecorderStep: (
    projectId: string,
    testId: string,
    draft: RecorderStepDraft,
  ) => Promise<RecorderSnapshot>;
  discardRecorderStep: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  retryRecorderAnalysis: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  ignoreRecorderAnalysisError: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  getRecorderStatus: (
    projectId: string,
    testId: string,
  ) => Promise<RecorderSnapshot>;
  onRecorderStatusChange: (
    listener: (snapshot: RecorderSnapshot) => void,
  ) => () => void;
}
