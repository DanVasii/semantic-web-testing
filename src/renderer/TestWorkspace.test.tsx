// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import {
  MANUAL_WIPE_RESOURCES,
  type RunnerSnapshot,
  type StartRunInput,
} from "../shared/runner.js";
import { ProjectTestsPanel, TestDetailPage } from "./TestWorkspace.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

const testDefinition: TestDefinition = {
  id: "test-1",
  projectId: project.id,
  name: "Cumpără produs",
  description: "Produse până la checkout",
  status: "draft",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/products?category=10#list",
  normalizedStartUrl: "https://example.test/products?category=10#list",
  workflowState: "not_recorded",
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
  flowItems: [],
};

const createApi = (): SemanticAppApi => ({
  getAppInfo: vi.fn(),
  getAiSettings: vi.fn(),
  saveAiSettings: vi.fn(),
  getAiModelPricing: vi.fn(),
  saveAiModelPricing: vi.fn(),
  testAiConnection: vi.fn(),
  listAiModels: vi.fn(),
  previewAiRequest: vi.fn(),
  generateAiRequest: vi.fn(),
  previewAiRunPlan: vi.fn(),
  generateAiRunPlan: vi.fn(),
  previewAiStepEdit: vi.fn(),
  generateAiStepEdit: vi.fn(),
  applyAiStepChanges: vi.fn(),
  undoAiStepChange: vi.fn(),
  previewAiSimilarTest: vi.fn(),
  generateAiSimilarTest: vi.fn(),
  createAiSimilarTest: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateBrowserConfig: vi.fn(),
  getProjectBasicAuth: vi.fn(),
  saveProjectBasicAuth: vi.fn(),
  deleteProjectBasicAuth: vi.fn(),
  deleteProject: vi.fn(),
  detectBrowsers: vi.fn(),
  launchBrowser: vi.fn(),
  openProjectUrl: vi.fn(),
  submitBasicAuth: vi.fn(),
  cancelBasicAuth: vi.fn(),
  closeBrowser: vi.fn(),
  closeProjectTabs: vi.fn(),
  recoverBrowserConnection: vi.fn(),
  selectBrowserProfilePath: vi.fn(),
  getBrowserStatus: vi.fn().mockResolvedValue({ state: "idle" }),
  onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
  getCurrentPageAnalysisTarget: vi.fn(),
  analyzeCurrentPage: vi.fn(),
  listAnalyzedPages: vi.fn().mockResolvedValue([]),
  onPageAnalysisProgress: vi.fn().mockReturnValue(vi.fn()),
  listTests: vi.fn().mockResolvedValue([]),
  getTest: vi.fn(),
  createTest: vi.fn().mockResolvedValue(testDefinition),
  updateTest: vi.fn().mockResolvedValue(testDefinition),
  saveTestFlow: vi.fn().mockResolvedValue(testDefinition),
  saveTestStages: vi.fn().mockResolvedValue(testDefinition),
  saveTestPostRunChecks: vi.fn().mockResolvedValue(testDefinition),
  listTestVersions: vi.fn().mockResolvedValue([]),
  revalidateTest: vi.fn().mockResolvedValue(testDefinition),
  deleteTest: vi.fn().mockResolvedValue(true),
  previewTestImport: vi.fn(),
  confirmTestImport: vi.fn(),
  exportTestJson: vi.fn(),
  exportDatasetJson: vi.fn(),
  exportAllDatasetsJson: vi.fn(),
  exportPageAnalysisJson: vi.fn(),
  exportAnalysisBundle: vi.fn(),
  getMySqlSettings: vi.fn(),
  saveMySqlSettings: vi.fn(),
  testMySqlConnection: vi.fn(),
  loadMySqlSchema: vi.fn(),
  saveMySqlIdentityConfig: vi.fn(),
  listImapAccounts: vi.fn().mockResolvedValue([]),
  listImapMailboxes: vi.fn().mockResolvedValue([]),
  saveImapAccount: vi.fn(),
  deleteImapAccount: vi.fn(),
  testImapConnection: vi.fn(),
  pollImapDiagnostic: vi.fn(),
  listDatasets: vi.fn().mockResolvedValue([]),
  createDataset: vi.fn(),
  duplicateDataset: vi.fn(),
  saveDataset: vi.fn(),
  deleteDataset: vi.fn(),
  previewDatasetValue: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  retryRunStep: vi.fn(),
  skipRunStep: vi.fn(),
  continueRun: vi.fn(),
  configureRunnerShortcut: vi.fn(),
  runCurrentFallback: vi.fn(),
  skipCurrentFallback: vi.fn(),
  previewMySqlCleanup: vi.fn(),
  confirmMySqlCleanup: vi.fn(),
  pollImapCheck: vi.fn(),
  abandonImapCheck: vi.fn(),
  manualWipeRunData: vi.fn(),
  getRunnerStatus: vi.fn().mockResolvedValue({
    state: "idle",
    currentStepIndex: -1,
    totalSteps: 0,
    canStop: false,
    canRetry: false,
  }),
  listTestRuns: vi.fn().mockResolvedValue([]),
  listRunStepResults: vi.fn().mockResolvedValue([]),
  listProjectRunHistory: vi.fn().mockResolvedValue([]),
  getRunHistoryDetails: vi.fn(),
  deleteRunHistory: vi.fn(),
  deleteAllRunHistory: vi.fn(),
  getRunStorageUsage: vi.fn().mockResolvedValue({
    runCount: 0,
    metadataBytes: 0,
    logsBytes: 0,
    snapshotsBytes: 0,
    totalBytes: 0,
  }),
  purgeRunHistoryData: vi.fn(),
  onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
  startRecorder: vi.fn(),
  continueRecorder: vi.fn(),
  stopRecorder: vi.fn(),
  addRecorderStep: vi.fn(),
  discardRecorderStep: vi.fn(),
  retryRecorderAnalysis: vi.fn(),
  ignoreRecorderAnalysisError: vi.fn(),
  getRecorderStatus: vi.fn().mockResolvedValue({
    projectId: project.id,
    testId: testDefinition.id,
    state: "idle",
    signal: "green",
    message: "Recorderul este oprit.",
    test: testDefinition,
    capturedSteps: 0,
    queuedEvents: 0,
    canStart: true,
    canStop: false,
    canRetry: false,
    canIgnore: false,
  }),
  onRecorderStatusChange: vi.fn().mockReturnValue(vi.fn()),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectTestsPanel", () => {
  it("creates a test with the project URL internally and opens its detail page", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onOpenTest = vi.fn();
    render(
      <ProjectTestsPanel
        api={api}
        project={project}
        onOpenTest={onOpenTest}
        onTestsChanged={vi.fn()}
      />,
    );

    expect(
      await screen.findByText("Proiectul nu are încă teste"),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Test nou" }));
    expect(screen.queryByLabelText("URL de start")).toBeNull();

    await user.type(screen.getByLabelText("Numele testului"), "Cumpără produs");
    expect(
      screen.queryByRole("checkbox", { name: /Wipe înainte de test/ }),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Creează testul" }));

    await waitFor(() => {
      expect(api.createTest).toHaveBeenCalledWith(project.id, {
        name: "Cumpără produs",
        startUrl: project.normalizedBaseUrl,
        testMode: "recorded",
        wipeBeforeRun: false,
      });
    });
    expect(onOpenTest).toHaveBeenCalledWith(testDefinition);
  });

  it("opens AI generation from a recorded test and labels generated variants", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const source = {
      ...testDefinition,
      status: "valid" as const,
      workflowState: "ready" as const,
      flowItems: [
        {
          id: "submit",
          type: "action" as const,
          actionType: "click" as const,
          title: "Submit",
          humanDescription: "Trimite formularul.",
          whyExplanation: "Finalizează formularul.",
          target: {
            primary: {
              type: "css" as const,
              operator: "equals" as const,
              value: "#submit",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
      aiGeneration: {
        sourceTestId: "original",
        instruction: "Variantă invalidă",
        provider: "gemini",
        model: "gemini-test",
        generatedAt: "2026-08-29T12:00:00.000Z",
      },
    };
    vi.mocked(api.listTests).mockResolvedValue([source]);
    vi.mocked(api.getAiSettings).mockResolvedValue({
      provider: "none",
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
      lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
      gemini: { model: "", apiKeyConfigured: false },
      openai: { model: "", apiKeyConfigured: false },
    });

    render(
      <ProjectTestsPanel
        api={api}
        project={project}
        onOpenTest={vi.fn()}
        onTestsChanged={vi.fn()}
      />,
    );

    expect(await screen.findByText("AI generated test")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Generează similar cu AI" }),
    );
    expect(
      await screen.findByRole("dialog", {
        name: `Generează similar cu AI · ${source.name}`,
      }),
    ).not.toBeNull();
  });

  it("selects and deletes multiple project tests after one confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onTestsChanged = vi.fn();
    const tests = [
      { ...testDefinition, id: "test-1", name: "Primul test" },
      { ...testDefinition, id: "test-2", name: "Al doilea test" },
      { ...testDefinition, id: "test-3", name: "Test păstrat" },
    ];
    vi.mocked(api.listTests).mockResolvedValue(tests);

    render(
      <ProjectTestsPanel
        api={api}
        project={project}
        onOpenTest={vi.fn()}
        onTestsChanged={onTestsChanged}
      />,
    );

    await user.click(
      await screen.findByRole("checkbox", {
        name: "Selectează testul Primul test",
      }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: "Selectează testul Al doilea test",
      }),
    );
    await user.click(
      screen.getByRole("button", { name: "Șterge selectate (2)" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Ștergi testele selectate?" }),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Șterge 2 teste" }));

    await waitFor(() => expect(api.deleteTest).toHaveBeenCalledTimes(2));
    expect(api.deleteTest).toHaveBeenNthCalledWith(1, project.id, "test-1");
    expect(api.deleteTest).toHaveBeenNthCalledWith(2, project.id, "test-2");
    await waitFor(() => expect(screen.queryByText("Primul test")).toBeNull());
    expect(screen.queryByText("Al doilea test")).toBeNull();
    expect(screen.getByText("Test păstrat")).not.toBeNull();
    expect(onTestsChanged).toHaveBeenCalledOnce();
  });

  it("runs every ready test sequentially and only offers cleanup at the end", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const tests = [
      {
        ...testDefinition,
        id: "test-1",
        name: "Primul test",
        status: "valid" as const,
        workflowState: "ready" as const,
      },
      {
        ...testDefinition,
        id: "test-2",
        name: "Al doilea test",
        status: "valid" as const,
        workflowState: "ready" as const,
      },
    ];
    let runnerListener: ((snapshot: RunnerSnapshot) => void) | undefined;
    const runningSnapshot = (input: StartRunInput): RunnerSnapshot => ({
      state: "running",
      run: {
        id: `run-${input.testId}`,
        projectId: project.id,
        testId: input.testId,
        testVersion: 1,
        startedAt: "2026-08-31T10:00:00.000Z",
        status: "running",
        browserType: "chromium",
        pageVersionIds: [],
        datasetSnapshot: { values: {} },
      },
      currentStepIndex: 0,
      totalSteps: 1,
      canStop: true,
      canRetry: false,
    });
    vi.mocked(api.listTests).mockResolvedValue(tests);
    vi.mocked(api.listDatasets).mockResolvedValue([]);
    vi.mocked(api.getAiSettings).mockResolvedValue({
      provider: "none",
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
      lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
      gemini: { model: "", apiKeyConfigured: false },
      openai: { model: "", apiKeyConfigured: false },
    });
    vi.mocked(api.getBrowserStatus).mockResolvedValue({
      state: "running",
      projectId: project.id,
    });
    vi.mocked(api.onRunnerStatusChange).mockImplementation((listener) => {
      runnerListener = listener;
      return vi.fn();
    });
    vi.mocked(api.startRun).mockImplementation((input) =>
      Promise.resolve(runningSnapshot(input)),
    );
    vi.mocked(api.retryRunStep).mockImplementation((runId) =>
      Promise.resolve(
        runningSnapshot({
          projectId: project.id,
          testId: runId.replace("run-", ""),
        }),
      ),
    );

    render(
      <ProjectTestsPanel
        api={api}
        project={project}
        onOpenTest={vi.fn()}
        onTestsChanged={vi.fn()}
      />,
    );

    await screen.findByText("Primul test");
    await user.click(
      screen.getByRole("button", { name: "Rulează toate testele" }),
    );
    await user.click(
      await screen.findByRole("checkbox", {
        name: /Clear session înainte de fiecare test/,
      }),
    );
    await user.selectOptions(
      screen.getByLabelText("Retry-uri automate pentru un pas eșuat"),
      "1",
    );
    await user.click(
      await screen.findByRole("button", { name: "Pornește 2 teste" }),
    );

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(1));
    expect(vi.mocked(api.startRun).mock.calls[0]?.[0].testId).toBe("test-1");
    expect(vi.mocked(api.startRun).mock.calls[0]?.[0]).toMatchObject({
      clearSessionBeforeRun: true,
    });
    expect(api.manualWipeRunData).not.toHaveBeenCalled();
    expect(api.previewMySqlCleanup).not.toHaveBeenCalled();

    const firstRunning = runningSnapshot({
      projectId: project.id,
      testId: "test-1",
    });
    act(() => {
      runnerListener?.({
        ...firstRunning,
        state: "paused_on_error",
        canStop: true,
        canRetry: true,
        error: { code: "step_failed", message: "Eroare temporară" },
      });
    });
    await waitFor(() =>
      expect(api.retryRunStep).toHaveBeenCalledWith("run-test-1"),
    );
    act(() => {
      runnerListener?.({
        ...firstRunning,
        state: "completed",
        run: { ...firstRunning.run!, status: "passed" },
        canStop: false,
      });
    });

    await waitFor(() => expect(api.startRun).toHaveBeenCalledTimes(2));
    expect(vi.mocked(api.startRun).mock.calls[1]?.[0].testId).toBe("test-2");
    expect(vi.mocked(api.startRun).mock.calls[1]?.[0]).toMatchObject({
      clearSessionBeforeRun: true,
    });
    expect(api.manualWipeRunData).not.toHaveBeenCalled();

    const secondRunning = runningSnapshot({
      projectId: project.id,
      testId: "test-2",
    });
    const secondCompleted: RunnerSnapshot = {
      ...secondRunning,
      state: "completed",
      run: { ...secondRunning.run!, status: "passed" },
      mysql: {
        diffs: [
          {
            id: "diff-1",
            runId: "run-test-2",
            checkStepId: "mysql-check",
            baselineSnapshotId: "baseline-1",
            currentSnapshotId: "current-1",
            createdAt: "2026-08-31T10:01:00.000Z",
            tables: [
              {
                tableName: "orders",
                columns: ["id"],
                identityColumns: ["id"],
                inserted: [{ identity: { id: 10 }, row: { id: 10 } }],
                deleted: [],
                updated: [],
                duplicateIdentities: [],
              },
            ],
          },
        ],
        cleanupLogs: [],
      },
      canStop: false,
    };
    act(() => {
      runnerListener?.(secondCompleted);
    });

    expect(
      await screen.findByRole("button", { name: "Păstrează toate datele" }),
    ).not.toBeNull();
    expect(screen.getByText("Flaky")).not.toBeNull();
    expect(screen.getByRole("button", { name: "Wipe complet" })).not.toBeNull();
    expect(api.manualWipeRunData).not.toHaveBeenCalled();
    expect(api.previewMySqlCleanup).not.toHaveBeenCalled();

    vi.mocked(api.previewMySqlCleanup).mockResolvedValue({
      ...secondCompleted,
      mysql: {
        ...secondCompleted.mysql!,
        cleanupPreview: {
          id: "preview-1",
          runId: "run-test-2",
          diffId: "diff-1",
          createdAt: "2026-08-31T10:02:00.000Z",
          rows: [],
        },
      },
    });
    vi.mocked(api.confirmMySqlCleanup).mockResolvedValue(secondCompleted);
    vi.mocked(api.manualWipeRunData).mockResolvedValue({
      ...secondCompleted,
      cleanup: {
        origin: "https://example.test",
        status: "completed",
        entries: [],
      },
    });

    await user.click(screen.getByRole("button", { name: "Wipe complet" }));
    await waitFor(() => {
      expect(api.previewMySqlCleanup).toHaveBeenCalledWith(
        "run-test-2",
        "diff-1",
        [{ tableName: "orders", identity: { id: 10 } }],
      );
      expect(api.confirmMySqlCleanup).toHaveBeenCalledWith(
        "run-test-2",
        "preview-1",
      );
      expect(api.manualWipeRunData).toHaveBeenCalledWith("run-test-2", [
        ...MANUAL_WIPE_RESOURCES,
      ]);
    });
    expect(
      await screen.findByText(
        "Wipe-ul complet al datelor browserului a fost finalizat.",
      ),
    ).not.toBeNull();
  });
});

