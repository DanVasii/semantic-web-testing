import type { ProjectInput, ProjectOverview } from "./projects.js";
import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserSession,
  BrowserTab,
  DetectedBrowser,
} from "./browser-manager.js";

export type AppInfoChannel = "app:get-info";

export const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

export const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  delete: "projects:delete",
} as const;

export const BROWSER_CHANNELS = {
  detect: "browsers:detect",
  launch: "browsers:launch",
  openProjectUrl: "browsers:open-project-url",
  close: "browsers:close",
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
  deleteProject: (projectId: string) => Promise<boolean>;
  detectBrowsers: () => Promise<DetectedBrowser[]>;
  launchBrowser: (options: BrowserLaunchOptions) => Promise<BrowserSession>;
  openProjectUrl: (projectId: string, url: string) => Promise<BrowserTab>;
  closeBrowser: () => Promise<void>;
  getBrowserStatus: () => Promise<BrowserManagerStatus>;
  onBrowserStatusChange: (
    listener: (status: BrowserManagerStatus) => void,
  ) => () => void;
}
