import { contextBridge, ipcRenderer } from "electron";

import type { AppInfo, AppInfoChannel, SemanticAppApi } from "../shared/ipc.js";
import type {
  BasicAuthChallenge,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  BrowserTab,
  DetectedBrowser,
} from "../shared/browser-manager.js";
import type { ProjectOverview } from "../shared/projects.js";
import type {
  BrowserConfig,
  Page,
  PageVersion,
  TestDefinition,
} from "../shared/persistence.js";
import type {
  AnalyzedPageSummary,
  InaccessibleStylesheet,
  PageAnalysisCounts,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "../shared/page-analysis.js";

const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";
const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  updateBrowserConfig: "projects:update-browser-config",
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
  delete: "tests:delete",
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
  "projectId" in value &&
  typeof value.projectId === "string" &&
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
  typeof value.invalidCredentials === "boolean";

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
  "projectId" in value &&
  typeof value.projectId === "string" &&
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

const semanticAppApi: SemanticAppApi = {
  getAppInfo: async () => {
    const appInfo: unknown = await ipcRenderer.invoke(APP_INFO_CHANNEL);

    if (!isAppInfo(appInfo)) {
      throw new TypeError("Main process returned invalid app information.");
    }

    return appInfo;
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

    if (!isPageAnalysisTarget(target)) {
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
};

contextBridge.exposeInMainWorld("semanticApp", semanticAppApi);
