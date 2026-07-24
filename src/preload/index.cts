import { contextBridge, ipcRenderer } from "electron";

import type { AppInfo, AppInfoChannel, SemanticAppApi } from "../shared/ipc.js";
import type {
  BrowserManagerStatus,
  BrowserSession,
  BrowserTab,
  DetectedBrowser,
} from "../shared/browser-manager.js";
import type { ProjectOverview } from "../shared/projects.js";
import type { BrowserConfig } from "../shared/persistence.js";

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
  close: "browsers:close",
  closeProjectTabs: "browsers:close-project-tabs",
  recover: "browsers:recover",
  selectProfilePath: "browsers:select-profile-path",
  getStatus: "browsers:get-status",
  statusChanged: "browsers:status-changed",
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

const browserStates = new Set([
  "idle",
  "starting",
  "running",
  "reconnecting",
  "closed",
  "failed",
]);

const isBrowserStatus = (value: unknown): value is BrowserManagerStatus =>
  typeof value === "object" &&
  value !== null &&
  "state" in value &&
  typeof value.state === "string" &&
  browserStates.has(value.state);

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
    const tab: unknown = await ipcRenderer.invoke(
      BROWSER_CHANNELS.openProjectUrl,
      projectId,
      url,
    );

    if (!isBrowserTab(tab)) {
      throw new TypeError("Main process returned invalid browser tab data.");
    }

    return tab;
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
};

contextBridge.exposeInMainWorld("semanticApp", semanticAppApi);
