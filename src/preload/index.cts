import { contextBridge, ipcRenderer } from "electron";

import type { AppInfo, AppInfoChannel, SemanticAppApi } from "../shared/ipc.js";
import type {
  AiConnectionTestResult,
  AiModelInfo,
  AiRequestPreview,
  AiRunPlanPreview,
  AiRunPlanProposal,
  AiRunPlanResult,
  AiSettingsSummary,
  AiStepEditPreview,
  AiStepEditProposal,
  AiStepEditResult,
  ApplyAiStepChangesResult,
} from "../shared/ai.js";
import type {
  BasicAuthChallenge,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  BrowserTab,
  DetectedBrowser,
  ProjectBasicAuthSettings,
} from "../shared/browser-manager.js";
import type { ProjectOverview } from "../shared/projects.js";
import type {
  BrowserConfig,
  Page,
  PageVersion,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
  TestVersion,
} from "../shared/persistence.js";
import type {
  ManualWipeResource,
  RunnerSnapshot,
  RunnerState,
} from "../shared/runner.js";
import type { TestPostRunChecks } from "../shared/post-run-checks.js";
import type {
  ImapAccountSummary,
  ImapConnectionTestResult,
  ImapDiagnosticMessage,
  ImapDiagnosticPollResult,
  ImapMailboxSummary,
  SaveImapAccountInput,
} from "../shared/imap.js";
import type {
  RecorderSnapshot,
  RecorderState,
  RecorderStepDraft,
} from "../shared/recorder.js";
import type {
  AnalyzedPageSummary,
  InaccessibleStylesheet,
  PageAnalysisCounts,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "../shared/page-analysis.js";
import type {
  ConfirmedTestImport,
  ExportResult,
  TestImportPreview,
} from "../shared/import-export.js";
import type {
  MySqlConnectionTestResult,
  MySqlSchemaResult,
  MySqlSettingsSummary,
  TableIdentityConfig,
} from "../shared/mysql.js";
import type {
  RunHistoryDetails,
  RunHistoryEntry,
  RunHistoryMutationResult,
  RunStorageUsage,
} from "../shared/run-history.js";

const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";
const AI_CHANNELS = {
  getSettings: "ai:get-settings",
  saveSettings: "ai:save-settings",
  listModels: "ai:list-models",
  testConnection: "ai:test-connection",
  previewRequest: "ai:preview-request",
  previewStepEdit: "ai:preview-step-edit",
  generateStepEdit: "ai:generate-step-edit",
  previewRunPlan: "ai:preview-run-plan",
  generateRunPlan: "ai:generate-run-plan",
  applyStepChanges: "ai:apply-step-changes",
  undoStepChange: "ai:undo-step-change",
} as const;
const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  updateBrowserConfig: "projects:update-browser-config",
  getBasicAuth: "projects:get-basic-auth",
  saveBasicAuth: "projects:save-basic-auth",
  deleteBasicAuth: "projects:delete-basic-auth",
  delete: "projects:delete",
} as const;
const BROWSER_CHANNELS = {
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
const PAGE_ANALYSIS_CHANNELS = {
  getCurrentTarget: "pages:get-current-analysis-target",
  analyzeCurrent: "pages:analyze-current",
  list: "pages:list-analyses",
  progress: "pages:analysis-progress",
} as const;
const TEST_CHANNELS = {
  list: "tests:list",
  get: "tests:get",
  create: "tests:create",
  update: "tests:update",
  saveFlow: "tests:save-flow",
  savePostRunChecks: "tests:save-post-run-checks",
  listVersions: "tests:list-versions",
  revalidate: "tests:revalidate",
  delete: "tests:delete",
} as const;
const TRANSFER_CHANNELS = {
  previewImport: "transfer:preview-import",
  confirmImport: "transfer:confirm-import",
  exportTest: "transfer:export-test",
  exportDataset: "transfer:export-dataset",
  exportAllDatasets: "transfer:export-all-datasets",
  exportPageAnalysis: "transfer:export-page-analysis",
  exportAnalysisBundle: "transfer:export-analysis-bundle",
} as const;
const MYSQL_CHANNELS = {
  getSettings: "mysql:get-settings",
  saveSettings: "mysql:save-settings",
  testConnection: "mysql:test-connection",
  loadSchema: "mysql:load-schema",
  saveIdentityConfig: "mysql:save-identity-config",
} as const;
const IMAP_CHANNELS = {
  listAccounts: "imap:list-accounts",
  saveAccount: "imap:save-account",
  deleteAccount: "imap:delete-account",
  testConnection: "imap:test-connection",
  listMailboxes: "imap:list-mailboxes",
  pollDiagnostic: "imap:poll-diagnostic",
} as const;
const DATASET_CHANNELS = {
  list: "datasets:list",
  create: "datasets:create",
  duplicate: "datasets:duplicate",
  save: "datasets:save",
  delete: "datasets:delete",
  previewValue: "datasets:preview-value",
} as const;
const RUNNER_CHANNELS = {
  start: "runner:start",
  stop: "runner:stop",
  retry: "runner:retry",
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
const RUN_HISTORY_CHANNELS = {
  list: "run-history:list",
  details: "run-history:details",
  deleteSelected: "run-history:delete-selected",
  deleteAll: "run-history:delete-all",
  storage: "run-history:storage",
  purge: "run-history:purge",
} as const;
const RECORDER_CHANNELS = {
  start: "recorder:start",
  stop: "recorder:stop",
  addStep: "recorder:add-step",
  discardStep: "recorder:discard-step",
  retry: "recorder:retry",
  ignoreError: "recorder:ignore-error",
  getStatus: "recorder:get-status",
  statusChanged: "recorder:status-changed",
} as const;

const isAppInfo = (value: unknown): value is AppInfo => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return (
    "version" in value &&
    typeof value.version === "string" &&
    "electronVersion" in value &&
    typeof value.electronVersion === "string"
  );
};

const isAiProviderId = (value: unknown): boolean =>
  value === "none" || value === "ollama" || value === "gemini";

const isAiModelInfo = (value: unknown): value is AiModelInfo =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "displayName" in value &&
  typeof value.displayName === "string" &&
  (!("inputTokenLimit" in value) ||
    typeof value.inputTokenLimit === "number") &&
  (!("outputTokenLimit" in value) ||
    typeof value.outputTokenLimit === "number");

const isAiSettingsSummary = (value: unknown): value is AiSettingsSummary =>
  typeof value === "object" &&
  value !== null &&
  "provider" in value &&
  isAiProviderId(value.provider) &&
  "ollama" in value &&
  typeof value.ollama === "object" &&
  value.ollama !== null &&
  "baseUrl" in value.ollama &&
  typeof value.ollama.baseUrl === "string" &&
  "model" in value.ollama &&
  typeof value.ollama.model === "string" &&
  "gemini" in value &&
  typeof value.gemini === "object" &&
  value.gemini !== null &&
  "model" in value.gemini &&
  typeof value.gemini.model === "string" &&
  "apiKeyConfigured" in value.gemini &&
  typeof value.gemini.apiKeyConfigured === "boolean" &&
  (!("updatedAt" in value) ||
    value.updatedAt === undefined ||
    typeof value.updatedAt === "string");

const isAiConnectionTestResult = (
  value: unknown,
): value is AiConnectionTestResult =>
  typeof value === "object" &&
  value !== null &&
  "provider" in value &&
  (value.provider === "ollama" || value.provider === "gemini") &&
  "success" in value &&
  typeof value.success === "boolean" &&
  "message" in value &&
  typeof value.message === "string" &&
  "latencyMs" in value &&
  typeof value.latencyMs === "number" &&
  "models" in value &&
  Array.isArray(value.models) &&
  value.models.every(isAiModelInfo);

const isJsonValue = (value: unknown, depth = 0): boolean => {
  if (depth > 20) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, depth + 1));
  }
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => isJsonValue(item, depth + 1))
  );
};

