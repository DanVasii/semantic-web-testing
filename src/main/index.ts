import { app, BrowserWindow, dialog, ipcMain } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_INFO_CHANNEL,
  BROWSER_CHANNELS,
  PAGE_ANALYSIS_CHANNELS,
  PROJECT_CHANNELS,
  RUNNER_CHANNELS,
  TEST_CHANNELS,
} from "../shared/ipc.js";
import type {
  BasicAuthCredentials,
  BrowserLaunchOptions,
} from "../shared/browser-manager.js";
import type { BrowserConfig } from "../shared/persistence.js";
import type { TestFlowItem } from "../shared/test-model.js";
import type { StartRunInput } from "../shared/runner.js";
import type { ProjectInput } from "../shared/projects.js";
import type { TestInput } from "../shared/tests.js";
import { createAppInfo } from "./app-info.js";
import { PlaywrightBrowserManager } from "./browser/playwright-browser-manager.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { PageAnalysisService } from "./page-analysis/page-analysis-service.js";
import { ProjectsService } from "./projects-service.js";
import { TestsService } from "./tests-service.js";
import { TestRunnerService } from "./runner/test-runner-service.js";
import { resolveRendererTarget } from "./renderer-target.js";
import { createMainWindowOptions } from "./window-options.js";

let mainWindow: BrowserWindow | null = null;
let applicationDatabase: ApplicationDatabase | null = null;
const browserManager = new PlaywrightBrowserManager();

