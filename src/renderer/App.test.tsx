// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import { App } from "./App.js";

afterEach(cleanup);

describe("App", () => {
  it("renders the project workspace and application version", async () => {
    const api: SemanticAppApi = {
      getAppInfo: vi.fn().mockResolvedValue({
        version: "0.1.0",
        electronVersion: "41.7.1",
      }),
      listProjects: vi.fn().mockResolvedValue([]),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      updateBrowserConfig: vi.fn(),
      deleteProject: vi.fn(),
      detectBrowsers: vi.fn().mockResolvedValue([]),
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
    };
    window.semanticApp = api;

    render(<App />);

    expect(screen.getByText("Semantic Web Testing")).not.toBeNull();
    expect(await screen.findByText("Creează primul proiect")).not.toBeNull();
    expect(await screen.findByText("v0.1.0 · Electron 41.7.1")).not.toBeNull();
  });
});
