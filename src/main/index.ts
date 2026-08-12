import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_INFO_CHANNEL,
  AI_CHANNELS,
  BROWSER_CHANNELS,
  DATASET_CHANNELS,
  MYSQL_CHANNELS,
  IMAP_CHANNELS,
  PAGE_ANALYSIS_CHANNELS,
  PROJECT_CHANNELS,
  RECORDER_CHANNELS,
  RUN_HISTORY_CHANNELS,
  RUNNER_CHANNELS,
  TEST_CHANNELS,
  TRANSFER_CHANNELS,
} from "../shared/ipc.js";
import type {
  AiStepEditInput,
  AiRunPlanInput,
  ApplyAiStepChangesInput,
  AiProviderId,
  CreateAiRequestPreviewInput,
  SaveAiSettingsInput,
  UndoAiStepChangeInput,
} from "../shared/ai.js";
import type {
  MySqlCleanupRowSelection,
  MySqlConnectionInput,
  TableIdentityConfig,
} from "../shared/mysql.js";
import type {
  BasicAuthCredentials,
  BrowserLaunchOptions,
  SaveProjectBasicAuthInput,
} from "../shared/browser-manager.js";
import type { BrowserConfig } from "../shared/persistence.js";
import type {
  CreateDatasetInput,
  PreviewDatasetValueInput,
  SaveDatasetInput,
} from "../shared/datasets.js";
import type { TestFlowItem } from "../shared/test-model.js";
import type { ManualWipeResource, StartRunInput } from "../shared/runner.js";
import type { RecorderStepDraft } from "../shared/recorder.js";
import type { ProjectInput } from "../shared/projects.js";
import type { TestInput } from "../shared/tests.js";
import type { TestPostRunChecks } from "../shared/post-run-checks.js";
import type { SaveImapAccountInput } from "../shared/imap.js";
import type {
  RunHistoryFilters,
  RunHistoryPurgeTarget,
} from "../shared/run-history.js";
import { createAppInfo } from "./app-info.js";
import { PlaywrightBrowserManager } from "./browser/playwright-browser-manager.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  ApplicationAiSettingsRepository,
  DatasetRepository,
  PageRepository,
  ProjectMySqlSettingsRepository,
  MySqlRunDataRepository,
  ImapAccountRepository,
  ProjectBasicAuthRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { PageAnalysisService } from "./page-analysis/page-analysis-service.js";
