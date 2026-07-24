import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";

import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;

const rendererEntryPath = fileURLToPath(
  new URL("../renderer/index.html", import.meta.url),
);

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow(createMainWindowOptions());

  void mainWindow.loadFile(rendererEntryPath).catch((error: unknown) => {
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