const isAiRequestPreview = (value: unknown): value is AiRequestPreview =>
  typeof value === "object" &&
  value !== null &&
  "task" in value &&
  [
    "analyze_step",
    "edit_step",
    "adapt_run",
    "generate_test",
    "repair_locator",
  ].includes(String(value.task)) &&
  "provider" in value &&
  isAiProviderId(value.provider) &&
  "model" in value &&
  typeof value.model === "string" &&
  "systemInstruction" in value &&
  typeof value.systemInstruction === "string" &&
  "prompt" in value &&
  typeof value.prompt === "string" &&
  "outputSchema" in value &&
  isJsonValue(value.outputSchema) &&
  "contextPreview" in value &&
  isJsonValue(value.contextPreview) &&
  "estimatedInputTokens" in value &&
  typeof value.estimatedInputTokens === "number" &&
  "originalContextBytes" in value &&
  typeof value.originalContextBytes === "number" &&
  "sentContextBytes" in value &&
  typeof value.sentContextBytes === "number" &&
  "omittedPaths" in value &&
  Array.isArray(value.omittedPaths) &&
  value.omittedPaths.every((path) => typeof path === "string");

const isAiStepChangeProposal = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "stepId" in value &&
  typeof value.stepId === "string" &&
  "patch" in value &&
  typeof value.patch === "object" &&
  value.patch !== null &&
  "rationale" in value &&
  typeof value.rationale === "string";

const isAiStepEditProposal = (value: unknown): value is AiStepEditProposal => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("summary" in value) ||
    typeof value.summary !== "string" ||
    !("currentStepChange" in value) ||
    typeof value.currentStepChange !== "object" ||
    value.currentStepChange === null ||
    !("stepId" in value.currentStepChange) ||
    typeof value.currentStepChange.stepId !== "string" ||
    !("patch" in value.currentStepChange) ||
    typeof value.currentStepChange.patch !== "object" ||
    value.currentStepChange.patch === null ||
    !("rationale" in value.currentStepChange) ||
    typeof value.currentStepChange.rationale !== "string" ||
    !("downstreamChanges" in value) ||
    !Array.isArray(value.downstreamChanges)
  ) {
    return false;
  }
  return value.downstreamChanges.every(isAiStepChangeProposal);
};

const isAiStepEditPreview = (value: unknown): value is AiStepEditPreview =>
  typeof value === "object" &&
  value !== null &&
  "request" in value &&
  isAiRequestPreview(value.request) &&
  "context" in value &&
  typeof value.context === "object" &&
  value.context !== null &&
  "selectedStepId" in value.context &&
  typeof value.context.selectedStepId === "string" &&
  "previousStepIds" in value.context &&
  Array.isArray(value.context.previousStepIds) &&
  value.context.previousStepIds.every((id) => typeof id === "string") &&
  "nextStepIds" in value.context &&
  Array.isArray(value.context.nextStepIds) &&
  value.context.nextStepIds.every((id) => typeof id === "string") &&
  "pageIds" in value.context &&
  Array.isArray(value.context.pageIds) &&
  value.context.pageIds.every((id) => typeof id === "string");

const isAiStepFieldDiff = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "stepId" in value &&
  typeof value.stepId === "string" &&
  "field" in value &&
  typeof value.field === "string" &&
  "after" in value &&
  isJsonValue(value.after);

const isAiStepEditResult = (value: unknown): value is AiStepEditResult =>
  typeof value === "object" &&
  value !== null &&
  "provider" in value &&
  (value.provider === "gemini" || value.provider === "ollama") &&
  "model" in value &&
  typeof value.model === "string" &&
  "proposal" in value &&
  isAiStepEditProposal(value.proposal) &&
  "diffs" in value &&
  Array.isArray(value.diffs) &&
  value.diffs.every(isAiStepFieldDiff) &&
  "usage" in value &&
  typeof value.usage === "object" &&
  value.usage !== null &&
  "inputTokens" in value.usage &&
  typeof value.usage.inputTokens === "number" &&
  "outputTokens" in value.usage &&
  typeof value.usage.outputTokens === "number" &&
  "totalTokens" in value.usage &&
  typeof value.usage.totalTokens === "number";

const isAiRunStepChange = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "stepId" in value &&
  typeof value.stepId === "string" &&
  "patch" in value &&
  typeof value.patch === "object" &&
  value.patch !== null &&
  "rationale" in value &&
  typeof value.rationale === "string";

const isAiRunStepInsertion = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "anchorStepId" in value &&
  typeof value.anchorStepId === "string" &&
  "position" in value &&
  (value.position === "before" || value.position === "after") &&
  "action" in value &&
  typeof value.action === "object" &&
  value.action !== null &&
  "actionType" in value.action &&
  typeof value.action.actionType === "string" &&
  "primaryLocator" in value.action &&
  typeof value.action.primaryLocator === "object" &&
  value.action.primaryLocator !== null &&
  "rationale" in value &&
  typeof value.rationale === "string";

const isAiRunPlanProposal = (value: unknown): value is AiRunPlanProposal =>
  typeof value === "object" &&
  value !== null &&
  "summary" in value &&
  typeof value.summary === "string" &&
  "changes" in value &&
  Array.isArray(value.changes) &&
  value.changes.every(isAiRunStepChange) &&
  "insertions" in value &&
  Array.isArray(value.insertions) &&
  value.insertions.every(isAiRunStepInsertion);

const isAiRunPlanPreview = (value: unknown): value is AiRunPlanPreview =>
  typeof value === "object" &&
  value !== null &&
  "request" in value &&
  isAiRequestPreview(value.request) &&
  "stepIds" in value &&
  Array.isArray(value.stepIds) &&
  value.stepIds.every((id) => typeof id === "string") &&
  "pageIds" in value &&
  Array.isArray(value.pageIds) &&
  value.pageIds.every((id) => typeof id === "string");

const isAiRunPlanResult = (value: unknown): value is AiRunPlanResult =>
  typeof value === "object" &&
  value !== null &&
  "provider" in value &&
  (value.provider === "gemini" || value.provider === "ollama") &&
  "model" in value &&
  typeof value.model === "string" &&
  "proposal" in value &&
  isAiRunPlanProposal(value.proposal) &&
  "usage" in value &&
  typeof value.usage === "object" &&
  value.usage !== null &&
  "inputTokens" in value.usage &&
  typeof value.usage.inputTokens === "number" &&
  "outputTokens" in value.usage &&
  typeof value.usage.outputTokens === "number" &&
  "totalTokens" in value.usage &&
  typeof value.usage.totalTokens === "number";

const isProjectOverview = (value: unknown): value is ProjectOverview => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (!("project" in value) || !("statistics" in value)) {
    return false;
  }

  const { project, statistics } = value;
  return (
    typeof project === "object" &&
    project !== null &&
    "id" in project &&
    typeof project.id === "string" &&
    "name" in project &&
    typeof project.name === "string" &&
    "baseUrl" in project &&
    typeof project.baseUrl === "string" &&
    typeof statistics === "object" &&
    statistics !== null &&
    "pageCount" in statistics &&
    typeof statistics.pageCount === "number" &&
    "testCount" in statistics &&
    typeof statistics.testCount === "number" &&
    "runCount" in statistics &&
    typeof statistics.runCount === "number"
  );
};

const requireProjectOverview = (value: unknown): ProjectOverview => {
  if (!isProjectOverview(value)) {
    throw new TypeError("Main process returned invalid project data.");
  }

  return value;
};

const isDetectedBrowser = (value: unknown): value is DetectedBrowser =>
  typeof value === "object" &&
  value !== null &&
  "installationId" in value &&
  typeof value.installationId === "string" &&
  "id" in value &&
  typeof value.id === "string" &&
  "displayName" in value &&
  typeof value.displayName === "string" &&
  "installed" in value &&
  typeof value.installed === "boolean" &&
  "supported" in value &&
  typeof value.supported === "boolean";

const isBrowserSession = (value: unknown): value is BrowserSession =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "browser" in value &&
  typeof value.browser === "string" &&
  "startedAt" in value &&
  typeof value.startedAt === "string";

const isBrowserTab = (value: unknown): value is BrowserTab =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "url" in value &&
  typeof value.url === "string";