describe("TestDetailPage", () => {
  it("shows checks as a separate workspace section with AI instructions", async () => {
    const user = userEvent.setup();
    render(
      <TestDetailPage
        api={createApi()}
        project={project}
        test={testDefinition}
        onTestUpdated={vi.fn()}
        onBackToProject={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Checks" }));

    expect(screen.getByRole("heading", { name: "Checks" })).not.toBeNull();
    expect(
      screen.getByLabelText("Instrucțiuni pentru AI la checks"),
    ).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Salvează checks" }),
    ).not.toBeNull();
  });

  it("shows the recorder in the Flow tab without a separate start URL", async () => {
    const api = createApi();
    render(
      <TestDetailPage
        api={api}
        project={project}
        test={testDefinition}
        onTestUpdated={vi.fn()}
        onBackToProject={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Înregistrează flow-ul" }),
    ).not.toBeNull();
    expect(screen.queryByText("URL de start")).toBeNull();
    expect(screen.getByText("Semafor analiză înregistrare")).not.toBeNull();
    expect(screen.getByText("Gata pentru interacțiune")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Rulează testul" })).toBeNull();
  });

  it("shows run only when the test workflow is ready", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <TestDetailPage
        api={api}
        project={project}
        test={{
          ...testDefinition,
          status: "valid",
          workflowState: "ready",
        }}
        onTestUpdated={vi.fn()}
        onBackToProject={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Rulare" }));
    expect(
      screen.getByRole("button", { name: "Rulează testul" }),
    ).not.toBeNull();
  });

  it("edits test metadata while preserving the internal start URL", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onTestUpdated = vi.fn();
    render(
      <TestDetailPage
        api={api}
        project={project}
        test={testDefinition}
        onTestUpdated={onTestUpdated}
        onBackToProject={vi.fn()}
        onBackToProjects={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Acțiuni test" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Editează detaliile" }),
    );
    expect(
      screen.queryByRole("checkbox", { name: /Wipe înainte de test/ }),
    ).toBeNull();
    expect(screen.queryByRole("textbox", { name: "URL de start" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Salvează testul" }));

    await waitFor(() => {
      expect(api.updateTest).toHaveBeenCalledWith(
        project.id,
        testDefinition.id,
        {
          name: testDefinition.name,
          description: testDefinition.description,
          startUrl: testDefinition.normalizedStartUrl,
          testMode: "recorded",
          wipeBeforeRun: false,
        },
      );
    });
    expect(onTestUpdated).toHaveBeenCalledWith(testDefinition);
  });

  it("deletes a test after explicit confirmation", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onBackToProject = vi.fn();
    render(
      <TestDetailPage
        api={api}
        project={project}
        test={testDefinition}
        onTestUpdated={vi.fn()}
        onBackToProject={onBackToProject}
        onBackToProjects={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Acțiuni test" }));
    await user.click(screen.getByRole("menuitem", { name: "Șterge testul" }));
    expect(screen.getByText("Ștergi testul?")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Șterge definitiv" }));

    await waitFor(() => {
      expect(api.deleteTest).toHaveBeenCalledWith(
        project.id,
        testDefinition.id,
      );
      expect(onBackToProject).toHaveBeenCalledOnce();
    });
  });
});