import { ProjectsService } from "./projects-service.js";
import { DatasetsService } from "./datasets-service.js";
import { TestsService } from "./tests-service.js";
import { RunHistoryService } from "./run-history-service.js";
import { TestRunnerService } from "./runner/test-runner-service.js";
import { RecorderService } from "./recorder/recorder-service.js";
import { ProjectBasicAuthService } from "./project-basic-auth-service.js";
import { AiSettingsService } from "./ai/ai-settings-service.js";
import { AiStepEditingService } from "./ai/ai-step-editing-service.js";
import { AiRunPlanningService } from "./ai/ai-run-planning-service.js";
import { PostRunAiEvaluationService } from "./ai/post-run-ai-evaluation-service.js";
import { resolveRendererTarget } from "./renderer-target.js";
import { createMainWindowOptions } from "./window-options.js";
import { ImportExportService } from "./import-export-service.js";
import { createMySqlGateway } from "./mysql/mysql-gateway.js";
import { MySqlService } from "./mysql/mysql-service.js";
import { MySqlSnapshotService } from "./mysql/mysql-snapshot-service.js";
import { ImapService } from "./imap-service.js";

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
    const projectBasicAuthRepository = new ProjectBasicAuthRepository(
      applicationDatabase.connection,
    );
    const applicationAiSettingsRepository = new ApplicationAiSettingsRepository(
      applicationDatabase.connection,
    );
    const projectMySqlSettingsRepository = new ProjectMySqlSettingsRepository(
      applicationDatabase.connection,
    );
    const imapAccountRepository = new ImapAccountRepository(
      applicationDatabase.connection,
    );
    const pageRepository = new PageRepository(applicationDatabase.connection);
    const testRepository = new TestRepository(applicationDatabase.connection);
    const datasetRepository = new DatasetRepository(
      applicationDatabase.connection,
    );
    const runRepository = new RunRepository(applicationDatabase.connection);
    const mySqlRunDataRepository = new MySqlRunDataRepository(
      applicationDatabase.connection,
    );
    const projectsService = new ProjectsService(projectRepository, {
      createId: randomUUID,
      now: () => new Date(),
    });
    const secretProtector = {
      encrypt: (value: string): string => {
        if (!safeStorage.isEncryptionAvailable()) {
          throw new Error(
            "Criptarea sistemului nu este disponibilă; secretul nu a fost salvat.",
          );
        }
        return safeStorage.encryptString(value).toString("base64");
      },
      decrypt: (value: string): string =>
        safeStorage.decryptString(Buffer.from(value, "base64")),
    };
    const projectBasicAuthService = new ProjectBasicAuthService(
      projectRepository,
      projectBasicAuthRepository,
      {
        now: () => new Date(),
        secrets: secretProtector,
      },
    );
    const aiSettingsService = new AiSettingsService(
      applicationAiSettingsRepository,
      {
        now: () => new Date(),
        secrets: secretProtector,
        fetch: (input, init) => fetch(input, init),
      },
    );
    const mySqlService = new MySqlService(
      projectRepository,
      projectMySqlSettingsRepository,
      createMySqlGateway(),
      {
        now: () => new Date(),
        secrets: secretProtector,
      },
    );
    const mySqlSnapshotService = new MySqlSnapshotService(
      mySqlService,
      mySqlRunDataRepository,
      runRepository,
      {
        createId: randomUUID,
        now: () => new Date(),
      },
    );
    const imapService = new ImapService(imapAccountRepository, {
      createId: randomUUID,
      secrets: secretProtector,
    });
    browserManager.setBasicAuthResolver((projectId, origin) =>
      projectBasicAuthService.resolve(projectId, origin),
    );
    const artifactRoot = join(app.getPath("userData"), "data", "artifacts");
    const pageAnalysisService = new PageAnalysisService(
      projectRepository,
      pageRepository,
      testRepository,
      browserManager,
      {
        artifactRoot,
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
    const aiStepEditingService = new AiStepEditingService(
      aiSettingsService,
      testsService,
      pageAnalysisService,
    );
    const aiRunPlanningService = new AiRunPlanningService(
      aiSettingsService,
      testsService,
      pageAnalysisService,
    );
    const postRunAiEvaluationService = new PostRunAiEvaluationService(
      aiSettingsService,
      () => new Date(),
    );
    const datasetsService = new DatasetsService(
      projectRepository,
      testRepository,
      datasetRepository,
      {
        createId: randomUUID,
        now: () => new Date(),
        random: Math.random,
      },
    );
    const importExportService = new ImportExportService(
      projectRepository,
      testRepository,
      datasetRepository,
      pageRepository,
      testsService,
      {
        artifactRoot,
        createId: randomUUID,
        now: () => new Date(),
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
        mysql: mySqlSnapshotService,
        imap: imapService,
        postRunAi: postRunAiEvaluationService,
      },
    );
    const runHistoryService = new RunHistoryService(
      projectRepository,
      testRepository,
      datasetRepository,
      runRepository,
      mySqlRunDataRepository,
    );
    const recorderService = new RecorderService(
      projectRepository,
      testRepository,
      datasetRepository,
      testsService,
      browserManager,
      pageAnalysisService,
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
    recorderService.onStatusChange((snapshot) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(RECORDER_CHANNELS.statusChanged, snapshot);
      }
    });

    ipcMain.handle(APP_INFO_CHANNEL, () =>
      createAppInfo(app.getVersion(), process.versions.electron),
    );
    ipcMain.handle(AI_CHANNELS.getSettings, () => aiSettingsService.get());
    ipcMain.handle(
      AI_CHANNELS.saveSettings,
      (_event, input: SaveAiSettingsInput) => aiSettingsService.save(input),
    );
    ipcMain.handle(
      AI_CHANNELS.listModels,
      (_event, provider: Exclude<AiProviderId, "none">, refresh?: boolean) =>
        aiSettingsService.listModels(provider, refresh === true),
    );
    ipcMain.handle(
      AI_CHANNELS.testConnection,
      (_event, provider: Exclude<AiProviderId, "none">) =>
        aiSettingsService.testConnection(provider),
    );
    ipcMain.handle(
      AI_CHANNELS.previewRequest,
      (_event, input: CreateAiRequestPreviewInput) =>
        aiSettingsService.preview(input),
    );
    ipcMain.handle(
      AI_CHANNELS.previewStepEdit,
      (_event, input: AiStepEditInput) => aiStepEditingService.preview(input),
    );
    ipcMain.handle(
      AI_CHANNELS.generateStepEdit,
      (_event, input: AiStepEditInput) => aiStepEditingService.generate(input),
    );
    ipcMain.handle(
      AI_CHANNELS.previewRunPlan,
      (_event, input: AiRunPlanInput) => aiRunPlanningService.preview(input),
    );
    ipcMain.handle(
      AI_CHANNELS.generateRunPlan,
      (_event, input: AiRunPlanInput) => aiRunPlanningService.generate(input),
    );
    ipcMain.handle(
      AI_CHANNELS.applyStepChanges,
      (_event, input: ApplyAiStepChangesInput) =>
        aiStepEditingService.apply(input),
    );
    ipcMain.handle(
      AI_CHANNELS.undoStepChange,
      (_event, input: UndoAiStepChangeInput) =>
        aiStepEditingService.undo(input),
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
    ipcMain.handle(PROJECT_CHANNELS.getBasicAuth, (_event, projectId: string) =>
      projectBasicAuthService.get(projectId),
    );
    ipcMain.handle(
      PROJECT_CHANNELS.saveBasicAuth,
      async (_event, projectId: string, input: SaveProjectBasicAuthInput) => {
        const settings = projectBasicAuthService.save(projectId, input);
        const credentials = projectBasicAuthService.resolve(
          projectId,
          settings.origin,
        );
        if (credentials !== undefined) {
          await browserManager.clearBasicAuthCredentialsForProject(projectId);
          browserManager.setBasicAuthCredentials(
            projectId,
            settings.origin,
            credentials,
          );
        }
        return settings;
      },
    );
    ipcMain.handle(
      PROJECT_CHANNELS.deleteBasicAuth,
      async (_event, projectId: string) => {
        const deleted = projectBasicAuthService.delete(projectId);
        await browserManager.clearBasicAuthCredentialsForProject(projectId);
        return deleted;
      },
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
      async (_event, credentials: BasicAuthCredentials) => {
        const challenge = browserManager.getStatus().basicAuthChallenge;
        const result = await browserManager.submitBasicAuth(credentials);
        if (result.state === "opened" && challenge !== undefined) {
          projectBasicAuthService.save(challenge.projectId, credentials);
        }
        return result;
      },
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
      TEST_CHANNELS.savePostRunChecks,
      (_event, projectId: string, testId: string, checks: TestPostRunChecks) =>
        testsService.savePostRunChecks(projectId, testId, checks),
    );
    ipcMain.handle(
      TEST_CHANNELS.listVersions,
      (_event, projectId: string, testId: string) =>
        testsService.listVersions(projectId, testId),
    );
    ipcMain.handle(
      TEST_CHANNELS.revalidate,
      (_event, projectId: string, testId: string) =>
        testsService.revalidate(projectId, testId),
    );
    ipcMain.handle(
      TEST_CHANNELS.delete,
      (_event, projectId: string, testId: string) =>
        testsService.delete(projectId, testId),
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.previewImport,
      async (_event, projectId: string) => {
        const selection = await dialog.showOpenDialog({
          title: "Importă un test JSON",
          properties: ["openFile"],
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        const filePath = selection.filePaths[0];
        return selection.canceled || filePath === undefined
          ? undefined
          : importExportService.previewImport(projectId, filePath);
      },
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.confirmImport,
      (_event, projectId: string, previewId: string) =>
        importExportService.confirmImport(projectId, previewId),
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.exportTest,
      async (_event, projectId: string, testId: string) => {
        const test = testsService.get(projectId, testId);
        const selection = await dialog.showSaveDialog({
          title: "Exportă testul JSON",
          defaultPath: `${test.name}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return selection.canceled || selection.filePath === undefined
          ? undefined
          : importExportService.exportTest(
              projectId,
              testId,
              selection.filePath,
            );
      },
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.exportDataset,
      async (_event, projectId: string, testId: string, datasetId: string) => {
        const dataset = datasetsService
          .list(projectId, testId)
          .find((candidate) => candidate.id === datasetId);
        if (dataset === undefined) throw new Error("Dataset-ul nu mai există.");
        const selection = await dialog.showSaveDialog({
          title: "Exportă dataset-ul JSON",
          defaultPath: `${dataset.name}.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return selection.canceled || selection.filePath === undefined
          ? undefined
          : importExportService.exportDataset(
              projectId,
              testId,
              datasetId,
              selection.filePath,
            );
      },
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.exportAllDatasets,
      async (_event, projectId: string, testId: string) => {
        const test = testsService.get(projectId, testId);
        const selection = await dialog.showSaveDialog({
          title: "Exportă toate dataset-urile",
          defaultPath: `${test.name}-datasets.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return selection.canceled || selection.filePath === undefined
          ? undefined
          : importExportService.exportAllDatasets(
              projectId,
              testId,
              selection.filePath,
            );
      },
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.exportPageAnalysis,
      async (_event, projectId: string, pageId: string) => {
        const page = (
          await pageAnalysisService.listAnalyzedPages(projectId)
        ).find((candidate) => candidate.page.id === pageId);
        if (page === undefined) throw new Error("Pagina nu mai există.");
        const selection = await dialog.showSaveDialog({
          title: "Exportă analiza paginii",
          defaultPath: `${page.page.name}-analysis.json`,
          filters: [{ name: "JSON", extensions: ["json"] }],
        });
        return selection.canceled || selection.filePath === undefined
          ? undefined
          : importExportService.exportPageAnalysis(
              projectId,
              pageId,
              selection.filePath,
            );
      },
    );
    ipcMain.handle(
      TRANSFER_CHANNELS.exportAnalysisBundle,
      async (_event, projectId: string) => {
        const selection = await dialog.showOpenDialog({
          title: "Alege directorul pentru analysis bundle",
          properties: ["openDirectory", "createDirectory"],
        });
        const directory = selection.filePaths[0];
        return selection.canceled || directory === undefined
          ? undefined
          : importExportService.exportAnalysisBundle(projectId, directory);
      },
    );
    ipcMain.handle(MYSQL_CHANNELS.getSettings, (_event, projectId: string) =>
      mySqlService.get(projectId),
    );
    ipcMain.handle(
      MYSQL_CHANNELS.saveSettings,
      (_event, projectId: string, input: MySqlConnectionInput) =>
        mySqlService.save(projectId, input),
    );
    ipcMain.handle(
      MYSQL_CHANNELS.testConnection,
      (_event, projectId: string, input: MySqlConnectionInput) =>
        mySqlService.testConnection(projectId, input),
    );
    ipcMain.handle(
      MYSQL_CHANNELS.loadSchema,
      (_event, projectId: string, input: MySqlConnectionInput | undefined) =>
        mySqlService.loadSchema(projectId, input),
    );
    ipcMain.handle(
      MYSQL_CHANNELS.saveIdentityConfig,
      (_event, projectId: string, identities: TableIdentityConfig[]) =>
        mySqlService.saveIdentityConfig(projectId, identities),
    );
    ipcMain.handle(IMAP_CHANNELS.listAccounts, () => imapService.list());
    ipcMain.handle(
      IMAP_CHANNELS.saveAccount,
      (_event, input: SaveImapAccountInput) => imapService.save(input),
    );
    ipcMain.handle(IMAP_CHANNELS.deleteAccount, (_event, accountId: string) =>
      imapService.delete(accountId),
    );
    ipcMain.handle(
      IMAP_CHANNELS.testConnection,
      (_event, input: SaveImapAccountInput) => imapService.test(input),
    );
    ipcMain.handle(IMAP_CHANNELS.listMailboxes, (_event, accountId: string) =>
      imapService.listMailboxes(accountId),
    );
    ipcMain.handle(
      IMAP_CHANNELS.pollDiagnostic,
      (_event, input: SaveImapAccountInput, receivedAfter: string) =>
        imapService.pollDiagnostic(input, receivedAfter),
    );
    ipcMain.handle(
      DATASET_CHANNELS.list,
      (_event, projectId: string, testId: string) =>
        datasetsService.list(projectId, testId),
    );
    ipcMain.handle(
      DATASET_CHANNELS.create,
      (_event, projectId: string, testId: string, input: CreateDatasetInput) =>
        datasetsService.create(projectId, testId, input),
    );
    ipcMain.handle(
      DATASET_CHANNELS.duplicate,
      (_event, projectId: string, testId: string, datasetId: string) =>
        datasetsService.duplicate(projectId, testId, datasetId),
    );
    ipcMain.handle(
      DATASET_CHANNELS.save,
      (
        _event,
        projectId: string,
        testId: string,
        datasetId: string,
        input: SaveDatasetInput,
      ) => datasetsService.save(projectId, testId, datasetId, input),
    );
    ipcMain.handle(
      DATASET_CHANNELS.delete,
      (_event, projectId: string, testId: string, datasetId: string) =>
        datasetsService.delete(projectId, testId, datasetId),
    );
    ipcMain.handle(
      DATASET_CHANNELS.previewValue,
      (
        _event,
        projectId: string,
        testId: string,
        input: PreviewDatasetValueInput,
      ) => datasetsService.preview(projectId, testId, input),
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
    ipcMain.handle(RUNNER_CHANNELS.skipStep, (_event, runId: string) =>
      testRunnerService.skipCurrentStep(runId),
    );
    ipcMain.handle(RUNNER_CHANNELS.continue, (_event, runId: string) =>
      testRunnerService.continueExecution(runId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.configureShortcut,
      (_event, projectId: string, shortcut: string) =>
        testRunnerService.configureContinueShortcut(projectId, shortcut),
    );
    ipcMain.handle(RUNNER_CHANNELS.runFallback, (_event, runId: string) =>
      testRunnerService.runCurrentFallback(runId),
    );
    ipcMain.handle(RUNNER_CHANNELS.skipFallback, (_event, runId: string) =>
      testRunnerService.skipCurrentFallback(runId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.previewMySqlCleanup,
      (
        _event,
        runId: string,
        diffId: string,
        rows: MySqlCleanupRowSelection[],
      ) => testRunnerService.previewMySqlCleanup(runId, diffId, rows),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.confirmMySqlCleanup,
      (_event, runId: string, previewId: string) =>
        testRunnerService.confirmMySqlCleanup(runId, previewId),
    );
    ipcMain.handle(RUNNER_CHANNELS.pollImapCheck, (_event, runId: string) =>
      testRunnerService.pollImapCheck(runId),
    );
    ipcMain.handle(RUNNER_CHANNELS.abandonImapCheck, (_event, runId: string) =>
      testRunnerService.abandonImapCheck(runId),
    );
    ipcMain.handle(
      RUNNER_CHANNELS.manualWipe,
      (_event, runId: string, resources: ManualWipeResource[]) =>
        testRunnerService.manualWipe(runId, resources),
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
    ipcMain.handle(
      RUN_HISTORY_CHANNELS.list,
      (_event, projectId: string, filters: RunHistoryFilters | undefined) =>
        runHistoryService.list(projectId, filters),
    );
    ipcMain.handle(
      RUN_HISTORY_CHANNELS.details,
      (_event, projectId: string, runId: string) =>
        runHistoryService.details(projectId, runId),
    );
    ipcMain.handle(
      RUN_HISTORY_CHANNELS.deleteSelected,
      (_event, projectId: string, runIds: string[]) =>
        runHistoryService.delete(projectId, runIds),
    );
    ipcMain.handle(
      RUN_HISTORY_CHANNELS.deleteAll,
      (_event, projectId: string) => runHistoryService.deleteAll(projectId),
    );
    ipcMain.handle(RUN_HISTORY_CHANNELS.storage, (_event, projectId: string) =>
      runHistoryService.storage(projectId),
    );
    ipcMain.handle(
      RUN_HISTORY_CHANNELS.purge,
      (_event, projectId: string, target: RunHistoryPurgeTarget) =>
        runHistoryService.purge(projectId, target),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.start,
      (_event, projectId: string, testId: string) =>
        recorderService.start(projectId, testId),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.stop,
      (_event, projectId: string, testId: string) =>
        recorderService.stop(projectId, testId),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.addStep,
      (_event, projectId: string, testId: string, draft: RecorderStepDraft) =>
        recorderService.addStep(projectId, testId, draft),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.discardStep,
      (_event, projectId: string, testId: string) =>
        recorderService.discardStep(projectId, testId),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.retry,
      (_event, projectId: string, testId: string) =>
        recorderService.retry(projectId, testId),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.ignoreError,
      (_event, projectId: string, testId: string) =>
        recorderService.ignoreError(projectId, testId),
    );
    ipcMain.handle(
      RECORDER_CHANNELS.getStatus,
      (_event, projectId: string, testId: string) =>
        recorderService.getStatus(projectId, testId),
    );

    aiSettingsService.preloadModels();
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