const isBasicAuthChallenge = (value: unknown): value is BasicAuthChallenge =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "origin" in value &&
  typeof value.origin === "string" &&
  "invalidCredentials" in value &&
  typeof value.invalidCredentials === "boolean" &&
  (!("suggestedUsername" in value) ||
    value.suggestedUsername === undefined ||
    typeof value.suggestedUsername === "string");

const isProjectBasicAuthSettings = (
  value: unknown,
): value is ProjectBasicAuthSettings =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "origin" in value &&
  typeof value.origin === "string" &&
  "username" in value &&
  typeof value.username === "string" &&
  "configured" in value &&
  typeof value.configured === "boolean" &&
  (!("updatedAt" in value) ||
    value.updatedAt === undefined ||
    typeof value.updatedAt === "string");

const isBrowserNavigationResult = (
  value: unknown,
): value is BrowserNavigationResult => {
  if (typeof value !== "object" || value === null || !("state" in value)) {
    return false;
  }

  if (value.state === "opened") {
    return "tab" in value && isBrowserTab(value.tab);
  }

  return (
    value.state === "waiting_for_basic_auth" &&
    "challenge" in value &&
    isBasicAuthChallenge(value.challenge)
  );
};

const browserStates = new Set([
  "idle",
  "starting",
  "running",
  "reconnecting",
  "waiting_for_basic_auth",
  "closed",
  "failed",
]);

const isBrowserStatus = (value: unknown): value is BrowserManagerStatus => {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    typeof value.state !== "string" ||
    !browserStates.has(value.state)
  ) {
    return false;
  }

  if (value.state === "waiting_for_basic_auth") {
    return (
      "basicAuthChallenge" in value &&
      isBasicAuthChallenge(value.basicAuthChallenge)
    );
  }

  return (
    !("basicAuthChallenge" in value) ||
    value.basicAuthChallenge === undefined ||
    isBasicAuthChallenge(value.basicAuthChallenge)
  );
};

const isPage = (value: unknown): value is Page =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "name" in value &&
  typeof value.name === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "normalizedUrl" in value &&
  typeof value.normalizedUrl === "string" &&
  "createdAt" in value &&
  typeof value.createdAt === "string" &&
  "updatedAt" in value &&
  typeof value.updatedAt === "string";

const isPageVersion = (value: unknown): value is PageVersion =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "pageId" in value &&
  typeof value.pageId === "string" &&
  "versionNumber" in value &&
  typeof value.versionNumber === "number" &&
  "createdAt" in value &&
  typeof value.createdAt === "string" &&
  "normalizedUrl" in value &&
  typeof value.normalizedUrl === "string" &&
  "domFilePath" in value &&
  typeof value.domFilePath === "string" &&
  "cssFilePath" in value &&
  typeof value.cssFilePath === "string" &&
  "accessibilityFilePath" in value &&
  typeof value.accessibilityFilePath === "string" &&
  "analysisFilePath" in value &&
  typeof value.analysisFilePath === "string" &&
  "semanticHash" in value &&
  typeof value.semanticHash === "string";

const isPageAnalysisCounts = (value: unknown): value is PageAnalysisCounts => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  return [
    "visibleTexts",
    "interactiveElements",
    "forms",
    "inputs",
    "buttons",
    "links",
    "selectableElements",
    "inlineStyles",
    "styleTags",
    "externalStylesheets",
  ].every(
    (key) =>
      key in value &&
      typeof (value as Record<string, unknown>)[key] === "number",
  );
};

const isInaccessibleStylesheet = (
  value: unknown,
): value is InaccessibleStylesheet =>
  typeof value === "object" &&
  value !== null &&
  "href" in value &&
  typeof value.href === "string" &&
  "reason" in value &&
  typeof value.reason === "string";

const hasStylesheetFailures = (
  value: object,
): value is {
  inaccessibleStylesheets: InaccessibleStylesheet[];
} =>
  "inaccessibleStylesheets" in value &&
  Array.isArray(value.inaccessibleStylesheets) &&
  value.inaccessibleStylesheets.every(isInaccessibleStylesheet);

const isPageAnalysisTarget = (value: unknown): value is PageAnalysisTarget =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "tabId" in value &&
  typeof value.tabId === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "normalizedUrl" in value &&
  typeof value.normalizedUrl === "string" &&
  "title" in value &&
  typeof value.title === "string" &&
  "isAnalyzed" in value &&
  typeof value.isAnalyzed === "boolean" &&
  (!("pageId" in value) || typeof value.pageId === "string") &&
  (!("latestVersionNumber" in value) ||
    typeof value.latestVersionNumber === "number");

const isPageAnalysisResult = (value: unknown): value is PageAnalysisResult =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "page" in value &&
  isPage(value.page) &&
  "version" in value &&
  isPageVersion(value.version) &&
  "title" in value &&
  typeof value.title === "string" &&
  "url" in value &&
  typeof value.url === "string" &&
  "normalizedUrl" in value &&
  typeof value.normalizedUrl === "string" &&
  "capturedAt" in value &&
  typeof value.capturedAt === "string" &&
  "counts" in value &&
  isPageAnalysisCounts(value.counts) &&
  hasStylesheetFailures(value) &&
  "artifactDirectory" in value &&
  typeof value.artifactDirectory === "string";

const isAnalyzedPageSummary = (value: unknown): value is AnalyzedPageSummary =>
  typeof value === "object" &&
  value !== null &&
  "page" in value &&
  isPage(value.page) &&
  "latestVersion" in value &&
  isPageVersion(value.latestVersion) &&
  "title" in value &&
  typeof value.title === "string" &&
  "counts" in value &&
  isPageAnalysisCounts(value.counts) &&
  hasStylesheetFailures(value);

const pageAnalysisStages = new Set([
  "preparing",
  "capturing_html",
  "capturing_accessibility",
  "capturing_elements",
  "capturing_styles",
  "analyzing_semantics",
  "saving_artifacts",
  "creating_version",
  "completed",
]);

const isPageAnalysisProgress = (
  value: unknown,
): value is PageAnalysisProgress =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "stage" in value &&
  typeof value.stage === "string" &&
  pageAnalysisStages.has(value.stage) &&
  "completedSteps" in value &&
  typeof value.completedSteps === "number" &&
  "totalSteps" in value &&
  typeof value.totalSteps === "number" &&
  "message" in value &&
  typeof value.message === "string";

const testStatuses = new Set(["draft", "valid", "invalidated"]);
const testWorkflowStates = new Set([
  "not_recorded",
  "recording",
  "recorded",
  "analyzing_flow",
  "flow_analyzed",
  "ready",
]);

const isTestDefinition = (value: unknown): value is TestDefinition =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "name" in value &&
  typeof value.name === "string" &&
  (!("description" in value) || typeof value.description === "string") &&
  "status" in value &&
  typeof value.status === "string" &&
  testStatuses.has(value.status) &&
  "version" in value &&
  typeof value.version === "number" &&
  "testMode" in value &&
  (value.testMode === "recorded" || value.testMode === "dynamic_ai") &&
  "wipeBeforeRun" in value &&
  typeof value.wipeBeforeRun === "boolean" &&
  "startMode" in value &&
  (value.startMode === "base_url" || value.startMode === "current_page") &&
  "startUrl" in value &&
  typeof value.startUrl === "string" &&
  "normalizedStartUrl" in value &&
  typeof value.normalizedStartUrl === "string" &&
  "workflowState" in value &&
  typeof value.workflowState === "string" &&
  testWorkflowStates.has(value.workflowState) &&
  "createdAt" in value &&
  typeof value.createdAt === "string" &&
  "updatedAt" in value &&
  typeof value.updatedAt === "string" &&
  "flowItems" in value &&
  Array.isArray(value.flowItems);

const isTestVersion = (value: unknown): value is TestVersion =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "testId" in value &&
  typeof value.testId === "string" &&
  "versionNumber" in value &&
  typeof value.versionNumber === "number" &&
  "source" in value &&
  typeof value.source === "string" &&
  ["manual", "recorder", "ai", "import"].includes(value.source) &&
  "createdAt" in value &&
  typeof value.createdAt === "string" &&
  "snapshotFilePath" in value &&
  typeof value.snapshotFilePath === "string";

