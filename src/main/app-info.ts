import type { AppInfo } from "../shared/ipc.js";

export const createAppInfo = (
  version: string,
  electronVersion: string,
): AppInfo => ({
  version,
  electronVersion,
});
