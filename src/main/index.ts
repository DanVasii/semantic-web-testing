import { app, BrowserWindow } from "electron";

import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow(createMainWindowOptions());

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