const isDatasetPrimitive = (
  value: unknown,
): value is string | number | boolean | null =>
  value === null ||
  typeof value === "string" ||
  typeof value === "boolean" ||
  (typeof value === "number" && Number.isFinite(value));

const isDatasetValue = (value: unknown): boolean => {
  if (isDatasetPrimitive(value)) {
    return true;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    typeof value.type !== "string"
  ) {
    return false;
  }
  if (value.type === "fixed") {
    return "value" in value && isDatasetPrimitive(value.value);
  }
  return (
    value.type === "generated" &&
    "strategy" in value &&
    typeof value.strategy === "string" &&
    [
      "timestamp",
      "uuid",
      "random_number",
      "unique_email",
      "current_date",
      "current_date_plus_days",
      "current_date_minus_days",
      "random_choice",
      "template",
    ].includes(value.strategy)
  );
};

const isTestDataset = (value: unknown): value is TestDataset =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "testId" in value &&
  typeof value.testId === "string" &&
  "name" in value &&
  typeof value.name === "string" &&
  "values" in value &&
  typeof value.values === "object" &&
  value.values !== null &&
  !Array.isArray(value.values) &&
  Object.values(value.values).every(isDatasetValue) &&
  "createdAt" in value &&
  typeof value.createdAt === "string" &&
  "updatedAt" in value &&
  typeof value.updatedAt === "string";

const isExportResult = (value: unknown): value is ExportResult =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  typeof value.path === "string";

const isTestImportPreview = (value: unknown): value is TestImportPreview =>
  typeof value === "object" &&
  value !== null &&
  "fileName" in value &&
  typeof value.fileName === "string" &&
  "valid" in value &&
  typeof value.valid === "boolean" &&
  "issues" in value &&
  Array.isArray(value.issues) &&
  value.issues.every(
    (item: unknown) =>
      typeof item === "object" &&
      item !== null &&
      "path" in item &&
      typeof item.path === "string" &&
      "code" in item &&
      typeof item.code === "string" &&
      "message" in item &&
      typeof item.message === "string",
  ) &&
  "datasets" in value &&
  Array.isArray(value.datasets);

const isConfirmedTestImport = (value: unknown): value is ConfirmedTestImport =>
  typeof value === "object" &&
  value !== null &&
  "test" in value &&
  isTestDefinition(value.test) &&
  "datasets" in value &&
  Array.isArray(value.datasets) &&
  value.datasets.every(isTestDataset);

const isTableIdentityConfig = (value: unknown): value is TableIdentityConfig =>
  typeof value === "object" &&
  value !== null &&
  "tableName" in value &&
  typeof value.tableName === "string" &&
  "columns" in value &&
  Array.isArray(value.columns) &&
  value.columns.every((column: unknown) => typeof column === "string");

const isMySqlSettingsSummary = (
  value: unknown,
): value is MySqlSettingsSummary =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "host" in value &&
  typeof value.host === "string" &&
  "port" in value &&
  typeof value.port === "number" &&
  "database" in value &&
  typeof value.database === "string" &&
  "username" in value &&
  typeof value.username === "string" &&
  "ssl" in value &&
  typeof value.ssl === "boolean" &&
  "passwordConfigured" in value &&
  typeof value.passwordConfigured === "boolean" &&
  "identities" in value &&
  Array.isArray(value.identities) &&
  value.identities.every(isTableIdentityConfig);

const isMySqlConnectionTestResult = (
  value: unknown,
): value is MySqlConnectionTestResult =>
  typeof value === "object" &&
  value !== null &&
  "success" in value &&
  value.success === true &&
  "message" in value &&
  typeof value.message === "string" &&
  "latencyMs" in value &&
  typeof value.latencyMs === "number";

const isImapAccountSummary = (value: unknown): value is ImapAccountSummary =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "name" in value &&
  typeof value.name === "string" &&
  "host" in value &&
  typeof value.host === "string" &&
  "port" in value &&
  typeof value.port === "number" &&
  "secure" in value &&
  typeof value.secure === "boolean" &&
  "username" in value &&
  typeof value.username === "string" &&
  "mailbox" in value &&
  typeof value.mailbox === "string" &&
  "passwordConfigured" in value &&
  typeof value.passwordConfigured === "boolean";

const isImapConnectionTestResult = (
  value: unknown,
): value is ImapConnectionTestResult =>
  typeof value === "object" &&
  value !== null &&
  "success" in value &&
  typeof value.success === "boolean" &&
  "message" in value &&
  typeof value.message === "string" &&
  "latencyMs" in value &&
  typeof value.latencyMs === "number";

const isImapMailboxSummary = (value: unknown): value is ImapMailboxSummary =>
  typeof value === "object" &&
  value !== null &&
  "path" in value &&
  typeof value.path === "string" &&
  "name" in value &&
  typeof value.name === "string" &&
  "subscribed" in value &&
  typeof value.subscribed === "boolean";

const isImapDiagnosticMessage = (
  value: unknown,
): value is ImapDiagnosticMessage =>
  typeof value === "object" &&
  value !== null &&
  "uid" in value &&
  typeof value.uid === "number" &&
  "mailbox" in value &&
  typeof value.mailbox === "string" &&
  "receivedAt" in value &&
  typeof value.receivedAt === "string" &&
  "subject" in value &&
  typeof value.subject === "string" &&
  "from" in value &&
  Array.isArray(value.from) &&
  value.from.every((address) => typeof address === "string") &&
  "to" in value &&
  Array.isArray(value.to) &&
  value.to.every((address) => typeof address === "string") &&
  "textPreview" in value &&
  typeof value.textPreview === "string";

const isImapDiagnosticPollResult = (
  value: unknown,
): value is ImapDiagnosticPollResult =>
  typeof value === "object" &&
  value !== null &&
  "checkedAt" in value &&
  typeof value.checkedAt === "string" &&
  "messages" in value &&
  Array.isArray(value.messages) &&
  value.messages.every(isImapDiagnosticMessage);

const isMySqlSchemaResult = (value: unknown): value is MySqlSchemaResult =>
  typeof value === "object" &&
  value !== null &&
  "database" in value &&
  typeof value.database === "string" &&
  "loadedAt" in value &&
  typeof value.loadedAt === "string" &&
  "tables" in value &&
  Array.isArray(value.tables) &&
  value.tables.every(
    (table: unknown) =>
      typeof table === "object" &&
      table !== null &&
      "name" in table &&
      typeof table.name === "string" &&
      "columns" in table &&
      Array.isArray(table.columns) &&
      table.columns.every(
        (column: unknown) =>
          typeof column === "object" &&
          column !== null &&
          "name" in column &&
          typeof column.name === "string" &&
          "dataType" in column &&
          typeof column.dataType === "string" &&
          "columnType" in column &&
          typeof column.columnType === "string" &&
          "nullable" in column &&
          typeof column.nullable === "boolean" &&
          "extra" in column &&
          typeof column.extra === "string" &&
          "ordinalPosition" in column &&
          typeof column.ordinalPosition === "number" &&
          "primaryKey" in column &&
          typeof column.primaryKey === "boolean",
      ) &&
      "primaryKey" in table &&
      Array.isArray(table.primaryKey) &&
      table.primaryKey.every((column: unknown) => typeof column === "string") &&
      "identityColumns" in table &&
      Array.isArray(table.identityColumns) &&
      table.identityColumns.every(
        (column: unknown) => typeof column === "string",
      ) &&
      "identitySource" in table &&
      ["primary_key", "manual", "none"].includes(
        table.identitySource as string,
      ),
  );

const runnerStates = new Set<RunnerState>([
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
]);

const isTestRun = (value: unknown): value is TestRun =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "testId" in value &&
  typeof value.testId === "string" &&
  "status" in value &&
  typeof value.status === "string" &&
  "startedAt" in value &&
  typeof value.startedAt === "string";

const isStepRunResult = (value: unknown): value is StepRunResult =>
  typeof value === "object" &&
  value !== null &&
  "id" in value &&
  typeof value.id === "string" &&
  "runId" in value &&
  typeof value.runId === "string" &&
  "stepId" in value &&
  typeof value.stepId === "string" &&
  "status" in value &&
  typeof value.status === "string" &&
  "logs" in value &&
  Array.isArray(value.logs);

