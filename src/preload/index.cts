import { contextBridge, ipcRenderer } from "electron";

import type { AppInfo, AppInfoChannel, SemanticAppApi } from "../shared/ipc.js";

const APP_INFO_CHANNEL: AppInfoChannel = "app:get-info";

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

const semanticAppApi: SemanticAppApi = {
  getAppInfo: async () => {
    const appInfo: unknown = await ipcRenderer.invoke(APP_INFO_CHANNEL);

    if (!isAppInfo(appInfo)) {
      throw new TypeError("Main process returned invalid app information.");
    }

    return appInfo;
  },
};

contextBridge.exposeInMainWorld("semanticApp", semanticAppApi);
