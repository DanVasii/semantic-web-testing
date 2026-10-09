// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import type { BatchRun } from "../shared/test-suites.js";
import { TestSuitesPanel } from "./TestSuitesPanel.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

const test = (id: string, name: string): TestDefinition => ({
  id,
  projectId: project.id,
  name,
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: project.normalizedBaseUrl,
  normalizedStartUrl: project.normalizedBaseUrl,
  workflowState: "ready",
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T10:00:00.000Z",
  flowItems: [],
});

const tests = [test("test-1", "Autentificare"), test("test-2", "Checkout")];

const createApi = (batches: BatchRun[] = []) => {
  const saveTestSuite = vi.fn().mockResolvedValue(undefined);
  const api = {
    listTestSuites: vi.fn().mockResolvedValue([]),
    saveTestSuite,
    deleteTestSuite: vi.fn().mockResolvedValue(true),
    listBatchRuns: vi.fn().mockResolvedValue(batches),
    listFlakyTestStatistics: vi.fn().mockResolvedValue([]),
    listDatasets: vi.fn().mockResolvedValue([]),
  } as unknown as SemanticAppApi;
  return { api, saveTestSuite };
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TestSuitesPanel", () => {
  it("saves selected tests in the order chosen by the user", async () => {
    const user = userEvent.setup();
    const { api, saveTestSuite } = createApi();
    render(
      <TestSuitesPanel
        api={api}
        project={project}
        tests={tests}
        onRunSuite={vi.fn()}
        onRunFailed={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "+ Suită nouă" }),
    );
    await user.type(screen.getByLabelText("Nume"), "Smoke checkout");
    await user.click(screen.getByRole("checkbox", { name: /Autentificare/ }));
    await user.click(screen.getByRole("checkbox", { name: /Checkout/ }));
    await user.click(screen.getAllByRole("button", { name: "↓" })[0]!);
    await user.click(screen.getByRole("button", { name: "Salvează suita" }));

    await waitFor(() => {
      expect(saveTestSuite).toHaveBeenCalledWith(project.id, undefined, {
        name: "Smoke checkout",
        description: "",
        items: [{ testId: "test-2" }, { testId: "test-1" }],
        settings: {
          clearSessionBeforeEach: true,
          continueOnFailure: true,
          maxStepRetries: 1,
        },
      });
    });
  });

  it("can rerun only failed tests from persistent batch history", async () => {
    const failedBatch: BatchRun = {
      id: "batch-1",
      projectId: project.id,
      name: "Nightly",
      status: "failed",
      settings: {
        clearSessionBeforeEach: true,
        continueOnFailure: true,
        maxStepRetries: 1,
      },
      startedAt: "2026-08-31T11:00:00.000Z",
      endedAt: "2026-08-31T11:01:00.000Z",
      items: [
        {
          id: "item-1",
          batchRunId: "batch-1",
          testId: "test-2",
          testName: "Checkout",
          position: 0,
          status: "failed",
          retryCount: 1,
          error: "Butonul nu a fost găsit.",
        },
      ],
    };
    const user = userEvent.setup();
    const { api } = createApi([failedBatch]);
    const onRunFailed = vi.fn();
    render(
      <TestSuitesPanel
        api={api}
        project={project}
        tests={tests}
        onRunSuite={vi.fn()}
        onRunFailed={onRunFailed}
      />,
    );

    await user.click(await screen.findByText("Istoric Run all (1)"));
    await user.click(
      screen.getByRole("button", { name: "Rulează din nou testele eșuate" }),
    );
    expect(onRunFailed).toHaveBeenCalledWith([tests[1]]);
  });
});
