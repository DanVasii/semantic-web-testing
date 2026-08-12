// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { PostRunModal } from "./PostRunModal.js";

const snapshot: RunnerSnapshot = {
  state: "waiting_for_imap_check",
  run: {
    id: "run-1",
    projectId: "project-1",
    testId: "test-1",
    testVersion: 1,
    startedAt: "2026-07-27T10:00:00.000Z",
    status: "running",
    browserType: "chromium",
    pageVersionIds: [],
  },
  currentStepIndex: 1,
  totalSteps: 1,
  message: "Se așteaptă e-mailul.",
  imap: {
    stepId: "imap-1",
    accountId: "account-1",
    status: "waiting",
    message: "Se așteaptă e-mailul.",
    startedAt: "2026-07-27T10:00:01.000Z",
  },
  canStop: true,
  canRetry: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PostRunModal IMAP polling", () => {
  it("polls immediately and continues every three seconds while the countdown changes", async () => {
    vi.useFakeTimers();
    const pollImapCheck = vi.fn().mockResolvedValue(snapshot);
    const api = { pollImapCheck } as unknown as SemanticAppApi;

    render(
      <PostRunModal
        api={api}
        open
        snapshot={snapshot}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(3);
  });
});
