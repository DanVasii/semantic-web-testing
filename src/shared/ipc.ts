import type { ProjectInput, ProjectOverview } from "./projects.js";
import type { DatasetCrudApi } from "./datasets.js";
import type {
  BrowserConfig,
  StepRunResult,
  TestDefinition,
  TestRun,
  TestVersion,
} from "./persistence.js";
import type {
  ManualWipeResource,
  RunnerSnapshot,
  StartRunInput,
  VisualStepContextCapture,
} from "./runner.js";
import type { RecorderSnapshot, RecorderStepDraft } from "./recorder.js";
import type { TestFlowItem } from "./test-model.js";
import type { TestStage } from "./test-stages.js";
import type {
  AnalyzedPageSummary,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "./page-analysis.js";
import type { TestInput } from "./tests.js";
import type { TestPostRunChecks } from "./post-run-checks.js";
import type {
  ImapAccountSummary,
  ImapConnectionTestResult,
  ImapDiagnosticPollResult,
  SaveImapAccountInput,
} from "./imap.js";
import type {
  AiConnectionTestResult,
  AiSimilarTestInput,
  AiSimilarTestRequestPreview,
  AiSimilarTestResult,
  AiModelInfo,
  AiRunPlanInput,
  AiRunPlanPreview,
  AiRunPlanResult,
  AiStepEditInput,
  AiStepEditPreview,
  AiStepEditResult,
  AiProviderId,
  AiRequestPreview,
  AiSettingsSummary,
  ApplyAiStepChangesInput,
  ApplyAiStepChangesResult,
  CreateAiRequestPreviewInput,
  CreateAiSimilarTestInput,
  CreateAiSimilarTestResult,
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
import type {
  ConfirmedTestImport,
  ExportResult,
  TestImportPreview,
} from "./import-export.js";
import type {
  MySqlConnectionInput,
  MySqlCleanupRowSelection,
  MySqlConnectionTestResult,
  MySqlSchemaResult,
  MySqlSettingsSummary,
  TableIdentityConfig,
} from "./mysql.js";
import type {
  RunHistoryDetails,
  RunHistoryEntry,
  RunHistoryFilters,
  RunHistoryMutationResult,
  RunHistoryPurgeTarget,
  RunStorageUsage,
} from "./run-history.js";
import type {
  BatchRun,
  BatchRunStatus,
  CreateBatchRunInput,
  FlakyTestStatistic,
  SaveTestSuiteInput,
  TestSuite,
  UpdateBatchRunItemInput,
} from "./test-suites.js";
import type {
  AnalyzedForm,
  CreateGeneratedFormTestsInput,
  CreateGeneratedFormTestsResult,
  FormTestGenerationResult,
  GenerateFormTestsInput,
  ProjectFormSettings,
  SaveProjectFormSettingsInput,
} from "./form-analysis.js";

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
  listForms: "pages:list-forms",
  progress: "pages:analysis-progress",
} as const;

export const FORM_CHANNELS = {
  getSettings: "forms:get-settings",
  saveSettings: "forms:save-settings",
  generateTests: "forms:generate-tests",
  createTests: "forms:create-tests",
} as const;

export const TEST_CHANNELS = {
  list: "tests:list",
  get: "tests:get",
  create: "tests:create",
  update: "tests:update",
  saveFlow: "tests:save-flow",
  saveStages: "tests:save-stages",
  savePostRunChecks: "tests:save-post-run-checks",
  listVersions: "tests:list-versions",
  revalidate: "tests:revalidate",
  delete: "tests:delete",
} as const;

export const TRANSFER_CHANNELS = {
  previewImport: "transfer:preview-import",
  confirmImport: "transfer:confirm-import",
  exportTest: "transfer:export-test",
  exportDataset: "transfer:export-dataset",
  exportAllDatasets: "transfer:export-all-datasets",
  exportPageAnalysis: "transfer:export-page-analysis",
  exportAnalysisBundle: "transfer:export-analysis-bundle",
} as const;

export const MYSQL_CHANNELS = {
  getSettings: "mysql:get-settings",
  saveSettings: "mysql:save-settings",
  testConnection: "mysql:test-connection",
  loadSchema: "mysql:load-schema",
  saveIdentityConfig: "mysql:save-identity-config",
} as const;

export const IMAP_CHANNELS = {
  listAccounts: "imap:list-accounts",
  saveAccount: "imap:save-account",
  deleteAccount: "imap:delete-account",
  testConnection: "imap:test-connection",
  listMailboxes: "imap:list-mailboxes",
  pollDiagnostic: "imap:poll-diagnostic",
} as const;

export const DATASET_CHANNELS = {
  list: "datasets:list",
  create: "datasets:create",
  duplicate: "datasets:duplicate",
  save: "datasets:save",
  delete: "datasets:delete",
  previewValue: "datasets:preview-value",
  selectFile: "datasets:select-file",
} as const;

export const RUNNER_CHANNELS = {
  start: "runner:start",
  captureVisualContext: "runner:capture-visual-context",
  stop: "runner:stop",
  retry: "runner:retry",
  retryVariableProducer: "runner:retry-variable-producer",
  provideManualVariable: "runner:provide-manual-variable",
  skipStep: "runner:skip-step",
  continue: "runner:continue",
  configureShortcut: "runner:configure-shortcut",
  runFallback: "runner:run-fallback",
  skipFallback: "runner:skip-fallback",
  previewMySqlCleanup: "runner:preview-mysql-cleanup",
  confirmMySqlCleanup: "runner:confirm-mysql-cleanup",
  pollImapCheck: "runner:poll-imap-check",
  abandonImapCheck: "runner:abandon-imap-check",
  manualWipe: "runner:manual-wipe",
  getStatus: "runner:get-status",
  listRuns: "runner:list-runs",
  listStepResults: "runner:list-step-results",
  statusChanged: "runner:status-changed",
} as const;

export const RUN_HISTORY_CHANNELS = {
  list: "run-history:list",
  details: "run-history:details",
  deleteSelected: "run-history:delete-selected",
  deleteAll: "run-history:delete-all",
  storage: "run-history:storage",
  purge: "run-history:purge",
} as const;

export const TEST_SUITE_CHANNELS = {
  list: "test-suites:list",
  save: "test-suites:save",
  delete: "test-suites:delete",
} as const;

export const BATCH_RUN_CHANNELS = {
  create: "batch-runs:create",
  updateItem: "batch-runs:update-item",
  complete: "batch-runs:complete",
  list: "batch-runs:list",
  get: "batch-runs:get",
  flakyStatistics: "batch-runs:flaky-statistics",
} as const;

export const RECORDER_CHANNELS = {
  start: "recorder:start",
  continueRecording: "recorder:continue-recording",
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
  listModels: "ai:list-models",
  getModelPricing: "ai:get-model-pricing",
  saveModelPricing: "ai:save-model-pricing",
  testConnection: "ai:test-connection",
  previewRequest: "ai:preview-request",
  generateRequest: "ai:generate-request",
  previewStepEdit: "ai:preview-step-edit",
  generateStepEdit: "ai:generate-step-edit",
  previewRunPlan: "ai:preview-run-plan",
  generateRunPlan: "ai:generate-run-plan",
  applyStepChanges: "ai:apply-step-changes",
  undoStepChange: "ai:undo-step-change",
  previewSimilarTest: "ai:preview-similar-test",
  generateSimilarTest: "ai:generate-similar-test",
  createSimilarTest: "ai:create-similar-test",
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
  listAiModels: (
    provider: Exclude<AiProviderId, "none">,
    refresh?: boolean,
  ) => Promise<AiModelInfo[]>;
  getAiModelPricing: (
    provider: import("./ai.js").PricedAiProviderId,
    model: string,
  ) => Promise<import("./ai.js").AiModelPricing>;
  saveAiModelPricing: (
    input: import("./ai.js").SaveAiModelPricingInput,
  ) => Promise<import("./ai.js").AiModelPricing>;
  testAiConnection: (
    provider: Exclude<AiProviderId, "none">,
  ) => Promise<AiConnectionTestResult>;
  previewAiRequest: (
    input: CreateAiRequestPreviewInput,
  ) => Promise<AiRequestPreview>;
  generateAiRequest: (
    input: CreateAiRequestPreviewInput,
  ) => Promise<import("./ai.js").AiGenerationResult>;
  previewAiStepEdit: (input: AiStepEditInput) => Promise<AiStepEditPreview>;
  generateAiStepEdit: (input: AiStepEditInput) => Promise<AiStepEditResult>;
  previewAiRunPlan: (input: AiRunPlanInput) => Promise<AiRunPlanPreview>;
  generateAiRunPlan: (input: AiRunPlanInput) => Promise<AiRunPlanResult>;
  applyAiStepChanges: (
    input: ApplyAiStepChangesInput,
  ) => Promise<ApplyAiStepChangesResult>;
  undoAiStepChange: (input: UndoAiStepChangeInput) => Promise<TestDefinition>;
  previewAiSimilarTest: (
    input: AiSimilarTestInput,
  ) => Promise<AiSimilarTestRequestPreview>;
  generateAiSimilarTest: (
    input: AiSimilarTestInput,
  ) => Promise<AiSimilarTestResult>;
  createAiSimilarTest: (
    input: CreateAiSimilarTestInput,
  ) => Promise<CreateAiSimilarTestResult>;
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
  ) => Promise<PageAnalysisTarget | undefined>;
  analyzeCurrentPage: (projectId: string) => Promise<PageAnalysisResult>;
  listAnalyzedPages: (projectId: string) => Promise<AnalyzedPageSummary[]>;
  listAnalyzedPageForms?: (
    projectId: string,
    pageId: string,
  ) => Promise<AnalyzedForm[]>;
  getProjectFormSettings?: (projectId: string) => Promise<ProjectFormSettings>;
  saveProjectFormSettings?: (
    projectId: string,
    input: SaveProjectFormSettingsInput,
  ) => Promise<ProjectFormSettings>;
  generateFormTests?: (
    input: GenerateFormTestsInput,
  ) => Promise<FormTestGenerationResult>;
  createGeneratedFormTests?: (
    input: CreateGeneratedFormTestsInput,
  ) => Promise<CreateGeneratedFormTestsResult>;
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
  saveTestStages?: (
    projectId: string,
    testId: string,
    stages: TestStage[],
  ) => Promise<TestDefinition>;
  saveTestPostRunChecks: (
    projectId: string,
    testId: string,
    checks: TestPostRunChecks,
  ) => Promise<TestDefinition>;
  listTestVersions: (
    projectId: string,
    testId: string,
  ) => Promise<TestVersion[]>;
  revalidateTest: (
    projectId: string,
    testId: string,
  ) => Promise<TestDefinition>;
  deleteTest: (projectId: string, testId: string) => Promise<boolean>;
  previewTestImport: (
    projectId: string,
  ) => Promise<TestImportPreview | undefined>;
  confirmTestImport: (
    projectId: string,
    previewId: string,
  ) => Promise<ConfirmedTestImport>;
  exportTestJson: (
    projectId: string,
    testId: string,
  ) => Promise<ExportResult | undefined>;
  exportDatasetJson: (
    projectId: string,
    testId: string,
    datasetId: string,
  ) => Promise<ExportResult | undefined>;
  exportAllDatasetsJson: (
    projectId: string,
    testId: string,
  ) => Promise<ExportResult | undefined>;
  exportPageAnalysisJson: (
    projectId: string,
    pageId: string,
  ) => Promise<ExportResult | undefined>;
  exportAnalysisBundle: (
    projectId: string,
  ) => Promise<ExportResult | undefined>;
  getMySqlSettings: (projectId: string) => Promise<MySqlSettingsSummary>;
  saveMySqlSettings: (
    projectId: string,
    input: MySqlConnectionInput,
  ) => Promise<MySqlSettingsSummary>;
  testMySqlConnection: (
    projectId: string,
    input: MySqlConnectionInput,
  ) => Promise<MySqlConnectionTestResult>;
  loadMySqlSchema: (
    projectId: string,
    input?: MySqlConnectionInput,
  ) => Promise<MySqlSchemaResult>;
  saveMySqlIdentityConfig: (
    projectId: string,
    identities: TableIdentityConfig[],
  ) => Promise<MySqlSchemaResult>;
  listImapAccounts: () => Promise<ImapAccountSummary[]>;
  saveImapAccount: (input: SaveImapAccountInput) => Promise<ImapAccountSummary>;
  deleteImapAccount: (accountId: string) => Promise<boolean>;
  testImapConnection: (
    input: SaveImapAccountInput,
  ) => Promise<ImapConnectionTestResult>;
  listImapMailboxes: (
    accountId: string,
  ) => Promise<import("./imap.js").ImapMailboxSummary[]>;
  pollImapDiagnostic: (
    input: SaveImapAccountInput,
    receivedAfter: string,
  ) => Promise<ImapDiagnosticPollResult>;
  captureVisualStepContext?: (
    projectId: string,
    testId: string,
    stepId: string,
    flowItems: TestFlowItem[],
  ) => Promise<VisualStepContextCapture>;
  startRun: (input: StartRunInput) => Promise<RunnerSnapshot>;
  stopRun: (runId: string) => Promise<RunnerSnapshot>;
  retryRunStep: (runId: string) => Promise<RunnerSnapshot>;
  retryVariableProducer?: (runId: string) => Promise<RunnerSnapshot>;
  provideManualVariable?: (
    runId: string,
    value: unknown,
  ) => Promise<RunnerSnapshot>;
  skipRunStep: (runId: string) => Promise<RunnerSnapshot>;
  continueRun: (runId: string) => Promise<RunnerSnapshot>;
  configureRunnerShortcut: (
    projectId: string,
    shortcut: string,
  ) => Promise<string>;
  runCurrentFallback: (runId: string) => Promise<RunnerSnapshot>;
  skipCurrentFallback: (runId: string) => Promise<RunnerSnapshot>;
  previewMySqlCleanup: (
    runId: string,
    diffId: string,
    rows: MySqlCleanupRowSelection[],
  ) => Promise<RunnerSnapshot>;
  confirmMySqlCleanup: (
    runId: string,
    previewId: string,
  ) => Promise<RunnerSnapshot>;
  pollImapCheck: (runId: string) => Promise<RunnerSnapshot>;
  abandonImapCheck: (runId: string) => Promise<RunnerSnapshot>;
  manualWipeRunData: (
    runId: string,
    resources: ManualWipeResource[],
  ) => Promise<RunnerSnapshot>;
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
  listProjectRunHistory: (
    projectId: string,
    filters?: RunHistoryFilters,
  ) => Promise<RunHistoryEntry[]>;
  getRunHistoryDetails: (
    projectId: string,
    runId: string,
  ) => Promise<RunHistoryDetails>;
  deleteRunHistory: (
    projectId: string,
    runIds: string[],
  ) => Promise<RunHistoryMutationResult>;
  deleteAllRunHistory: (projectId: string) => Promise<RunHistoryMutationResult>;
  getRunStorageUsage: (projectId: string) => Promise<RunStorageUsage>;
  purgeRunHistoryData: (
    projectId: string,
    target: RunHistoryPurgeTarget,
  ) => Promise<RunHistoryMutationResult>;
  listTestSuites?: (projectId: string) => Promise<TestSuite[]>;
  saveTestSuite?: (
    projectId: string,
    suiteId: string | undefined,
    input: SaveTestSuiteInput,
  ) => Promise<TestSuite>;
  deleteTestSuite?: (projectId: string, suiteId: string) => Promise<boolean>;
  createBatchRun?: (input: CreateBatchRunInput) => Promise<BatchRun>;
  updateBatchRunItem?: (
    batchId: string,
    input: UpdateBatchRunItemInput,
  ) => Promise<BatchRun>;
  completeBatchRun?: (
    batchId: string,
    status: BatchRunStatus,
    cleanupStatus?: BatchRun["cleanupStatus"],
  ) => Promise<BatchRun>;
  listBatchRuns?: (projectId: string) => Promise<BatchRun[]>;
  getBatchRun?: (projectId: string, batchId: string) => Promise<BatchRun>;
  listFlakyTestStatistics?: (
    projectId: string,
  ) => Promise<FlakyTestStatistic[]>;
  onRunnerStatusChange: (
    listener: (snapshot: RunnerSnapshot) => void,
  ) => () => void;
  startRecorder: (
    projectId: string,
    testId: string,
    stageId?: string,
  ) => Promise<RecorderSnapshot>;
  continueRecorder: (
    projectId: string,
    testId: string,
    stageId?: string,
  ) => Promise<RunnerSnapshot>;
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
