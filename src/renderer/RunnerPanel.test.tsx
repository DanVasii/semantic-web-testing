// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  Project,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { RunnerPanel } from "./RunnerPanel.js";

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

const test: TestDefinition = {
  id: "test-1",
  projectId: project.id,
  name: "Checkout",
  status: "valid",
  version: 2,
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/products",
  normalizedStartUrl: "https://example.test/products",
  workflowState: "ready",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  flowItems: [
    {
      id: "step-1",
      type: "action",
      actionType: "click",
      title: "Checkout",
      humanDescription: "Apasă checkout.",
      whyExplanation: "Continuă testul.",
      target: {
        primary: { type: "css", operator: "equals", value: "#checkout" },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const run: TestRun = {
  id: "run-1",
  projectId: test.projectId,
  testId: test.id,
  testVersion: test.version,
  startedAt: "2026-07-24T12:00:00.000Z",
  status: "running",
  browserType: "chromium",
  pageVersionIds: [],
};

const snapshot = (overrides: Partial<RunnerSnapshot> = {}): RunnerSnapshot => ({
  state: "running",
  run,
  currentStepIndex: 0,
  totalSteps: 1,
  currentStepId: "step-1",
  canStop: true,
  canRetry: false,
  ...overrides,
});

afterEach(cleanup);

describe("RunnerPanel", () => {
  it("starts, stops and retries the current step from live state updates", async () => {
    const user = userEvent.setup();
    let listener: ((next: RunnerSnapshot) => void) | undefined;
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn(
        (callback: (next: RunnerSnapshot) => void) => {
          listener = callback;
          return vi.fn();
        },
      ),
      startRun: vi.fn().mockResolvedValue(snapshot()),
      stopRun: vi.fn().mockResolvedValue(
        snapshot({
          state: "stopped",
          run: { ...run, status: "stopped" },
          canStop: false,
        }),
      ),
      retryRunStep: vi.fn().mockResolvedValue(snapshot()),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    expect(api.startRun).toHaveBeenCalledWith({
      projectId: test.projectId,
      testId: test.id,
      mode: "automatic",
      waitBeforeStart: false,
    });
    await user.click(
      await screen.findByRole("button", { name: "Oprește rularea" }),
    );
    expect(api.stopRun).toHaveBeenCalledWith(run.id);

    act(() => {
      listener?.(
        snapshot({
          state: "paused_on_error",
          run: { ...run, status: "failed" },
          error: {
            code: "locator_ambiguous",
            message: "Locator ambiguu.",
            count: 2,
          },
          canStop: false,
          canRetry: true,
        }),
      );
    });
    expect(screen.getByText("Locator ambiguu. (2 rezultate)")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Reîncearcă pasul curent" }),
    );
    expect(api.retryRunStep).toHaveBeenCalledWith(run.id);
  });

  it("shows persisted run history and step logs", async () => {
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(
        snapshot({
          state: "completed",
          run: { ...run, status: "passed" },
          currentStepIndex: 1,
          canStop: false,
        }),
      ),
      listTestRuns: vi.fn().mockResolvedValue([{ ...run, status: "passed" }]),
      listRunStepResults: vi.fn().mockResolvedValue([
        {
          id: "result-1",
          runId: run.id,
          stepId: "step-1",
          status: "passed",
          logs: [{ level: "info", message: "Click executat." }],
        },
      ]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await waitFor(() => {
      expect(screen.getByText(/v2 · passed/)).not.toBeNull();
    });
    expect(screen.getByText("Rezultate și logs (1)")).not.toBeNull();
  });

  it("shows the current fallback and supports Run and Skip decisions", async () => {
    const user = userEvent.setup();
    const fallbackSnapshot = snapshot({
      state: "waiting_for_fallback_decision",
      error: {
        code: "locator_not_found",
        message: "Locatorul principal nu a găsit elementul.",
        count: 0,
      },
      fallback: {
        index: 0,
        total: 2,
        humanDescription: "Buton alternativ",
        whyExplanation: "Selector semantic secundar.",
        locator: {
          type: "css",
          operator: "equals",
          value: "#fallback",
        },
      },
      canStop: true,
    });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(fallbackSnapshot),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      runCurrentFallback: vi.fn().mockResolvedValue(fallbackSnapshot),
      skipCurrentFallback: vi.fn().mockResolvedValue(
        snapshot({
          ...fallbackSnapshot,
          fallback: {
            ...fallbackSnapshot.fallback!,
            index: 1,
          },
        }),
      ),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    expect(await screen.findByText("Fallback 1 din 2")).not.toBeNull();
    expect(screen.getByText("Buton alternativ")).not.toBeNull();
    expect(screen.getByText(/#fallback/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Rulează fallback" }));
    expect(api.runCurrentFallback).toHaveBeenCalledWith(run.id);
    await user.click(
      screen.getByRole("button", { name: "Sari peste fallback" }),
    );
    expect(api.skipCurrentFallback).toHaveBeenCalledWith(run.id);
  });

  it("configures run mode, wait-before-start and the Continue shortcut", async () => {
    const user = userEvent.setup();
    const api = {
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
      startRun: vi.fn().mockResolvedValue(snapshot()),
      configureRunnerShortcut: vi.fn().mockResolvedValue("Alt+Enter"),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.selectOptions(
      await screen.findByLabelText("Mod de rulare"),
      "step_by_step",
    );
    await user.click(screen.getByLabelText("Așteaptă înainte de primul pas"));
    const shortcutInput = screen.getByLabelText("Shortcut Continue");
    await user.clear(shortcutInput);
    await user.type(shortcutInput, "alt+enter");
    await user.click(screen.getByRole("button", { name: "Salvează" }));
    expect(api.configureRunnerShortcut).toHaveBeenCalledWith(
      project.id,
      "alt+enter",
    );

    await user.click(screen.getByRole("button", { name: "Rulează testul" }));
    expect(api.startRun).toHaveBeenCalledWith({
      projectId: project.id,
      testId: test.id,
      mode: "step_by_step",
      waitBeforeStart: true,
    });
  });

  it("continues a breakpoint with the button or Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const waiting = snapshot({
      state: "waiting_at_breakpoint",
      pause: {
        kind: "breakpoint",
        title: "Verifică pagina",
        instructions: "Confirmă vizual rezultatul.",
        previousStepId: "step-previous",
        nextStepId: "step-next",
      },
    });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(waiting),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      continueRun: vi.fn().mockResolvedValue(waiting),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    expect(await screen.findByText("Verifică pagina")).not.toBeNull();
    expect(screen.getByText("step-previous")).not.toBeNull();
    expect(screen.getByText("step-next")).not.toBeNull();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(api.continueRun).toHaveBeenCalledWith(run.id);
    await user.click(
      screen.getByRole("button", { name: "Continuă (Ctrl+Enter)" }),
    );
    expect(api.continueRun).toHaveBeenCalledTimes(2);
  });
});
