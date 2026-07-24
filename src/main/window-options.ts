import type { BrowserWindowConstructorOptions } from "electron";

export const createMainWindowOptions = (): BrowserWindowConstructorOptions => ({
  width: 1280,
  height: 800,
  minWidth: 960,
  minHeight: 640,
  backgroundColor: "#f7f5f2",
  title: "Semantic Web Testing App",
  webPreferences: {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
  },
});
