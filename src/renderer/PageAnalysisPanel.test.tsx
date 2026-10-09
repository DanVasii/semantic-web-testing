// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { AnalyzedForm } from "../shared/form-analysis.js";
import type {
  PageAnalysisProgress,
  PageAnalysisResult,
} from "../shared/page-analysis.js";
import type { Project } from "../shared/persistence.js";
import { PageAnalysisPanel } from "./PageAnalysisPanel.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test/products?preview=1",
  normalizedBaseUrl: "https://example.test/products",
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

const result: PageAnalysisResult = {
  projectId: project.id,
  page: {
    id: "page-1",
    projectId: project.id,
    name: "Produse",
    url: "https://example.test/products?preview=1",
    normalizedUrl: "https://example.test/products",
    createdAt: "2026-07-24T12:00:00.000Z",
    updatedAt: "2026-07-24T12:00:00.000Z",
  },
  version: {
    id: "version-1",
    pageId: "page-1",
    versionNumber: 1,
    createdAt: "2026-07-24T12:00:00.000Z",
    normalizedUrl: "https://example.test/products",
    domFilePath: "projects/project-1/pages/page-1/v1/dom.html",
    cssFilePath: "projects/project-1/pages/page-1/v1/styles.css",
    accessibilityFilePath:
      "projects/project-1/pages/page-1/v1/accessibility.json",
    analysisFilePath: "projects/project-1/pages/page-1/v1/analysis.json",
    semanticHash: "hash",
  },
  title: "Produse",
  url: "https://example.test/products?preview=1",
  normalizedUrl: "https://example.test/products",
  capturedAt: "2026-07-24T12:00:00.000Z",
  counts: {
    visibleTexts: 7,
    interactiveElements: 6,
    forms: 1,
    inputs: 2,
    buttons: 2,
    links: 1,
    selectableElements: 2,
    inlineStyles: 1,
    styleTags: 1,
    externalStylesheets: 1,
  },
  inaccessibleStylesheets: [],
  artifactDirectory: "projects/project-1/pages/page-1/v1",
};

