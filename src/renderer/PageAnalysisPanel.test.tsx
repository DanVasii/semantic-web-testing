// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
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
    getAiSettings: vi.fn(),
    saveAiSettings: vi.fn(),
    testAiConnection: vi.fn(),
    previewAiRequest: vi.fn(),
    previewAiStepEdit: vi.fn(),
    generateAiStepEdit: vi.fn(),
    applyAiStepChanges: vi.fn(),
    undoAiStepChange: vi.fn(),
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
    listTestVersions: vi.fn().mockResolvedValue([]),
    deleteTest: vi.fn(),
    listDatasets: vi.fn().mockResolvedValue([]),
    createDataset: vi.fn(),
    duplicateDataset: vi.fn(),
    saveDataset: vi.fn(),
    deleteDataset: vi.fn(),
    previewDatasetValue: vi.fn(),
    startRun: vi.fn(),
    stopRun: vi.fn(),
    retryRunStep: vi.fn(),
    continueRun: vi.fn(),
    configureRunnerShortcut: vi.fn(),
    runCurrentFallback: vi.fn(),
    skipCurrentFallback: vi.fn(),
    getRunnerStatus: vi.fn(),
    listTestRuns: vi.fn().mockResolvedValue([]),
    listRunStepResults: vi.fn().mockResolvedValue([]),
    onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
    startRecorder: vi.fn(),
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
