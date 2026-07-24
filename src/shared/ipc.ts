import type { ProjectInput, ProjectOverview } from "./projects.js";
import type { BrowserConfig } from "./persistence.js";
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
}
