// @vitest-environment jsdom

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { BrowserManagerStatus } from "../shared/browser-manager.js";
import type { ProjectOverview } from "../shared/projects.js";
import { ProjectDashboard } from "./ProjectDashboard.js";

const overview: ProjectOverview = {
  project: {
    id: "project-1",
    name: "Magazin demo",
    baseUrl: "https://example.test/shop?preview=1",
    normalizedBaseUrl: "https://example.test/shop",
    createdAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
    browserConfig: {
      browserType: "chromium",
      sessionMode: "temporary",
      headless: false,
    },
    aiConfig: {},
    shortcutConfig: {},
  },
  statistics: {
    pageCount: 4,
    testCount: 3,
    runCount: 12,
    lastRunAt: "2026-07-24T11:00:00.000Z",
  },
};

const createApi = (
  projects: ProjectOverview[] = [overview],
): SemanticAppApi => ({
  getAppInfo: vi.fn().mockResolvedValue({
    version: "0.1.0",
    electronVersion: "41.7.1",
  }),
  listProjects: vi.fn().mockResolvedValue(projects),
  createProject: vi.fn().mockResolvedValue(overview),
  updateProject: vi.fn().mockResolvedValue(overview),
  updateBrowserConfig: vi.fn().mockResolvedValue(overview),
  getProjectBasicAuth: vi.fn().mockResolvedValue({
    projectId: overview.project.id,
    origin: "https://example.test",
    username: "",
    configured: false,
  }),
  saveProjectBasicAuth: vi.fn(),
  deleteProjectBasicAuth: vi.fn(),
  deleteProject: vi.fn().mockResolvedValue(true),
  detectBrowsers: vi.fn().mockResolvedValue([]),
  launchBrowser: vi.fn(),
  openProjectUrl: vi.fn(),
  submitBasicAuth: vi.fn().mockResolvedValue({
    state: "opened",
    tab: {
      id: "tab-auth",
      projectId: overview.project.id,
      url: overview.project.normalizedBaseUrl,
    },
  }),
  cancelBasicAuth: vi.fn(),
  closeBrowser: vi.fn(),
  closeProjectTabs: vi.fn(),
  recoverBrowserConnection: vi.fn(),
  selectBrowserProfilePath: vi.fn(),
  getBrowserStatus: vi.fn().mockResolvedValue({ state: "idle" }),
  onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
  getCurrentPageAnalysisTarget: vi.fn().mockResolvedValue({
    projectId: overview.project.id,
    tabId: "tab-1",
    url: overview.project.normalizedBaseUrl,
    normalizedUrl: overview.project.normalizedBaseUrl,
    title: overview.project.name,
    isAnalyzed: false,
  }),
  analyzeCurrentPage: vi.fn(),
  listAnalyzedPages: vi.fn().mockResolvedValue([]),
  onPageAnalysisProgress: vi.fn().mockReturnValue(vi.fn()),
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
});

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectDashboard", () => {
  it("opens a project as a separate page and returns to the project list", async () => {
    const user = userEvent.setup();
    render(<ProjectDashboard api={createApi()} />);

    await screen.findByText("Magazin demo");
    await user.click(screen.getByRole("button", { name: "Deschide" }));

    expect(
      await screen.findByRole("heading", { name: "Testele proiectului" }),
    ).not.toBeNull();
    expect(screen.getByRole("button", { name: "← Proiecte" })).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "← Proiecte" }));

    expect(
      await screen.findByRole("heading", { name: "Proiecte" }),
    ).not.toBeNull();
    expect(screen.queryByText("Testele proiectului")).toBeNull();
  });

  it("restores the last opened project and displays its statistics", async () => {
    localStorage.setItem("semantic-app:last-project-id", overview.project.id);
    render(<ProjectDashboard api={createApi()} />);

    expect(await screen.findByText("Proiect deschis")).not.toBeNull();
    expect(
      screen.getByText("Pagini analizate").previousSibling?.textContent,
    ).toBe("4");
    expect(screen.getByText("Teste").previousSibling?.textContent).toBe("3");
    expect(screen.getByText("Rulări").previousSibling?.textContent).toBe("12");
    expect(
      screen.getByRole("link", { name: "https://example.test/shop" }),
    ).not.toBeNull();
  });

  it("displays live browser status and an external close notification", async () => {
    localStorage.setItem("semantic-app:last-project-id", overview.project.id);
    const api = createApi();
    let statusListener: ((status: BrowserManagerStatus) => void) | undefined;
    vi.mocked(api.onBrowserStatusChange).mockImplementation((listener) => {
      statusListener = listener;
      return vi.fn();
    });
    render(<ProjectDashboard api={api} />);
    await screen.findByText("Proiect deschis");

    act(() => {
      statusListener?.({
        state: "running",
        browser: "chrome",
        projectId: overview.project.id,
        sessionId: "session-1",
      });
    });
    expect(await screen.findByText("Pornit · chrome")).not.toBeNull();

    act(() => {
      statusListener?.({
        state: "closed",
        browser: "chrome",
        projectId: overview.project.id,
        sessionId: "session-1",
        message: "Browserul a fost închis din exterior.",
      });
    });
    expect(await screen.findByText("Închis")).not.toBeNull();
    expect(
      await screen.findByText("Browserul a fost închis din exterior."),
    ).not.toBeNull();
  });

  it("opens the Basic Auth dialog and submits credentials", async () => {
    const user = userEvent.setup();
    localStorage.setItem("semantic-app:last-project-id", overview.project.id);
    const api = createApi();
    let statusListener: ((status: BrowserManagerStatus) => void) | undefined;
    vi.mocked(api.onBrowserStatusChange).mockImplementation((listener) => {
      statusListener = listener;
      return vi.fn();
    });
    render(<ProjectDashboard api={api} />);
    await screen.findByText("Proiect deschis");

    act(() => {
      statusListener?.({
        state: "waiting_for_basic_auth",
        browser: "chrome",
        projectId: overview.project.id,
        sessionId: "session-1",
        message: "Site-ul solicită autentificare HTTP.",
        basicAuthChallenge: {
          projectId: overview.project.id,
          url: overview.project.normalizedBaseUrl,
          origin: "https://example.test",
          invalidCredentials: false,
        },
      });
    });

    const authDialog = await screen.findByRole("dialog", {
      name: "Autentificare HTTP necesară",
    });
    expect(screen.getByText("Așteaptă autentificarea")).not.toBeNull();
    await user.type(within(authDialog).getByLabelText("Username"), "tester");
    await user.type(within(authDialog).getByLabelText("Parolă"), "secret");
    await user.click(
      within(authDialog).getByRole("button", {
        name: "Autentifică și continuă",
      }),
    );

    await waitFor(() => {
      expect(api.submitBasicAuth).toHaveBeenCalledWith({
        username: "tester",
        password: "secret",
      });
    });
  });

  it("validates and creates a project with a normalized URL preview", async () => {
    const user = userEvent.setup();
    const api = createApi([]);
    const created: ProjectOverview = {
      ...overview,
      project: {
        ...overview.project,
        name: "Portal rezervări",
        baseUrl: "https://example.test/booking?service=10#calendar",
        normalizedBaseUrl: "https://example.test/booking",
      },
    };
    vi.mocked(api.createProject).mockResolvedValue(created);
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Creează primul proiect");
    await user.click(screen.getByRole("button", { name: "+ Proiect nou" }));
    await user.click(screen.getByRole("button", { name: "Creează proiectul" }));

    expect(
      screen.getByText("Numele proiectului este obligatoriu."),
    ).not.toBeNull();
    expect(
      screen.getByText("URL-ul proiectului este obligatoriu."),
    ).not.toBeNull();

    await user.type(
      screen.getByLabelText("Numele proiectului"),
      "Portal rezervări",
    );
    await user.type(
      screen.getByLabelText("URL-ul proiectului"),
      "https://example.test/booking?service=10#calendar",
    );

    expect(screen.getByText("https://example.test/booking")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Creează proiectul" }));

    await waitFor(() => {
      expect(api.createProject).toHaveBeenCalledWith({
        name: "Portal rezervări",
        baseUrl: "https://example.test/booking?service=10#calendar",
      });
    });
    expect(await screen.findByText("Proiect creat")).not.toBeNull();
    expect(localStorage.getItem("semantic-app:last-project-id")).toBe(
      "project-1",
    );
  });

  it("edits a project and refreshes the item in the list", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const updated: ProjectOverview = {
      ...overview,
      project: { ...overview.project, name: "Magazin actualizat" },
    };
    vi.mocked(api.updateProject).mockResolvedValue(updated);
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Magazin demo");
    await user.click(screen.getByRole("button", { name: "Editează" }));
    const nameInput = screen.getByLabelText("Numele proiectului");
    await user.clear(nameInput);
    await user.type(nameInput, "Magazin actualizat");
    await user.click(
      screen.getByRole("button", { name: "Salvează modificările" }),
    );

    await waitFor(() => {
      expect(api.updateProject).toHaveBeenCalledWith("project-1", {
        name: "Magazin actualizat",
        baseUrl: overview.project.baseUrl,
      });
    });
    expect(await screen.findByText("Proiect actualizat")).not.toBeNull();
  });

  it("requires confirmation before deleting a project", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<ProjectDashboard api={api} />);

    await screen.findByText("Magazin demo");
    await user.click(
      screen.getByRole("button", {
        name: "Șterge proiectul Magazin demo",
      }),
    );

    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(api.deleteProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Șterge proiectul" }));

    await waitFor(() => {
      expect(api.deleteProject).toHaveBeenCalledWith("project-1");
    });
    expect(await screen.findByText("Creează primul proiect")).not.toBeNull();
  });
});
