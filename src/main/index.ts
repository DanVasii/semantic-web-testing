import { app, BrowserWindow, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { APP_INFO_CHANNEL, PROJECT_CHANNELS } from "../shared/ipc.js";
import type { ProjectInput } from "../shared/projects.js";
import { createAppInfo } from "./app-info.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import { ProjectRepository } from "./persistence/repositories.js";
import { ProjectsService } from "./projects-service.js";
import { resolveRendererTarget } from "./renderer-target.js";
import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;
let applicationDatabase: ApplicationDatabase | null = null;

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
  .then(async () => {
    applicationDatabase = await openApplicationDatabase({
      filePath: join(app.getPath("userData"), "data", "application.sqlite"),
    });

    if (applicationDatabase.backupPath !== undefined) {
      console.info(
        `Database backup created before migration: ${applicationDatabase.backupPath}`,
      );
    }

    const projectsService = new ProjectsService(
      new ProjectRepository(applicationDatabase.connection),
      {
        createId: randomUUID,
        now: () => new Date(),
      },
    );

    ipcMain.handle(APP_INFO_CHANNEL, () =>
      createAppInfo(app.getVersion(), process.versions.electron),
    );
    ipcMain.handle(PROJECT_CHANNELS.list, () => projectsService.list());
    ipcMain.handle(PROJECT_CHANNELS.create, (_event, input: ProjectInput) =>
      projectsService.create(input),
    );
    ipcMain.handle(
      PROJECT_CHANNELS.update,
      (_event, projectId: string, input: ProjectInput) =>
        projectsService.update(projectId, input),
    );
    ipcMain.handle(PROJECT_CHANNELS.delete, (_event, projectId: string) =>
      projectsService.delete(projectId),
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

app.on("before-quit", () => {
  applicationDatabase?.close();
  applicationDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
