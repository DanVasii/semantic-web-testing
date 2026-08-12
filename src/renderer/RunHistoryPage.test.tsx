// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestRun } from "../shared/persistence.js";
import type { RunHistoryEntry } from "../shared/run-history.js";
import { RunHistoryPage } from "./RunHistoryPage.js";

const project: Project = {
  id: "project-1",
  name: "Fixture",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-27T10:00:00.000Z",
  updatedAt: "2026-07-27T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};
const run: TestRun = {
  id: "run-1",
  projectId: project.id,
  testId: "test-1",
  testVersion: 2,
  startedAt: "2026-07-27T10:00:00.000Z",
  endedAt: "2026-07-27T10:00:02.000Z",
  status: "failed",
  browserType: "chromium",
  pageVersionIds: ["page-version-1"],
};
const entry: RunHistoryEntry = {
  run,
  testName: "Checkout",
  datasetName: "Client",
  durationMs: 2000,
  stepCount: 1,
  failedStepCount: 1,
  fallbackStepCount: 1,
};

const createApi = (): SemanticAppApi =>
  ({
    listTests: vi.fn().mockResolvedValue([
      {
        id: "test-1",
        name: "Checkout",
      },
    ]),
    listProjectRunHistory: vi.fn().mockResolvedValue([entry]),
    getRunStorageUsage: vi.fn().mockResolvedValue({
      runCount: 1,
      metadataBytes: 100,
      logsBytes: 40,
      snapshotsBytes: 60,
      totalBytes: 200,
    }),
    getRunHistoryDetails: vi.fn().mockResolvedValue({
      entry,
      steps: [
        {
          id: "result-1",
          runId: run.id,
          stepId: "submit",
          status: "failed",
          fallbackIndex: 0,
          logs: [{ message: "Locator lipsă" }],
        },
      ],
      dataset: {
        id: "dataset-1",
        name: "Client",
        values: { email: "ana@example.test" },
      },
      mysqlDiffs: [],
      imapResults: [],
      error: { code: "locator_not_found" },
    }),
    deleteRunHistory: vi.fn().mockResolvedValue({
      affected: 1,
      storage: {
        runCount: 0,
        metadataBytes: 0,
        logsBytes: 0,
        snapshotsBytes: 0,
        totalBytes: 0,
      },
    }),
    deleteAllRunHistory: vi.fn(),
    purgeRunHistoryData: vi.fn(),
  }) as unknown as SemanticAppApi;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RunHistoryPage", () => {
  it("lists runs, opens full details and deletes selected runs with confirmation", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<RunHistoryPage api={api} project={project} onBack={vi.fn()} />);

    expect((await screen.findAllByText("Checkout")).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Failed").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Detalii" }));
    expect(await screen.findByText("Pași și fallback-uri")).not.toBeNull();
    expect(screen.getByText(/locator_not_found/)).not.toBeNull();
    await user.keyboard("{Escape}");

    await user.click(
      screen.getByRole("checkbox", { name: `Selectează rularea ${run.id}` }),
    );
    await user.click(screen.getByRole("button", { name: "Șterge selectate" }));
    expect(screen.getByText(/Ștergi definitiv 1 rulări/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Confirmă" }));

    await waitFor(() => {
      expect(api.deleteRunHistory).toHaveBeenCalledWith(project.id, [run.id]);
    });
  });

  it("sends test and status filters to the history API", async () => {
    const api = createApi();
    const user = userEvent.setup();
    render(<RunHistoryPage api={api} project={project} onBack={vi.fn()} />);
    await screen.findAllByText("Checkout");

    await user.selectOptions(screen.getByLabelText("Filtru status"), "failed");

    await waitFor(() => {
      expect(api.listProjectRunHistory).toHaveBeenLastCalledWith(project.id, {
        statuses: ["failed"],
      });
    });
  });
});
