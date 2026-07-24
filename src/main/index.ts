import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";

import { APP_INFO_CHANNEL } from "../shared/ipc.js";
import { createAppInfo } from "./app-info.js";
import { resolveRendererTarget } from "./renderer-target.js";
import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;

const rendererEntryPath = fileURLToPath(
  new URL("../renderer/index.html", import.meta.url),
);
const preloadPath = fileURLToPath(
  new URL("../preload/index.cjs", import.meta.url),
);
const rendererTarget = resolveRendererTarget(
  process.env["SEMANTIC_APP_RENDERER_URL"],
  rendererEntryPath,
);

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow(createMainWindowOptions(preloadPath));

  const rendererLoad =
    rendererTarget.kind === "development-url"
      ? mainWindow.loadURL(rendererTarget.value)
      : mainWindow.loadFile(rendererTarget.value);

  void rendererLoad.catch((error: unknown) => {
    console.error("Electron failed to load the renderer.", error);
    app.exit(1);
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
};

app.enableSandbox();

void app
  .whenReady()
  .then(() => {
    ipcMain.handle(APP_INFO_CHANNEL, () =>
      createAppInfo(app.getVersion(), process.versions.electron),
    );

    createMainWindow();

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow();
      }
    });
  })
  .catch((error: unknown) => {
    console.error("Electron failed to start.", error);
    app.exit(1);
  });

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
