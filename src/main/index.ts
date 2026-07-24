import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

import { resolveRendererTarget } from "./renderer-target.js";
import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;

const rendererEntryPath = fileURLToPath(
  new URL("../renderer/index.html", import.meta.url),
);
const rendererTarget = resolveRendererTarget(
  process.env["SEMANTIC_APP_RENDERER_URL"],
  rendererEntryPath,
);

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow(createMainWindowOptions());

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