const isRunHistoryEntry = (value: unknown): value is RunHistoryEntry =>
  typeof value === "object" &&
  value !== null &&
  "run" in value &&
  isTestRun(value.run) &&
  "testName" in value &&
  typeof value.testName === "string" &&
  "stepCount" in value &&
  typeof value.stepCount === "number" &&
  "failedStepCount" in value &&
  typeof value.failedStepCount === "number" &&
  "fallbackStepCount" in value &&
  typeof value.fallbackStepCount === "number";

const isRunStorageUsage = (value: unknown): value is RunStorageUsage =>
  typeof value === "object" &&
  value !== null &&
  [
    "runCount",
    "metadataBytes",
    "logsBytes",
    "snapshotsBytes",
    "totalBytes",
  ].every(
    (key) =>
      key in value && typeof value[key as keyof typeof value] === "number",
  );

const isRunHistoryMutation = (
  value: unknown,
): value is RunHistoryMutationResult =>
  typeof value === "object" &&
  value !== null &&
  "affected" in value &&
  typeof value.affected === "number" &&
  "storage" in value &&
  isRunStorageUsage(value.storage);

const isRunHistoryDetails = (value: unknown): value is RunHistoryDetails =>
  typeof value === "object" &&
  value !== null &&
  "entry" in value &&
  isRunHistoryEntry(value.entry) &&
  "steps" in value &&
  Array.isArray(value.steps) &&
  value.steps.every(isStepRunResult) &&
  "mysqlDiffs" in value &&
  Array.isArray(value.mysqlDiffs) &&
  "imapResults" in value &&
  Array.isArray(value.imapResults);

const missingDataInputKinds = new Set([
  "text",
  "password",
  "checkbox",
  "select",
  "radio",
]);

const isMissingDataDetails = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "fieldId" in value &&
  typeof value.fieldId === "string" &&
  "valueKey" in value &&
  typeof value.valueKey === "string" &&
  "inputKind" in value &&
  typeof value.inputKind === "string" &&
  missingDataInputKinds.has(value.inputKind) &&
  "locator" in value &&
  typeof value.locator === "object" &&
  value.locator !== null;

const wipeResources = new Set([
  "navigation",
  "cookies",
  "localStorage",
  "sessionStorage",
  "indexedDB",
  "cacheStorage",
  "serviceWorkers",
  "permissions",
]);
const wipeEntryStatuses = new Set(["cleared", "skipped", "failed"]);

const isWipeLogEntry = (entry: unknown): boolean =>
  typeof entry === "object" &&
  entry !== null &&
  "resource" in entry &&
  typeof entry.resource === "string" &&
  wipeResources.has(entry.resource) &&
  "status" in entry &&
  typeof entry.status === "string" &&
  wipeEntryStatuses.has(entry.status) &&
  "message" in entry &&
  typeof entry.message === "string" &&
  (!("count" in entry) || typeof entry.count === "number");

const isWipeDetails = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  "origin" in value &&
  typeof value.origin === "string" &&
  "status" in value &&
  (value.status === "completed" || value.status === "failed") &&
  "entries" in value &&
  Array.isArray(value.entries) &&
  value.entries.every((entry: unknown) => isWipeLogEntry(entry));

const isRunnerSnapshot = (value: unknown): value is RunnerSnapshot =>
  typeof value === "object" &&
  value !== null &&
  "state" in value &&
  typeof value.state === "string" &&
  runnerStates.has(value.state as RunnerState) &&
  "currentStepIndex" in value &&
  typeof value.currentStepIndex === "number" &&
  "totalSteps" in value &&
  typeof value.totalSteps === "number" &&
  "canStop" in value &&
  typeof value.canStop === "boolean" &&
  "canRetry" in value &&
  typeof value.canRetry === "boolean" &&
  (!("flowItems" in value) ||
    value.flowItems === undefined ||
    Array.isArray(value.flowItems)) &&
  (!("missingData" in value) ||
    value.missingData === undefined ||
    isMissingDataDetails(value.missingData)) &&
  (!("wipe" in value) ||
    value.wipe === undefined ||
    isWipeDetails(value.wipe)) &&
  (!("run" in value) || isTestRun(value.run));

const recorderStates = new Set<RecorderState>([
  "idle",
  "preparing",
  "recording",
  "analyzing",
  "preview",
  "error",
  "completed",
]);

const isRecorderStepDraft = (value: unknown): value is RecorderStepDraft =>
  typeof value === "object" &&
  value !== null &&
  "step" in value &&
  typeof value.step === "object" &&
  value.step !== null &&
  "id" in value.step &&
  typeof value.step.id === "string" &&
  "type" in value.step &&
  value.step.type === "action" &&
  (!("capturedValue" in value) ||
    value.capturedValue === null ||
    typeof value.capturedValue === "string" ||
    typeof value.capturedValue === "number" ||
    typeof value.capturedValue === "boolean") &&
  (!("capturedInputKind" in value) ||
    ["text", "password", "checkbox", "select", "radio"].includes(
      String(value.capturedInputKind),
    ));

const isRecorderSnapshot = (value: unknown): value is RecorderSnapshot =>
  typeof value === "object" &&
  value !== null &&
  "projectId" in value &&
  typeof value.projectId === "string" &&
  "testId" in value &&
  typeof value.testId === "string" &&
  "state" in value &&
  typeof value.state === "string" &&
  recorderStates.has(value.state as RecorderState) &&
  "signal" in value &&
  (value.signal === "green" ||
    value.signal === "yellow" ||
    value.signal === "red") &&
  "message" in value &&
  typeof value.message === "string" &&
  "test" in value &&
  isTestDefinition(value.test) &&
  "capturedSteps" in value &&
  typeof value.capturedSteps === "number" &&
  "queuedEvents" in value &&
  typeof value.queuedEvents === "number" &&
  "canStart" in value &&
  typeof value.canStart === "boolean" &&
  "canStop" in value &&
  typeof value.canStop === "boolean" &&
  "canRetry" in value &&
  typeof value.canRetry === "boolean" &&
  "canIgnore" in value &&
  typeof value.canIgnore === "boolean" &&
  (!("pendingStep" in value) ||
    value.pendingStep === undefined ||
    isRecorderStepDraft(value.pendingStep)) &&
  (!("error" in value) ||
    value.error === undefined ||
    typeof value.error === "string");

