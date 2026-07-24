import type { ProjectInput, ProjectOverview } from "./projects.js";

export type AppInfoChannel = "app:get-info";

export const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

export const PROJECT_CHANNELS = {
  list: "projects:list",
  create: "projects:create",
  update: "projects:update",
  delete: "projects:delete",
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
}
