// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
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
  listProjects: vi.fn(),
  createProject: vi.fn(),
  updateProject: vi.fn(),
  updateBrowserConfig: vi.fn(),
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
  getCurrentPageAnalysisTarget: vi.fn(),
  analyzeCurrentPage: vi.fn(),
  listAnalyzedPages: vi.fn().mockResolvedValue([]),
  onPageAnalysisProgress: vi.fn().mockReturnValue(vi.fn()),
  listTests: vi.fn().mockResolvedValue([]),
  getTest: vi.fn(),
  createTest: vi.fn().mockResolvedValue(testDefinition),
  updateTest: vi.fn().mockResolvedValue(testDefinition),
  saveTestFlow: vi.fn().mockResolvedValue(testDefinition),
  listTestVersions: vi.fn().mockResolvedValue([]),
  deleteTest: vi.fn(),
  startRun: vi.fn(),
  stopRun: vi.fn(),
  retryRunStep: vi.fn(),
  continueRun: vi.fn(),
  configureRunnerShortcut: vi.fn(),
  runCurrentFallback: vi.fn(),
  skipCurrentFallback: vi.fn(),
  getRunnerStatus: vi.fn().mockResolvedValue({
    state: "idle",
    currentStepIndex: -1,
    totalSteps: 0,
    canStop: false,
    canRetry: false,
  }),
  listTestRuns: vi.fn().mockResolvedValue([]),
  listRunStepResults: vi.fn().mockResolvedValue([]),
  onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ProjectTestsPanel", () => {
  it("creates a test with its own start URL and opens its detail page", async () => {
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
    expect(
      screen.getByRole<HTMLInputElement>("textbox", {
        name: "URL de start",
      }).value,
    ).toBe(project.normalizedBaseUrl);

    await user.type(screen.getByLabelText("Numele testului"), "Cumpără produs");
    const startUrl = screen.getByLabelText("URL de start");
    await user.clear(startUrl);
    await user.type(startUrl, "https://example.test/products?category=10#list");
    await user.click(screen.getByRole("button", { name: "Creează testul" }));

    await waitFor(() => {
      expect(api.createTest).toHaveBeenCalledWith(project.id, {
        name: "Cumpără produs",
        startUrl: "https://example.test/products?category=10#list",
      });
    });
    expect(onOpenTest).toHaveBeenCalledWith(testDefinition);
  });
});

describe("TestDetailPage", () => {
  it("shows recording-first action, start URL and live-analysis semaphore", () => {
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
      screen.getByRole("button", { name: "Înregistrează testul" }),
    ).not.toBeNull();
    expect(screen.getByText(testDefinition.normalizedStartUrl)).not.toBeNull();
    expect(screen.getByText("Semafor analiză înregistrare")).not.toBeNull();
    expect(screen.getByText("Gata pentru interacțiune")).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Rulează testul" })).toBeNull();
  });

  it("shows run only when the test workflow is ready", () => {
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

    expect(
      screen.getByRole("button", { name: "Rulează testul" }),
    ).not.toBeNull();
  });

  it("edits the test start URL from the detail page", async () => {
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

    await user.click(screen.getByRole("button", { name: "Editează testul" }));
    const startUrl = screen.getByRole("textbox", { name: "URL de start" });
    await user.clear(startUrl);
    await user.type(startUrl, "https://example.test/cart?coupon=10#summary");
    await user.click(screen.getByRole("button", { name: "Salvează testul" }));

    await waitFor(() => {
      expect(api.updateTest).toHaveBeenCalledWith(
        project.id,
        testDefinition.id,
        {
          name: testDefinition.name,
          description: testDefinition.description,
          startUrl: "https://example.test/cart?coupon=10#summary",
        },
      );
    });
    expect(onTestUpdated).toHaveBeenCalledWith(testDefinition);
  });
});