const semanticAppApi: SemanticAppApi = {
  getAppInfo: async () => {
    const appInfo: unknown = await ipcRenderer.invoke(APP_INFO_CHANNEL);

    if (!isAppInfo(appInfo)) {
      throw new TypeError("Main process returned invalid app information.");
    }

    return appInfo;
  },
  getAiSettings: async () => {
    const settings: unknown = await ipcRenderer.invoke(AI_CHANNELS.getSettings);
    if (!isAiSettingsSummary(settings)) {
      throw new TypeError("Main process returned invalid AI settings.");
    }
    return settings;
  },
  saveAiSettings: async (input) => {
    const settings: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.saveSettings,
      input,
    );
    if (!isAiSettingsSummary(settings)) {
      throw new TypeError("Main process returned invalid AI settings.");
    }
    return settings;
  },
  listAiModels: async (provider, refresh = false) => {
    const models: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.listModels,
      provider,
      refresh,
    );
    if (!Array.isArray(models) || !models.every(isAiModelInfo)) {
      throw new TypeError("Main process returned an invalid AI model list.");
    }
    return models;
  },
  testAiConnection: async (provider) => {
    const result: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.testConnection,
      provider,
    );
    if (!isAiConnectionTestResult(result)) {
      throw new TypeError("Main process returned an invalid AI test result.");
    }
    return result;
  },
  previewAiRequest: async (input) => {
    const preview: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.previewRequest,
      input,
    );
    if (!isAiRequestPreview(preview)) {
      throw new TypeError(
        "Main process returned an invalid AI request preview.",
      );
    }
    return preview;
  },
  previewAiStepEdit: async (input) => {
    const preview: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.previewStepEdit,
      input,
    );
    if (!isAiStepEditPreview(preview)) {
      throw new TypeError("Main process returned an invalid AI step preview.");
    }
    return preview;
  },
  generateAiStepEdit: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.generateStepEdit,
      input,
    );
    if (!isAiStepEditResult(result)) {
      throw new TypeError("Main process returned an invalid AI step result.");
    }
    return result;
  },
  previewAiRunPlan: async (input) => {
    const preview: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.previewRunPlan,
      input,
    );
    if (!isAiRunPlanPreview(preview)) {
      throw new TypeError("Main process returned an invalid AI run preview.");
    }
    return preview;
  },
  generateAiRunPlan: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.generateRunPlan,
      input,
    );
    if (!isAiRunPlanResult(result)) {
      throw new TypeError("Main process returned an invalid AI run plan.");
    }
    return result;
  },
  applyAiStepChanges: async (input) => {
    const result: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.applyStepChanges,
      input,
    );
    if (
      typeof result !== "object" ||
      result === null ||
      !("test" in result) ||
      !isTestDefinition(result.test) ||
      !("appliedStepIds" in result) ||
      !Array.isArray(result.appliedStepIds) ||
      !result.appliedStepIds.every((id) => typeof id === "string") ||
      !("aiVersion" in result) ||
      typeof result.aiVersion !== "number"
    ) {
      throw new TypeError("Main process returned an invalid AI apply result.");
    }
    return result as ApplyAiStepChangesResult;
  },
  undoAiStepChange: async (input) => {
    const test: unknown = await ipcRenderer.invoke(
      AI_CHANNELS.undoStepChange,
      input,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError("Main process returned invalid AI undo data.");
    }
    return test;
  },
  listProjects: async () => {
    const projects: unknown = await ipcRenderer.invoke(PROJECT_CHANNELS.list);

    if (
      !Array.isArray(projects) ||
      !projects.every((project) => isProjectOverview(project))
    ) {
      throw new TypeError("Main process returned an invalid project list.");
    }

    return projects;
  },
  createProject: async (input) =>
    requireProjectOverview(
      await ipcRenderer.invoke(PROJECT_CHANNELS.create, input),
    ),
  updateProject: async (projectId, input) =>
    requireProjectOverview(
      await ipcRenderer.invoke(PROJECT_CHANNELS.update, projectId, input),
    ),
  updateBrowserConfig: async (projectId, config: BrowserConfig) =>
    requireProjectOverview(
      await ipcRenderer.invoke(
        PROJECT_CHANNELS.updateBrowserConfig,
        projectId,
        config,
      ),
    ),
  getProjectBasicAuth: async (projectId) => {
    const settings: unknown = await ipcRenderer.invoke(
      PROJECT_CHANNELS.getBasicAuth,
      projectId,
    );

    if (!isProjectBasicAuthSettings(settings)) {
      throw new TypeError(
        "Main process returned invalid HTTP Basic Auth settings.",
      );
    }

    return settings;
  },
  saveProjectBasicAuth: async (projectId, input) => {
    const settings: unknown = await ipcRenderer.invoke(
      PROJECT_CHANNELS.saveBasicAuth,
      projectId,
      input,
    );

    if (!isProjectBasicAuthSettings(settings)) {
      throw new TypeError(
        "Main process returned invalid HTTP Basic Auth settings.",
      );
    }

    return settings;
  },
  deleteProjectBasicAuth: async (projectId) => {
    const wasDeleted: unknown = await ipcRenderer.invoke(
      PROJECT_CHANNELS.deleteBasicAuth,
      projectId,
    );

    if (typeof wasDeleted !== "boolean") {
      throw new TypeError(
        "Main process returned an invalid Basic Auth delete result.",
      );
    }

    return wasDeleted;
  },
  deleteProject: async (projectId) => {
    const wasDeleted: unknown = await ipcRenderer.invoke(
      PROJECT_CHANNELS.delete,
      projectId,
    );

    if (typeof wasDeleted !== "boolean") {
      throw new TypeError("Main process returned an invalid delete result.");
    }

    return wasDeleted;
  },
  detectBrowsers: async () => {
    const browsers: unknown = await ipcRenderer.invoke(BROWSER_CHANNELS.detect);

    if (
      !Array.isArray(browsers) ||
      !browsers.every((browser) => isDetectedBrowser(browser))
    ) {
      throw new TypeError("Main process returned invalid browser detections.");
    }

    return browsers;
  },
  launchBrowser: async (options) => {
    const session: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.launch,
      options,
    );

    if (!isBrowserSession(session)) {
      throw new TypeError("Main process returned an invalid browser session.");
    }

    return session;
  },
  openProjectUrl: async (projectId, url) => {
    const result: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.openProjectUrl,
      projectId,
      url,
    );

    if (!isBrowserNavigationResult(result)) {
      throw new TypeError(
        "Main process returned invalid browser navigation data.",
      );
    }

    return result;
  },
  submitBasicAuth: async (credentials) => {
    const result: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.submitBasicAuth,
      credentials,
    );

    if (!isBrowserNavigationResult(result)) {
      throw new TypeError(
        "Main process returned invalid browser navigation data.",
      );
    }

    return result;
  },
  cancelBasicAuth: async () => {
    await ipcRenderer.invoke(BROWSER_CHANNELS.cancelBasicAuth);
  },
  closeBrowser: async () => {
    await ipcRenderer.invoke(BROWSER_CHANNELS.close);
  },
  closeProjectTabs: async (projectId) => {
    await ipcRenderer.invoke(BROWSER_CHANNELS.closeProjectTabs, projectId);
  },
  recoverBrowserConnection: async () => {
    const session: unknown = await ipcRenderer.invoke(BROWSER_CHANNELS.recover);

    if (!isBrowserSession(session)) {
      throw new TypeError("Main process returned an invalid browser session.");
    }

    return session;
  },
  selectBrowserProfilePath: async () => {
    const profilePath: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.selectProfilePath,
    );

    if (profilePath !== undefined && typeof profilePath !== "string") {
      throw new TypeError("Main process returned an invalid profile path.");
    }

    return profilePath;
  },
  getBrowserStatus: async () => {
    const status: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.getStatus,
    );

    if (!isBrowserStatus(status)) {
      throw new TypeError("Main process returned an invalid browser status.");
    }

    return status;
  },
  onBrowserStatusChange: (listener) => {
    const handleStatusChange = (_event: unknown, status: unknown): void => {
      if (isBrowserStatus(status)) {
        listener(status);
      }
    };

    ipcRenderer.on(BROWSER_CHANNELS.statusChanged, handleStatusChange);
    return () => {
      ipcRenderer.removeListener(
        BROWSER_CHANNELS.statusChanged,
        handleStatusChange,
      );
    };
  },
  getCurrentPageAnalysisTarget: async (projectId) => {
    const target: unknown = await ipcRenderer.invoke(
      PAGE_ANALYSIS_CHANNELS.getCurrentTarget,
      projectId,
    );

    if (target !== undefined && !isPageAnalysisTarget(target)) {
      throw new TypeError("Main process returned an invalid analysis target.");
    }

    return target;
  },
  analyzeCurrentPage: async (projectId) => {
    const result: unknown = await ipcRenderer.invoke(
      PAGE_ANALYSIS_CHANNELS.analyzeCurrent,
      projectId,
    );

    if (!isPageAnalysisResult(result)) {
      throw new TypeError("Main process returned invalid page analysis data.");
    }

    return result;
  },
  listAnalyzedPages: async (projectId) => {
    const pages: unknown = await ipcRenderer.invoke(
      PAGE_ANALYSIS_CHANNELS.list,
      projectId,
    );

    if (
      !Array.isArray(pages) ||
      !pages.every((page) => isAnalyzedPageSummary(page))
    ) {
      throw new TypeError("Main process returned an invalid analysis list.");
    }

    return pages;
  },
  onPageAnalysisProgress: (listener) => {
    const handleProgress = (_event: unknown, progress: unknown): void => {
      if (isPageAnalysisProgress(progress)) {
        listener(progress);
      }
    };

    ipcRenderer.on(PAGE_ANALYSIS_CHANNELS.progress, handleProgress);
    return () => {
      ipcRenderer.removeListener(
        PAGE_ANALYSIS_CHANNELS.progress,
        handleProgress,
      );
    };
  },
  listTests: async (projectId) => {
    const tests: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.list,
      projectId,
    );
    if (
      !Array.isArray(tests) ||
      !tests.every((test) => isTestDefinition(test))
    ) {
      throw new TypeError("Main process returned an invalid test list.");
    }
    return tests;
  },
  getTest: async (projectId, testId) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.get,
      projectId,
      testId,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError("Main process returned invalid test data.");
    }
    return test;
  },
  createTest: async (projectId, input) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.create,
      projectId,
      input,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError("Main process returned invalid test data.");
    }
    return test;
  },
  updateTest: async (projectId, testId, input) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.update,
      projectId,
      testId,
      input,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError("Main process returned invalid test data.");
    }
    return test;
  },
  saveTestFlow: async (projectId, testId, flowItems) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.saveFlow,
      projectId,
      testId,
      flowItems,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError("Main process returned invalid saved test data.");
    }
    return test;
  },
  saveTestPostRunChecks: async (
    projectId: string,
    testId: string,
    checks: TestPostRunChecks,
  ) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.savePostRunChecks,
      projectId,
      testId,
      checks,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError(
        "Main process returned invalid post-run checks data.",
      );
    }
    return test;
  },
  listTestVersions: async (projectId, testId) => {
    const versions: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.listVersions,
      projectId,
      testId,
    );
    if (
      !Array.isArray(versions) ||
      !versions.every((version) => isTestVersion(version))
    ) {
      throw new TypeError("Main process returned invalid test versions.");
    }
    return versions;
  },
  revalidateTest: async (projectId, testId) => {
    const test: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.revalidate,
      projectId,
      testId,
    );
    if (!isTestDefinition(test)) {
      throw new TypeError(
        "Main process returned invalid revalidated test data.",
      );
    }
    return test;
  },
  deleteTest: async (projectId, testId) => {
    const wasDeleted: unknown = await ipcRenderer.invoke(
      TEST_CHANNELS.delete,
      projectId,
      testId,
    );
    if (typeof wasDeleted !== "boolean") {
      throw new TypeError("Main process returned an invalid delete result.");
    }
    return wasDeleted;
  },
  previewTestImport: async (projectId) => {
    const preview: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.previewImport,
      projectId,
    );
    if (preview === undefined) return undefined;
    if (!isTestImportPreview(preview)) {
      throw new TypeError("Main process returned an invalid import preview.");
    }
    return preview;
  },
  confirmTestImport: async (projectId, previewId) => {
    const imported: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.confirmImport,
      projectId,
      previewId,
    );
    if (!isConfirmedTestImport(imported)) {
      throw new TypeError("Main process returned an invalid imported test.");
    }
    return imported;
  },
  exportTestJson: async (projectId, testId) => {
    const result: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.exportTest,
      projectId,
      testId,
    );
    if (result === undefined) return undefined;
    if (!isExportResult(result)) {
      throw new TypeError("Main process returned an invalid export result.");
    }
    return result;
  },
  exportDatasetJson: async (projectId, testId, datasetId) => {
    const result: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.exportDataset,
      projectId,
      testId,
      datasetId,
    );
    if (result === undefined) return undefined;
    if (!isExportResult(result)) {
      throw new TypeError("Main process returned an invalid export result.");
    }
    return result;
  },
  exportAllDatasetsJson: async (projectId, testId) => {
    const result: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.exportAllDatasets,
      projectId,
      testId,
    );
    if (result === undefined) return undefined;
    if (!isExportResult(result)) {
      throw new TypeError("Main process returned an invalid export result.");
    }
    return result;
  },
  exportPageAnalysisJson: async (projectId, pageId) => {
    const result: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.exportPageAnalysis,
      projectId,
      pageId,
    );
    if (result === undefined) return undefined;
    if (!isExportResult(result)) {
      throw new TypeError("Main process returned an invalid export result.");
    }
    return result;
  },
  exportAnalysisBundle: async (projectId) => {
    const result: unknown = await ipcRenderer.invoke(
      TRANSFER_CHANNELS.exportAnalysisBundle,
      projectId,
    );
    if (result === undefined) return undefined;
    if (!isExportResult(result)) {
      throw new TypeError("Main process returned an invalid export result.");
    }
    return result;
  },
  getMySqlSettings: async (projectId) => {
    const settings: unknown = await ipcRenderer.invoke(
      MYSQL_CHANNELS.getSettings,
      projectId,
    );
    if (!isMySqlSettingsSummary(settings)) {
      throw new TypeError("Main process returned invalid MySQL settings.");
    }
    return settings;
  },
  saveMySqlSettings: async (projectId, input) => {
    const settings: unknown = await ipcRenderer.invoke(
      MYSQL_CHANNELS.saveSettings,
      projectId,
      input,
    );
    if (!isMySqlSettingsSummary(settings)) {
      throw new TypeError("Main process returned invalid MySQL settings.");
    }
    return settings;
  },
  testMySqlConnection: async (projectId, input) => {
    const result: unknown = await ipcRenderer.invoke(
      MYSQL_CHANNELS.testConnection,
      projectId,
      input,
    );
    if (!isMySqlConnectionTestResult(result)) {
      throw new TypeError(
        "Main process returned an invalid MySQL connection result.",
      );
    }
    return result;
  },
  loadMySqlSchema: async (projectId, input) => {
    const result: unknown = await ipcRenderer.invoke(
      MYSQL_CHANNELS.loadSchema,
      projectId,
      input,
    );
    if (!isMySqlSchemaResult(result)) {
      throw new TypeError("Main process returned an invalid MySQL schema.");
    }
    return result;
  },
  saveMySqlIdentityConfig: async (projectId, identities) => {
    const result: unknown = await ipcRenderer.invoke(
      MYSQL_CHANNELS.saveIdentityConfig,
      projectId,
      identities,
    );
    if (!isMySqlSchemaResult(result)) {
      throw new TypeError("Main process returned an invalid MySQL schema.");
    }
    return result;
  },
  listImapAccounts: async () => {
    const accounts: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.listAccounts,
    );
    if (
      !Array.isArray(accounts) ||
      !accounts.every((account) => isImapAccountSummary(account))
    ) {
      throw new TypeError("Main process returned invalid IMAP accounts.");
    }
    return accounts;
  },
  saveImapAccount: async (input: SaveImapAccountInput) => {
    const account: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.saveAccount,
      input,
    );
    if (!isImapAccountSummary(account)) {
      throw new TypeError("Main process returned an invalid IMAP account.");
    }
    return account;
  },
  deleteImapAccount: async (accountId: string) => {
    const deleted: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.deleteAccount,
      accountId,
    );
    if (typeof deleted !== "boolean") {
      throw new TypeError(
        "Main process returned an invalid IMAP delete result.",
      );
    }
    return deleted;
  },
  testImapConnection: async (input: SaveImapAccountInput) => {
    const result: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.testConnection,
      input,
    );
    if (!isImapConnectionTestResult(result)) {
      throw new TypeError(
        "Main process returned an invalid IMAP connection result.",
      );
    }
    return result;
  },
  listImapMailboxes: async (accountId: string) => {
    const mailboxes: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.listMailboxes,
      accountId,
    );
    if (
      !Array.isArray(mailboxes) ||
      !mailboxes.every((mailbox) => isImapMailboxSummary(mailbox))
    ) {
      throw new TypeError("Main process returned invalid IMAP mailboxes.");
    }
    return mailboxes;
  },
  pollImapDiagnostic: async (
    input: SaveImapAccountInput,
    receivedAfter: string,
  ) => {
    const result: unknown = await ipcRenderer.invoke(
      IMAP_CHANNELS.pollDiagnostic,
      input,
      receivedAfter,
    );
    if (!isImapDiagnosticPollResult(result)) {
      throw new TypeError(
        "Main process returned an invalid IMAP diagnostic result.",
      );
    }
    return result;
  },
  listDatasets: async (projectId, testId) => {
    const datasets: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.list,
      projectId,
      testId,
    );
    if (
      !Array.isArray(datasets) ||
      !datasets.every((dataset) => isTestDataset(dataset))
    ) {
      throw new TypeError("Main process returned an invalid dataset list.");
    }
    return datasets;
  },
  createDataset: async (projectId, testId, input) => {
    const dataset: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.create,
      projectId,
      testId,
      input,
    );
    if (!isTestDataset(dataset)) {
      throw new TypeError("Main process returned invalid dataset data.");
    }
    return dataset;
  },
  duplicateDataset: async (projectId, testId, datasetId) => {
    const dataset: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.duplicate,
      projectId,
      testId,
      datasetId,
    );
    if (!isTestDataset(dataset)) {
      throw new TypeError("Main process returned invalid dataset data.");
    }
    return dataset;
  },
  saveDataset: async (projectId, testId, datasetId, input) => {
    const dataset: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.save,
      projectId,
      testId,
      datasetId,
      input,
    );
    if (!isTestDataset(dataset)) {
      throw new TypeError("Main process returned invalid dataset data.");
    }
    return dataset;
  },
  deleteDataset: async (projectId, testId, datasetId) => {
    const wasDeleted: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.delete,
      projectId,
      testId,
      datasetId,
    );
    if (typeof wasDeleted !== "boolean") {
      throw new TypeError("Main process returned an invalid delete result.");
    }
    return wasDeleted;
  },
  previewDatasetValue: async (projectId, testId, input) => {
    const preview: unknown = await ipcRenderer.invoke(
      DATASET_CHANNELS.previewValue,
      projectId,
      testId,
      input,
    );
    if (!isDatasetPrimitive(preview)) {
      throw new TypeError(
        "Main process returned invalid dataset preview data.",
      );
    }
    return preview;
  },
  startRun: async (input) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.start,
      input,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid runner data.");
    }
    return snapshot;
  },
  stopRun: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.stop,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid runner data.");
    }
    return snapshot;
  },
  retryRunStep: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.retry,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid runner data.");
    }
    return snapshot;
  },
  skipRunStep: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.skipStep,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid skipped-step data.");
    }
    return snapshot;
  },
  continueRun: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.continue,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid continue data.");
    }
    return snapshot;
  },
  configureRunnerShortcut: async (projectId, shortcut) => {
    const configured: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.configureShortcut,
      projectId,
      shortcut,
    );
    if (typeof configured !== "string") {
      throw new TypeError("Main process returned an invalid shortcut.");
    }
    return configured;
  },
  runCurrentFallback: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.runFallback,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid fallback data.");
    }
    return snapshot;
  },
  skipCurrentFallback: async (runId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.skipFallback,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid fallback data.");
    }
    return snapshot;
  },
  previewMySqlCleanup: async (runId, diffId, rows) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.previewMySqlCleanup,
      runId,
      diffId,
      rows,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid MySQL cleanup data.");
    }
    return snapshot;
  },
  confirmMySqlCleanup: async (runId, previewId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.confirmMySqlCleanup,
      runId,
      previewId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid MySQL cleanup data.");
    }
    return snapshot;
  },
  pollImapCheck: async (runId: string) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.pollImapCheck,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid IMAP check data.");
    }
    return snapshot;
  },
  abandonImapCheck: async (runId: string) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.abandonImapCheck,
      runId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid IMAP check data.");
    }
    return snapshot;
  },
  manualWipeRunData: async (runId: string, resources: ManualWipeResource[]) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.manualWipe,
      runId,
      resources,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid manual wipe data.");
    }
    return snapshot;
  },
  getRunnerStatus: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.getStatus,
      projectId,
      testId,
    );
    if (!isRunnerSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid runner data.");
    }
    return snapshot;
  },
  listTestRuns: async (projectId, testId) => {
    const runs: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.listRuns,
      projectId,
      testId,
    );
    if (!Array.isArray(runs) || !runs.every((run) => isTestRun(run))) {
      throw new TypeError("Main process returned invalid test runs.");
    }
    return runs;
  },
  listRunStepResults: async (projectId, testId, runId) => {
    const results: unknown = await ipcRenderer.invoke(
      RUNNER_CHANNELS.listStepResults,
      projectId,
      testId,
      runId,
    );
    if (
      !Array.isArray(results) ||
      !results.every((result) => isStepRunResult(result))
    ) {
      throw new TypeError("Main process returned invalid step results.");
    }
    return results;
  },
  listProjectRunHistory: async (projectId, filters) => {
    const entries: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.list,
      projectId,
      filters,
    );
    if (!Array.isArray(entries) || !entries.every(isRunHistoryEntry)) {
      throw new TypeError("Main process returned invalid run history.");
    }
    return entries;
  },
  getRunHistoryDetails: async (projectId, runId) => {
    const details: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.details,
      projectId,
      runId,
    );
    if (!isRunHistoryDetails(details)) {
      throw new TypeError("Main process returned invalid run details.");
    }
    return details;
  },
  deleteRunHistory: async (projectId, runIds) => {
    const result: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.deleteSelected,
      projectId,
      runIds,
    );
    if (!isRunHistoryMutation(result)) {
      throw new TypeError(
        "Main process returned invalid history deletion data.",
      );
    }
    return result;
  },
  deleteAllRunHistory: async (projectId) => {
    const result: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.deleteAll,
      projectId,
    );
    if (!isRunHistoryMutation(result)) {
      throw new TypeError(
        "Main process returned invalid history deletion data.",
      );
    }
    return result;
  },
  getRunStorageUsage: async (projectId) => {
    const usage: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.storage,
      projectId,
    );
    if (!isRunStorageUsage(usage)) {
      throw new TypeError("Main process returned invalid run storage data.");
    }
    return usage;
  },
  purgeRunHistoryData: async (projectId, target) => {
    const result: unknown = await ipcRenderer.invoke(
      RUN_HISTORY_CHANNELS.purge,
      projectId,
      target,
    );
    if (!isRunHistoryMutation(result)) {
      throw new TypeError("Main process returned invalid run purge data.");
    }
    return result;
  },
  onRunnerStatusChange: (listener) => {
    const handleStatus = (_event: unknown, snapshot: unknown): void => {
      if (isRunnerSnapshot(snapshot)) listener(snapshot);
    };
    ipcRenderer.on(RUNNER_CHANNELS.statusChanged, handleStatus);
    return () => {
      ipcRenderer.removeListener(RUNNER_CHANNELS.statusChanged, handleStatus);
    };
  },
  startRecorder: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.start,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid recorder start data.");
    }
    return snapshot;
  },
  stopRecorder: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.stop,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid recorder stop data.");
    }
    return snapshot;
  },
  addRecorderStep: async (projectId, testId, draft) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.addStep,
      projectId,
      testId,
      draft,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid recorder step data.");
    }
    return snapshot;
  },
  discardRecorderStep: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.discardStep,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError(
        "Main process returned invalid recorder discard data.",
      );
    }
    return snapshot;
  },
  retryRecorderAnalysis: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.retry,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid recorder retry data.");
    }
    return snapshot;
  },
  ignoreRecorderAnalysisError: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.ignoreError,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError(
        "Main process returned invalid recorder ignore data.",
      );
    }
    return snapshot;
  },
  getRecorderStatus: async (projectId, testId) => {
    const snapshot: unknown = await ipcRenderer.invoke(
      RECORDER_CHANNELS.getStatus,
      projectId,
      testId,
    );
    if (!isRecorderSnapshot(snapshot)) {
      throw new TypeError("Main process returned invalid recorder status.");
    }
    return snapshot;
  },
  onRecorderStatusChange: (listener) => {
    const handleStatus = (_event: unknown, snapshot: unknown): void => {
      if (isRecorderSnapshot(snapshot)) listener(snapshot);
    };
    ipcRenderer.on(RECORDER_CHANNELS.statusChanged, handleStatus);
    return () => {
      ipcRenderer.removeListener(RECORDER_CHANNELS.statusChanged, handleStatus);
    };
  },
};

contextBridge.exposeInMainWorld("semanticApp", semanticAppApi);