browserManager.onStatusChange((status) => {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(BROWSER_CHANNELS.statusChanged, status);
  }
});

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

    const projectRepository = new ProjectRepository(
      applicationDatabase.connection,
    );
    const pageRepository = new PageRepository(applicationDatabase.connection);
    const testRepository = new TestRepository(applicationDatabase.connection);
    const datasetRepository = new DatasetRepository(
      applicationDatabase.connection,
    );
    const runRepository = new RunRepository(applicationDatabase.connection);
    const projectsService = new ProjectsService(projectRepository, {
      createId: randomUUID,
      now: () => new Date(),
    });
    const pageAnalysisService = new PageAnalysisService(
      projectRepository,
      pageRepository,
      browserManager,
      {
        artifactRoot: join(app.getPath("userData"), "data", "artifacts"),
        createId: randomUUID,
        now: () => new Date(),
      },
    );
    const testsService = new TestsService(
      projectRepository,
      testRepository,
      datasetRepository,
      {
        createId: randomUUID,
        now: () => new Date(),
        snapshotRoot: join(app.getPath("userData"), "data", "test-versions"),
      },
    );
    const testRunnerService = new TestRunnerService(
      projectRepository,
      testRepository,
      datasetRepository,
      pageRepository,
      runRepository,
      browserManager,
      {
        createId: randomUUID,
        now: () => new Date(),
      },
    );
    testRunnerService.onStatusChange((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(RUNNER_CHANNELS.statusChanged, snapshot);
      }
    });

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
    ipcMain.handle(
      PROJECT_CHANNELS.updateBrowserConfig,
      (_event, projectId: string, config: BrowserConfig) =>
        projectsService.updateBrowserConfig(projectId, config),
    );
    ipcMain.handle(PROJECT_CHANNELS.delete, (_event, projectId: string) =>
      projectsService.delete(projectId),
    );
    ipcMain.handle(BROWSER_CHANNELS.detect, () =>
      browserManager.detectAvailableBrowsers(),
    );
    ipcMain.handle(
      BROWSER_CHANNELS.launch,
      (_event, options: BrowserLaunchOptions) => browserManager.launch(options),
    );
    ipcMain.handle(
      BROWSER_CHANNELS.openProjectUrl,
      (_event, projectId: string, url: string) =>
        browserManager.openProjectUrl(projectId, url),
    );
    ipcMain.handle(
      BROWSER_CHANNELS.submitBasicAuth,
      (_event, credentials: BasicAuthCredentials) =>
        browserManager.submitBasicAuth(credentials),
    );
    ipcMain.handle(BROWSER_CHANNELS.cancelBasicAuth, () =>
      browserManager.cancelBasicAuth(),
    );
    ipcMain.handle(BROWSER_CHANNELS.close, () => browserManager.close());
    ipcMain.handle(
      BROWSER_CHANNELS.closeProjectTabs,
      (_event, projectId: string) => browserManager.closeProjectTabs(projectId),
    );
    ipcMain.handle(BROWSER_CHANNELS.recover, () =>
      browserManager.recoverConnection(),
    );
    ipcMain.handle(BROWSER_CHANNELS.selectProfilePath, async () => {
      const selection = await dialog.showOpenDialog({
        title: "Alege directorul profilului de automatizare",
        properties: ["openDirectory", "createDirectory"],
      });
      return selection.canceled ? undefined : selection.filePaths[0];
    });
    ipcMain.handle(BROWSER_CHANNELS.getStatus, () =>
      browserManager.getStatus(),
    );
    ipcMain.handle(
      PAGE_ANALYSIS_CHANNELS.getCurrentTarget,
      (_event, projectId: string) =>
        pageAnalysisService.getCurrentTarget(projectId),
    );
    ipcMain.handle(
      PAGE_ANALYSIS_CHANNELS.analyzeCurrent,
      (event, projectId: string) =>
        pageAnalysisService.analyzeCurrentPage(projectId, (progress) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send(PAGE_ANALYSIS_CHANNELS.progress, progress);
          }
        }),
    );
    ipcMain.handle(PAGE_ANALYSIS_CHANNELS.list, (_event, projectId: string) =>
      pageAnalysisService.listAnalyzedPages(projectId),
    );
    ipcMain.handle(TEST_CHANNELS.list, (_event, projectId: string) =>
      testsService.list(projectId),
    );
    ipcMain.handle(
      TEST_CHANNELS.get,
      (_event, projectId: string, testId: string) =>
        testsService.get(projectId, testId),
    );
    ipcMain.handle(
      TEST_CHANNELS.create,
      (_event, projectId: string, input: TestInput) =>
        testsService.create(projectId, input),
    );
    ipcMain.handle(
      TEST_CHANNELS.update,
      (_event, projectId: string, testId: string, input: TestInput) =>
        testsService.update(projectId, testId, input),
    );
    ipcMain.handle(
      TEST_CHANNELS.saveFlow,
      (_event, projectId: string, testId: string, flowItems: TestFlowItem[]) =>
        testsService.saveFlow(projectId, testId, flowItems),
    );
    ipcMain.handle(
      TEST_CHANNELS.listVersions,
      (_event, projectId: string, testId: string) =>
        testsService.listVersions(projectId, testId),
    );
    ipcMain.handle(
      TEST_CHANNELS.delete,
      (_event, projectId: string, testId: string) =>
        testsService.delete(projectId, testId),
    );
    ipcMain.handle(RUNNER_CHANNELS.start, (_event, input: StartRunInput) =>
      testRunnerService.start(input),
    );
    ipcMain.handle(RUNNER_CHANNELS.stop, (_event, runId: string) =>
      testRunnerService.stop(runId),
    );
    ipcMain.handle(RUNNER_CHANNELS.retry, (_event, runId: string) =>
      testRunnerService.retry(runId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.getStatus,
      (_event, projectId: string, testId: string) =>
        testRunnerService.getStatus(projectId, testId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.listRuns,
      (_event, projectId: string, testId: string) =>
        testRunnerService.listRuns(projectId, testId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.listStepResults,
      (_event, projectId: string, testId: string, runId: string) =>
        testRunnerService.listStepResults(projectId, testId, runId),
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
  browserManager.clearBasicAuthCredentials();
  void browserManager.close();
  applicationDatabase?.close();
  applicationDatabase = null;
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});
