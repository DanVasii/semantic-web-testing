// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import type {
  RecorderSnapshot,
  RecorderStepDraft,
} from "../shared/recorder.js";
import { RecorderPanel } from "./RecorderPanel.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
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
  status: "draft",
  version: 1,
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/checkout",
  normalizedStartUrl: "https://example.test/checkout",
  workflowState: "not_recorded",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  flowItems: [],
};

const snapshot = (
  partial: Partial<RecorderSnapshot> = {},
): RecorderSnapshot => ({
  projectId: project.id,
  testId: test.id,
  state: "idle",
  signal: "green",
  message: "Recorderul este oprit.",
  test,
  capturedSteps: 0,
  queuedEvents: 0,
  canStart: true,
  canStop: false,
  canRetry: false,
  canIgnore: false,
  ...partial,
});

afterEach(cleanup);

describe("RecorderPanel", () => {
  it("starts recording and edits a semantic preview before adding it", async () => {
    const user = userEvent.setup();
    let listener: ((value: RecorderSnapshot) => void) | undefined;
    const startRecorder = vi.fn().mockResolvedValue(
      snapshot({
        state: "recording",
        message: "Recorder activ.",
        canStart: false,
        canStop: true,
        test: { ...test, workflowState: "recording" },
      }),
    );
    const addRecorderStep = vi
      .fn<
        (
          projectId: string,
          testId: string,
          draft: RecorderStepDraft,
        ) => Promise<RecorderSnapshot>
      >()
      .mockResolvedValue(
        snapshot({
          state: "recording",
          message: "Pas adăugat.",
          capturedSteps: 1,
          canStart: false,
          canStop: true,
          test: {
            ...test,
            workflowState: "recording",
            flowItems: [],
          },
        }),
      );
    const api = {
      getRecorderStatus: vi.fn().mockResolvedValue(snapshot()),
      onRecorderStatusChange: vi
        .fn()
        .mockImplementation(
          (next: (value: RecorderSnapshot) => void): (() => void) => {
            listener = next;
            return vi.fn();
          },
        ),
      startRecorder,
      stopRecorder: vi.fn(),
      addRecorderStep,
      discardRecorderStep: vi.fn(),
      retryRecorderAnalysis: vi.fn(),
      ignoreRecorderAnalysisError: vi.fn(),
    } as unknown as SemanticAppApi;

    render(
      <RecorderPanel
        api={api}
        project={project}
        test={test}
        onTestUpdated={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Înregistrează testul" }),
    );
    expect(startRecorder).toHaveBeenCalledWith(project.id, test.id);

    act(() => {
      listener?.(
        snapshot({
          state: "preview",
          signal: "red",
          message: "Pas capturat.",
          canStart: false,
          canStop: true,
          test: { ...test, workflowState: "recording" },
          pendingStep: {
            step: {
              id: "step-1",
              type: "action",
              actionType: "click",
              title: "Apasă Continuă",
              humanDescription: "Apasă butonul Continuă.",
              whyExplanation: "Buton semantic identificat după rol și nume.",
              target: {
                primary: {
                  type: "role",
                  role: "button",
                  operator: "equals",
                  value: "Continuă",
                },
              },
              fallbacks: [],
              enabled: true,
            },
          },
        }),
      );
    });

    expect(screen.getByText("Preview pas capturat")).not.toBeNull();
    const title = screen.getByRole("textbox", { name: "Titlu" });
    await user.clear(title);
    await user.type(title, "Continuă spre plată");
    await user.click(
      screen.getByRole("button", { name: "Adaugă pasul în test" }),
    );

    const submitted = addRecorderStep.mock.calls[0]?.[2];
    expect(addRecorderStep).toHaveBeenCalledWith(
      project.id,
      test.id,
      submitted,
    );
    expect(submitted?.step).toMatchObject({
      title: "Continuă spre plată",
      target: {
        primary: {
          type: "role",
          role: "button",
          operator: "equals",
          value: "Continuă",
        },
      },
    });
  });

  it("offers retry and explicit ignore when analysis fails", async () => {
    const user = userEvent.setup();
    const retryRecorderAnalysis = vi.fn().mockResolvedValue(
      snapshot({
        state: "recording",
        signal: "yellow",
        canStart: false,
      }),
    );
    const ignoreRecorderAnalysisError = vi.fn().mockResolvedValue(
      snapshot({
        state: "preview",
        signal: "red",
        canStart: false,
        canStop: true,
        pendingStep: {
          step: {
            id: "step-1",
            type: "action",
            actionType: "navigate",
            title: "Navighează",
            humanDescription: "Deschide pagina.",
            whyExplanation: "Navigare capturată.",
            url: "https://example.test/cart",
            fallbacks: [],
            enabled: true,
          },
        },
      }),
    );
    const api = {
      getRecorderStatus: vi.fn().mockResolvedValue(
        snapshot({
          state: "error",
          signal: "red",
          error: "Captura DOM a eșuat.",
          canStart: false,
          canStop: true,
          canRetry: true,
          canIgnore: true,
        }),
      ),
      onRecorderStatusChange: vi.fn().mockReturnValue(vi.fn()),
      retryRecorderAnalysis,
      ignoreRecorderAnalysisError,
      stopRecorder: vi.fn(),
    } as unknown as SemanticAppApi;

    render(
      <RecorderPanel
        api={api}
        project={project}
        test={test}
        onTestUpdated={vi.fn()}
      />,
    );
    expect(await screen.findByText("Captura DOM a eșuat.")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Reîncearcă analiza" }),
    );
    expect(retryRecorderAnalysis).toHaveBeenCalledWith(project.id, test.id);

    cleanup();
    render(
      <RecorderPanel
        api={{
          ...api,
          getRecorderStatus: vi.fn().mockResolvedValue(
            snapshot({
              state: "error",
              signal: "red",
              error: "Captura DOM a eșuat.",
              canStart: false,
              canStop: true,
              canRetry: true,
              canIgnore: true,
            }),
          ),
        }}
        project={project}
        test={test}
        onTestUpdated={vi.fn()}
      />,
    );
    await user.click(
      await screen.findByRole("button", { name: "Ignoră evenimentul" }),
    );
    expect(ignoreRecorderAnalysisError).toHaveBeenCalledWith(
      project.id,
      test.id,
    );
  });
});
