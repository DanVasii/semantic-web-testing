// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import { App } from "./App.js";

afterEach(cleanup);

describe("App", () => {
  it("renders the project workspace and application version", async () => {
    const user = userEvent.setup();
    const api: SemanticAppApi = {
      getAppInfo: vi.fn().mockResolvedValue({
        version: "0.1.0",
        electronVersion: "41.7.1",
      }),
      getAiSettings: vi.fn().mockResolvedValue({
        provider: "none",
        ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
        lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
        gemini: { model: "", apiKeyConfigured: false },
      }),
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
      listProjects: vi.fn().mockResolvedValue([]),
      createProject: vi.fn(),
      updateProject: vi.fn(),
      updateBrowserConfig: vi.fn(),
      getProjectBasicAuth: vi.fn(),
      saveProjectBasicAuth: vi.fn(),
      deleteProjectBasicAuth: vi.fn(),
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
      getRecorderStatus: vi.fn(),
      onRecorderStatusChange: vi.fn().mockReturnValue(vi.fn()),
    };
    window.semanticApp = api;

    render(<App />);

    expect(screen.getByText("Semantic Web Testing")).not.toBeNull();
    expect(await screen.findByText("Creează primul proiect")).not.toBeNull();
    expect(await screen.findByText("v0.1.0 · Electron 41.7.1")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Setări aplicație" }));
    expect(
      await screen.findByRole("dialog", { name: "Setări aplicație" }),
    ).not.toBeNull();
  });
});
