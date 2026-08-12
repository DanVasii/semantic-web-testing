// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { MySqlRunPanel } from "./MySqlRunPanel.js";

afterEach(cleanup);

const snapshot: RunnerSnapshot = {
  state: "completed",
  run: {
    id: "run-1",
    projectId: "project-1",
    testId: "test-1",
    testVersion: 1,
    startedAt: "2026-07-26T10:00:00.000Z",
    endedAt: "2026-07-26T10:01:00.000Z",
    status: "passed",
    browserType: "chromium",
    pageVersionIds: [],
  },
  currentStepIndex: 1,
  totalSteps: 1,
  canStop: false,
  canRetry: false,
  mysql: {
    baselineSnapshotId: "baseline-1",
    diffs: [
      {
        id: "diff-1",
        runId: "run-1",
        checkStepId: "check-1",
        baselineSnapshotId: "baseline-1",
        currentSnapshotId: "current-1",
        createdAt: "2026-07-26T10:00:30.000Z",
        tables: [
          {
            tableName: "appointments",
            columns: ["id", "status"],
            identityColumns: ["id"],
            inserted: [
              {
                identity: { id: 7 },
                row: { id: 7, status: "created" },
              },
            ],
            deleted: [],
            updated: [
              {
                identity: { id: 5 },
                before: { id: 5, status: "created" },
                after: { id: 5, status: "confirmed" },
                changedColumns: ["status"],
              },
            ],
            duplicateIdentities: [],
          },
        ],
      },
    ],
    cleanupLogs: [],
  },
};

describe("MySqlRunPanel", () => {
  it("shows before/after and requires preview before cleanup confirmation", async () => {
    const user = userEvent.setup();
    const previewSnapshot: RunnerSnapshot = {
      ...snapshot,
      mysql: {
        baselineSnapshotId: "baseline-1",
        diffs: snapshot.mysql?.diffs ?? [],
        cleanupLogs: [],
        cleanupPreview: {
          id: "preview-1",
          runId: "run-1",
          diffId: "diff-1",
          createdAt: "2026-07-26T10:02:00.000Z",
          rows: [
            {
              tableName: "appointments",
              identity: { id: 7 },
              conditions: [{ column: "id", operator: "=", value: 7 }],
              sqlPreview: "DELETE FROM `appointments` WHERE `id` = ?",
            },
          ],
        },
      },
    };
    const previewMySqlCleanup = vi.fn().mockResolvedValue(previewSnapshot);
    const confirmMySqlCleanup = vi.fn().mockResolvedValue(snapshot);
    const api = {
      previewMySqlCleanup,
      confirmMySqlCleanup,
    } as unknown as SemanticAppApi;
    const onSnapshot = vi.fn();
    const { rerender } = render(
      <MySqlRunPanel api={api} snapshot={snapshot} onSnapshot={onSnapshot} />,
    );

    expect(screen.getAllByText("created").length).toBeGreaterThan(0);
    expect(screen.getByText("confirmed")).not.toBeNull();
    expect(
      screen.queryByRole("button", {
        name: /Confirmă ștergerea rândurilor inserate/i,
      }),
    ).toBeNull();

    await user.click(screen.getByRole("checkbox"));
    await user.click(
      screen.getByRole("button", {
        name: /Preview cleanup rânduri selectate/i,
      }),
    );
    expect(previewMySqlCleanup).toHaveBeenCalledWith("run-1", "diff-1", [
      { tableName: "appointments", identity: { id: 7 } },
    ]);

    rerender(
      <MySqlRunPanel
        api={api}
        snapshot={previewSnapshot}
        onSnapshot={onSnapshot}
      />,
    );
    await user.click(
      screen.getByRole("button", {
        name: /Confirmă ștergerea rândurilor inserate/i,
      }),
    );
    expect(confirmMySqlCleanup).toHaveBeenCalledWith("run-1", "preview-1");
  });
});
