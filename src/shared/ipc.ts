export type AppInfoChannel = "app:get-info";

export const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

export interface AppInfo {
  version: string;
  electronVersion: string;
}

export interface SemanticAppApi {
  getAppInfo: () => Promise<AppInfo>;
}