const createApi = (): {
  api: SemanticAppApi;
  emitProgress: (progress: PageAnalysisProgress) => void;
} => {
  let progressListener: ((progress: PageAnalysisProgress) => void) | undefined;
  const api: SemanticAppApi = {
    getAppInfo: vi.fn(),
    getAiSettings: vi.fn().mockResolvedValue({
      provider: "ollama",
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "default-model" },
      lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
      gemini: { model: "", apiKeyConfigured: false },
    }),
    saveAiSettings: vi.fn(),
    getAiModelPricing: vi.fn(),
    saveAiModelPricing: vi.fn(),
    testAiConnection: vi.fn(),
    listAiModels: vi.fn().mockResolvedValue([
      { id: "default-model", displayName: "Default model" },
      { id: "form-model", displayName: "Form model" },
    ]),
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
    getBrowserStatus: vi.fn(),
    onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
    getCurrentPageAnalysisTarget: vi.fn().mockResolvedValue({
      projectId: project.id,
      tabId: "tab-1",
      url: result.url,
      normalizedUrl: result.normalizedUrl,
      title: result.title,
      isAnalyzed: false,
    }),
    analyzeCurrentPage: vi.fn().mockResolvedValue(result),
    listAnalyzedPages: vi.fn().mockResolvedValue([]),
    onPageAnalysisProgress: (listener) => {
      progressListener = listener;
      return vi.fn();
    },
    listTests: vi.fn().mockResolvedValue([]),
    getTest: vi.fn(),
    createTest: vi.fn(),
    updateTest: vi.fn(),
    saveTestFlow: vi.fn(),
    saveTestPostRunChecks: vi.fn(),
    listTestVersions: vi.fn().mockResolvedValue([]),
    revalidateTest: vi.fn(),
    deleteTest: vi.fn(),
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
    getRunnerStatus: vi.fn(),
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
    getRecorderStatus: vi.fn(),
    onRecorderStatusChange: vi.fn().mockReturnValue(vi.fn()),
  };
  return {
    api,
    emitProgress: (progress) => {
      progressListener?.(progress);
    },
  };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("PageAnalysisPanel", () => {
  it("opens detected forms and calls AI only after Generate tests", async () => {
    const user = userEvent.setup();
    const { api } = createApi();
    const analyzedForm: AnalyzedForm = {
      id: "form-contact",
      pageId: result.page.id,
      pageVersionId: result.version.id,
      pageTitle: result.title,
      pageUrl: result.url,
      title: "Contact",
      method: "post",
      action: "https://example.test/contact",
      locator: { type: "css", operator: "equals", value: "#contact" },
      fields: [
        {
          id: "field-email",
          name: "email",
          label: "Adresă e-mail",
          tag: "input",
          inputType: "email",
          semanticType: "email",
          required: true,
          disabled: false,
          locator: { type: "css", operator: "equals", value: "#email" },
          options: [],
        },
      ],
      submit: {
        label: "Trimite",
        locator: { type: "css", operator: "equals", value: "#submit" },
      },
    };
    vi.mocked(api.listAnalyzedPages).mockResolvedValue([
      {
        page: result.page,
        latestVersion: result.version,
        title: result.title,
        counts: result.counts,
        inaccessibleStylesheets: [],
      },
    ]);
    api.listAnalyzedPageForms = vi.fn().mockResolvedValue([analyzedForm]);
    api.getProjectFormSettings = vi.fn().mockResolvedValue({
      projectId: project.id,
      defaults: {},
      defaultImapAccountId: "imap-1",
    });
    vi.mocked(api.listImapAccounts).mockResolvedValue([
      {
        id: "imap-1",
        name: "QA",
        host: "imap.example.test",
        port: 993,
        secure: true,
        username: "qa@example.test",
        mailbox: "INBOX",
        passwordConfigured: true,
      },
    ]);
    api.generateFormTests = vi.fn().mockResolvedValue({
      provider: "ollama",
      model: "test-model",
      pageId: result.page.id,
      formId: analyzedForm.id,
      summary: "Scenarii pentru contact",
      scenarios: [
        {
          id: "valid",
          name: "Contact valid",
          description: "Trimite formularul valid.",
          kind: "valid",
          values: [],
          omittedFieldIds: [],
          invalidFieldIds: [],
          expectedMessages: ["Mulțumim"],
          expectEmail: true,
        },
      ],
      usage: { inputTokens: 100, outputTokens: 40, totalTokens: 140 },
    });
    api.createGeneratedFormTests = vi.fn().mockResolvedValue({ tests: [] });
    vi.mocked(api.getAiSettings).mockResolvedValue({
      provider: "ollama",
      ollama: { baseUrl: "http://127.0.0.1:11434", model: "default-model" },
      lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
      gemini: { model: "gemini-default", apiKeyConfigured: true },
      openai: { model: "", apiKeyConfigured: false },
    });
    vi.mocked(api.listAiModels).mockImplementation((provider) =>
      Promise.resolve(
        provider === "gemini"
          ? [
              { id: "gemini-default", displayName: "Gemini default" },
              { id: "gemini-form", displayName: "Gemini form" },
            ]
          : [
              { id: "default-model", displayName: "Default model" },
              { id: "form-model", displayName: "Form model" },
            ],
      ),
    );

    render(
      <PageAnalysisPanel
        api={api}
        browserStatus={{ state: "running", projectId: project.id }}
        project={project}
        onAnalysisCompleted={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "View forms (1)" }),
    );
    expect(await screen.findByText("Adresă e-mail")).not.toBeNull();
    expect(api.generateFormTests).not.toHaveBeenCalled();
    await user.selectOptions(screen.getByLabelText("Provider AI"), "gemini");
    await waitFor(() =>
      expect(api.listAiModels).toHaveBeenCalledWith("gemini"),
    );
    await user.selectOptions(
      screen.getByLabelText(/Model AI pentru formulare/u),
      "gemini-form",
    );
    await user.click(screen.getByRole("button", { name: "Generează teste" }));
    expect(await screen.findByText("Preview teste propuse")).not.toBeNull();
    expect(api.generateFormTests).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        formId: analyzedForm.id,
        imapAccountId: "imap-1",
        provider: "gemini",
        model: "gemini-form",
      }),
    );
  });

  it("analyzes the detected page and displays progress and result counts", async () => {
    const user = userEvent.setup();
    const { api, emitProgress } = createApi();
    const onAnalysisCompleted = vi.fn();
    let resolveAnalysis: ((value: PageAnalysisResult) => void) | undefined;
    vi.mocked(api.analyzeCurrentPage).mockReturnValue(
      new Promise((resolve) => {
        resolveAnalysis = resolve;
      }),
    );
    render(
      <PageAnalysisPanel
        api={api}
        browserStatus={{
          state: "running",
          projectId: project.id,
          browser: "chromium",
        }}
        project={project}
        onAnalysisCompleted={onAnalysisCompleted}
      />,
    );

    expect(await screen.findByText(result.url)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Analizează pagina" }));
    act(() => {
      emitProgress({
        projectId: project.id,
        stage: "capturing_styles",
        completedSteps: 5,
        totalSteps: 9,
        message: "Se capturează stilurile paginii.",
      });
    });

    await waitFor(() => {
      expect(api.analyzeCurrentPage).toHaveBeenCalledWith(project.id);
    });
    expect(
      screen
        .getByRole("progressbar", { name: "Progres analiză" })
        .getAttribute("aria-valuenow"),
    ).toBe("56");
    act(() => {
      resolveAnalysis?.(result);
    });
    expect(
      await screen.findByText("Analiză salvată · versiunea 1"),
    ).not.toBeNull();
    expect(screen.getByText("Interactive").previousSibling?.textContent).toBe(
      "6",
    );
    expect(
      screen.getByText(
        "dom.html · styles.css · accessibility.json · analysis.json · semantic-analysis.json",
      ),
    ).not.toBeNull();
    expect(onAnalysisCompleted).toHaveBeenCalledOnce();
  });

  it("shows reanalysis for an already versioned current page", async () => {
    const { api } = createApi();
    vi.mocked(api.getCurrentPageAnalysisTarget).mockResolvedValue({
      projectId: project.id,
      tabId: "tab-1",
      url: result.url,
      normalizedUrl: result.normalizedUrl,
      title: result.title,
      isAnalyzed: true,
      pageId: result.page.id,
      latestVersionNumber: 3,
    });

    render(
      <PageAnalysisPanel
        api={api}
        browserStatus={{ state: "running", projectId: project.id }}
        project={project}
        onAnalysisCompleted={vi.fn()}
      />,
    );

    expect(
      await screen.findByRole("button", { name: "Reanalizează pagina" }),
    ).not.toBeNull();
    expect(screen.getByText("Analizată anterior · versiunea 3")).not.toBeNull();
  });

  it("requires the project browser before analysis", () => {
    const { api } = createApi();
    render(
      <PageAnalysisPanel
        api={api}
        browserStatus={{ state: "idle" }}
        project={project}
        onAnalysisCompleted={vi.fn()}
      />,
    );

    const button = screen.getByRole("button", {
      name: "Analizează pagina",
    });
    expect((button as HTMLButtonElement).disabled).toBe(true);
    expect(
      screen.getByText(
        "Pornește browserul proiectului pentru a analiza pagina curentă.",
      ),
    ).not.toBeNull();
    expect(api.getCurrentPageAnalysisTarget).not.toHaveBeenCalled();
  });
});
