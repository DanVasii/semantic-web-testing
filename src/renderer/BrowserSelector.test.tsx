// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project } from "../shared/persistence.js";
import type {
  BrowserManagerStatus,
  DetectedBrowser,
} from "../shared/browser-manager.js";
import { BrowserSelector } from "./BrowserSelector.js";

const project: Project = {
  id: "project-1",
  name: "Demo",
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

const detections: DetectedBrowser[] = [
  {
    installationId: "system:chrome",
    id: "chrome",
    displayName: "Google Chrome",
    engine: "chromium",
    source: "system",
    installed: true,
    supported: true,
    executablePath: "C:\\Browsers\\chrome.exe",
  },
  {
    installationId: "system:firefox",
    id: "firefox",
    displayName: "Mozilla Firefox",
    engine: "firefox",
    source: "system",
    installed: false,
    supported: false,
  },
  {
    installationId: "playwright:webkit",
    id: "webkit",
    displayName: "WebKit (Playwright)",
    engine: "webkit",
    source: "playwright",
    installed: true,
    supported: true,
    executablePath: "C:\\Playwright\\webkit.exe",
  },
];

const createApi = (): SemanticAppApi => ({
  getAppInfo: vi.fn(),
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateBrowserConfig: vi
    .fn()
    .mockImplementation(
      (_projectId: string, browserConfig: Project["browserConfig"]) =>
        Promise.resolve({
          project: { ...project, browserConfig },
          statistics: { pageCount: 0, testCount: 0, runCount: 0 },
        }),
    ),
  deleteProject: vi.fn(),
  detectBrowsers: vi.fn().mockResolvedValue(detections),
  launchBrowser: vi.fn().mockResolvedValue({
    id: "session-1",
    projectId: project.id,
    browser: "chrome",
    engine: "chromium",
    sessionMode: "temporary",
    startedAt: "2026-07-24T12:00:00.000Z",
  }),
  openProjectUrl: vi.fn().mockResolvedValue({
    state: "opened",
    tab: {
      id: "tab-1",
      projectId: project.id,
      url: project.normalizedBaseUrl,
    },
  }),
  submitBasicAuth: vi.fn(),
  cancelBasicAuth: vi.fn(),
  closeBrowser: vi.fn().mockResolvedValue(undefined),
  closeProjectTabs: vi.fn().mockResolvedValue(undefined),
  recoverBrowserConnection: vi.fn().mockResolvedValue({
    id: "session-2",
    projectId: project.id,
    browser: "chrome",
    engine: "chromium",
    sessionMode: "reusable",
    startedAt: "2026-07-24T12:05:00.000Z",
  }),
  selectBrowserProfilePath: vi.fn().mockResolvedValue("D:\\profiles\\semantic"),
  getBrowserStatus: vi.fn().mockResolvedValue({ state: "idle" }),
  onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
  getCurrentPageAnalysisTarget: vi.fn(),
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
  startRun: vi.fn(),
  stopRun: vi.fn(),
  retryRunStep: vi.fn(),
  runCurrentFallback: vi.fn(),
  skipCurrentFallback: vi.fn(),
  getRunnerStatus: vi.fn(),
  listTestRuns: vi.fn().mockResolvedValue([]),
  listRunStepResults: vi.fn().mockResolvedValue([]),
  onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
});

const idleStatus: BrowserManagerStatus = { state: "idle" };

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("BrowserSelector", () => {
  it("lists only installed and supported browsers", async () => {
    render(
      <BrowserSelector
        api={createApi()}
        browserStatus={idleStatus}
        onProjectUpdated={vi.fn()}
        project={project}
      />,
    );

    const select = await screen.findByLabelText("Browser disponibil");
    const optionLabels = Array.from(
      (select as HTMLSelectElement).options,
      ({ text }) => text,
    );

    expect(optionLabels).toEqual(["Google Chrome", "WebKit (Playwright)"]);
    expect(optionLabels).not.toContain("Mozilla Firefox");
  });

  it("launches the selected installation with its executable path", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <BrowserSelector
        api={api}
        browserStatus={idleStatus}
        onProjectUpdated={vi.fn()}
        project={project}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Browser disponibil"),
      "playwright:webkit",
    );
    await user.click(
      screen.getByRole("button", { name: "Pornește și deschide" }),
    );

    await waitFor(() => {
      expect(api.launchBrowser).toHaveBeenCalledWith({
        projectId: "project-1",
        browser: "webkit",
        source: "playwright",
        sessionMode: "temporary",
        executablePath: "C:\\Playwright\\webkit.exe",
      });
    });
    expect(api.openProjectUrl).toHaveBeenCalledWith(
      "project-1",
      "https://example.test/",
    );
    expect(
      await screen.findByText(
        "WebKit (Playwright) a fost pornit și URL-ul proiectului a fost deschis.",
      ),
    ).not.toBeNull();
    expect(localStorage.getItem("semantic-app:browser:project-1")).toBe(
      "playwright:webkit",
    );
  });

  it("opens another tab and closes an active browser", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const runningStatus: BrowserManagerStatus = {
      state: "running",
      browser: "chrome",
      projectId: project.id,
      sessionId: "session-1",
    };
    render(
      <BrowserSelector
        api={api}
        browserStatus={runningStatus}
        onProjectUpdated={vi.fn()}
        project={project}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Deschide URL-ul" }),
    );
    expect(api.openProjectUrl).toHaveBeenCalledWith(
      "project-1",
      "https://example.test/",
    );
    expect(
      await screen.findByText(
        "URL-ul proiectului a fost deschis într-un tab nou.",
      ),
    ).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Închide taburile" }));
    await waitFor(() => {
      expect(api.closeProjectTabs).toHaveBeenCalledWith("project-1");
    });

    await user.click(screen.getByRole("button", { name: "Închide browserul" }));
    await waitFor(() => {
      expect(api.closeBrowser).toHaveBeenCalledOnce();
    });
  });

  it("selects and persists a dedicated Chrome profile for CDP", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const onProjectUpdated = vi.fn();
    render(
      <BrowserSelector
        api={api}
        browserStatus={idleStatus}
        onProjectUpdated={onProjectUpdated}
        project={project}
      />,
    );

    await user.selectOptions(
      await screen.findByLabelText("Mod sesiune"),
      "external_chrome_debug",
    );
    await waitFor(() => {
      expect(api.updateBrowserConfig).toHaveBeenCalledWith(
        "project-1",
        expect.objectContaining({
          sessionMode: "external_chrome_debug",
          remoteDebuggingPort: 9222,
        }),
      );
    });
    await user.click(
      screen.getByRole("button", {
        name: "Alege directorul profilului",
      }),
    );

    await waitFor(() => {
      expect(api.selectBrowserProfilePath).toHaveBeenCalledOnce();
      expect(api.updateBrowserConfig).toHaveBeenLastCalledWith(
        "project-1",
        expect.objectContaining({
          sessionMode: "external_chrome_debug",
          profilePath: "D:\\profiles\\semantic",
          remoteDebuggingPort: 9222,
        }),
      );
    });
    expect(await screen.findByText("D:\\profiles\\semantic")).not.toBeNull();
    expect(onProjectUpdated).toHaveBeenCalled();
  });

  it("recovers a lost connection and reopens the project URL", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const lostStatus: BrowserManagerStatus = {
      state: "closed",
      browser: "chrome",
      projectId: project.id,
      sessionId: "session-1",
      message: "Conexiunea cu browserul a fost pierdută.",
      canReconnect: true,
    };
    render(
      <BrowserSelector
        api={api}
        browserStatus={lostStatus}
        onProjectUpdated={vi.fn()}
        project={project}
      />,
    );

    await user.click(
      await screen.findByRole("button", {
        name: "Recuperează conexiunea",
      }),
    );

    await waitFor(() => {
      expect(api.recoverBrowserConnection).toHaveBeenCalledOnce();
      expect(api.openProjectUrl).toHaveBeenCalledWith(
        "project-1",
        "https://example.test/",
      );
    });
  });
});
