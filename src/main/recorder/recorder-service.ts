import type { BrowserContext, Dialog, Frame, Page } from "playwright-core";

import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  DetectedBrowser,
} from "../../shared/browser-manager.js";
import type { PageAnalysisResult } from "../../shared/page-analysis.js";
import type {
  Project,
  TestDataset,
  TestDefinition,
} from "../../shared/persistence.js";
import {
  RECORDER_STATES,
  type RecorderElementSnapshot,
  type RecorderRawEvent,
  type RecorderSnapshot,
  type RecorderStepDraft,
} from "../../shared/recorder.js";
import type { DatasetPrimitive } from "../../shared/test-model.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "../persistence/repositories.js";
import { TestsService } from "../tests-service.js";
import {
  flushRecorderPendingInputs,
  installRecorderCapture,
  setRecorderPageBlocked,
  stopRecorderCapture,
} from "./recorder-browser-capture.js";
import { buildRecorderStep } from "./recorder-step-builder.js";

export interface RecorderBrowserGateway {
  detectAvailableBrowsers: () => Promise<DetectedBrowser[]>;
  getStatus: () => BrowserManagerStatus;
  launch: (options: BrowserLaunchOptions) => Promise<BrowserSession>;
  openProjectUrl: (
    projectId: string,
    url: string,
  ) => Promise<BrowserNavigationResult>;
  getRunnerPage: (projectId: string) => Page;
  getRunnerContext: (projectId: string) => BrowserContext;
}

export interface RecorderAnalysisGateway {
  analyzeCurrentPage: (projectId: string) => Promise<PageAnalysisResult>;
}

export interface RecorderServiceOptions {
  createId: () => string;
  now: () => Date;
  stabilizationMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
}

export type RecorderStatusListener = (snapshot: RecorderSnapshot) => void;

interface RecorderSession {
  project: Project;
  originalTest: TestDefinition;
  test: TestDefinition;
  stageId?: string;
  bindingName: string;
  snapshot: RecorderSnapshot;
  pages: Set<Page>;
  navigationListeners: Map<Page, (frame: Frame) => void>;
  dialogListeners: Map<Page, (dialog: Dialog) => void>;
  context: BrowserContext;
  contextPageListener: (page: Page) => void;
  queue: Array<{ event: RecorderRawEvent; page: Page }>;
  processing?: Promise<void>;
  currentEvent?: { event: RecorderRawEvent; page: Page };
  failedDraft?: RecorderStepDraft;
  navigationGeneration: number;
  lastNavigationUrl: string;
  initialNavigationUrl?: string;
  analyzedGeneration?: number;
  lastAnalyzedPageId?: string;
  lastRecordedEvent?: { event: RecorderRawEvent; page: Page };
}

const recordedFlow = (
  test: TestDefinition,
  stageId?: string,
): TestDefinition["flowItems"] => {
  if (test.stages === undefined) return test.flowItems;
  const stage =
    stageId === undefined
      ? test.stages[0]
      : test.stages.find((candidate) => candidate.id === stageId);
  return stage?.flowItems ?? [];
};

const dynamicRouteSegment = (segment: string): boolean =>
  /^\d+$/.test(segment) ||
  /^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(segment) ||
  (/\d/.test(segment) && segment.length >= 8) ||
  /^[0-9a-f]{16,}$/i.test(segment);

export const stableNavigationPattern = (value: string): string => {
  const url = new URL(value);
  const segments = url.pathname.split("/").filter(Boolean);
  const dynamicIndex = segments.findIndex(dynamicRouteSegment);
  const stableSegments =
    dynamicIndex < 0 ? segments : segments.slice(0, dynamicIndex);
  const stablePath =
    stableSegments.length === 0 ? "/" : `/${stableSegments.join("/")}`;
  return dynamicIndex < 0
    ? `${url.origin}${stablePath}`
    : `${url.origin}${stablePath === "/" ? "" : stablePath}/**`;
};

const canMergeNavigation = (
  session: RecorderSession,
  current: { event: RecorderRawEvent; page: Page },
): boolean => {
  const previous = session.lastRecordedEvent;
  if (
    current.event.type !== "navigate" ||
    previous?.event.type !== "click" ||
    previous.page !== current.page
  ) {
    return false;
  }
  const elapsed =
    new Date(current.event.timestamp).getTime() -
    new Date(previous.event.timestamp).getTime();
  return Number.isFinite(elapsed) && elapsed >= 0 && elapsed <= 5_000;
};

const activeBrowserStates = new Set([
  "starting",
  "running",
  "waiting_for_basic_auth",
  "reconnecting",
]);

const canStartRecording = (
  workflowState: TestDefinition["workflowState"],
): boolean =>
  ["not_recorded", "recording", "recorded", "flow_analyzed", "ready"].includes(
    workflowState,
  );

const copyTest = (test: TestDefinition): TestDefinition => ({
  ...test,
  flowItems: structuredClone(test.flowItems),
});

const copySnapshot = (snapshot: RecorderSnapshot): RecorderSnapshot => ({
  ...snapshot,
  test: copyTest(snapshot.test),
  ...(snapshot.pendingStep === undefined
    ? {}
    : { pendingStep: structuredClone(snapshot.pendingStep) }),
});

const withUniqueCapturedValueKey = (
  test: TestDefinition,
  draft: RecorderStepDraft,
): RecorderStepDraft => {
  const baseKey = draft.step.valueKey;
  if (baseKey === undefined || draft.capturedValue === undefined) return draft;

  const usedKeys = new Set(
    test.flowItems.flatMap((item) =>
      item.type === "action" && item.valueKey !== undefined
        ? [item.valueKey]
        : [],
    ),
  );
  if (!usedKeys.has(baseKey)) return draft;

  let suffix = 2;
  while (usedKeys.has(`${baseKey}_${suffix}`)) suffix += 1;

  return {
    ...draft,
    step: {
      ...draft.step,
      valueKey: `${baseKey}_${suffix}`,
    },
  };
};

const isStringRecord = (value: unknown): value is Record<string, string> =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.values(value).every((item) => typeof item === "string");

const isElementSnapshot = (value: unknown): value is RecorderElementSnapshot =>
  typeof value === "object" &&
  value !== null &&
  "tagName" in value &&
  typeof value.tagName === "string" &&
  "dataAttributes" in value &&
  isStringRecord(value.dataAttributes);

const isRecorderRawEvent = (value: unknown): value is RecorderRawEvent => {
  if (typeof value !== "object" || value === null) return false;
  if (
    !("type" in value) ||
    typeof value.type !== "string" ||
    ![
      "click",
      "hover",
      "fill",
      "select",
      "checkbox",
      "radio",
      "press_key",
      "navigate",
      "scroll",
    ].includes(value.type) ||
    !("url" in value) ||
    typeof value.url !== "string" ||
    !("timestamp" in value) ||
    typeof value.timestamp !== "string"
  ) {
    return false;
  }
  return (
    (!("target" in value) ||
      value.target === undefined ||
      isElementSnapshot(value.target)) &&
    (!("hoverCandidates" in value) ||
      value.hoverCandidates === undefined ||
      (Array.isArray(value.hoverCandidates) &&
        value.hoverCandidates.length <= 3 &&
        value.hoverCandidates.every(isElementSnapshot))) &&
    (!("scrollMode" in value) ||
      value.scrollMode === undefined ||
      value.scrollMode === "dom" ||
      value.scrollMode === "wheel") &&
    (!("frameContext" in value) ||
      value.frameContext === undefined ||
      (typeof value.frameContext === "object" &&
        value.frameContext !== null &&
        "origin" in value.frameContext &&
        typeof value.frameContext.origin === "string"))
  );
};

export class RecorderService {
  private readonly sessions = new Map<string, RecorderSession>();
  private readonly listeners = new Set<RecorderStatusListener>();
  private readonly stabilizationMs: number;
  private readonly wait: (milliseconds: number) => Promise<void>;

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly testsService: TestsService,
    private readonly browser: RecorderBrowserGateway,
    private readonly analysis: RecorderAnalysisGateway,
    private readonly options: RecorderServiceOptions,
  ) {
    this.stabilizationMs = options.stabilizationMs ?? 300;
    this.wait =
      options.wait ??
      ((milliseconds) =>
        new Promise((resolve) => {
          setTimeout(resolve, milliseconds);
        }));
  }

  public onStatusChange(listener: RecorderStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getStatus(projectId: string, testId: string): RecorderSnapshot {
    const session = this.sessions.get(this.key(projectId, testId));
    if (session !== undefined) return copySnapshot(session.snapshot);
    const test = this.requireTest(projectId, testId);
    return {
      projectId,
      testId,
      state: "idle",
      signal: test.workflowState === "recording" ? "red" : "green",
      message:
        test.workflowState === "recording"
          ? "Înregistrarea anterioară a fost întreruptă și necesită reluare."
          : "Recorderul este oprit.",
      test,
      capturedSteps: test.flowItems.length,
      queuedEvents: 0,
      canStart: canStartRecording(test.workflowState),
      canStop: false,
      canRetry: false,
      canIgnore: false,
    };
  }

  public async start(
    projectId: string,
    testId: string,
    stageId?: string,
  ): Promise<RecorderSnapshot> {
    return this.startSession(projectId, testId, stageId, false);
  }

  public async continueRecording(
    projectId: string,
    testId: string,
    stageId?: string,
  ): Promise<RecorderSnapshot> {
    return this.startSession(projectId, testId, stageId, true);
  }

  private async startSession(
    projectId: string,
    testId: string,
    stageId: string | undefined,
    continuation: boolean,
  ): Promise<RecorderSnapshot> {
    const sessionKey = this.key(projectId, testId);
    if (this.sessions.has(sessionKey)) {
      throw new Error("Recorderul testului este deja activ.");
    }
    const project = this.requireProject(projectId);
    const originalTest = this.requireTest(projectId, testId);
    this.publishSnapshot({
      projectId,
      testId,
      state: "preparing",
      signal: "yellow",
      message: continuation
        ? "Flow-ul a ajuns la final. Se pornește recorderul."
        : "Se pregătește browserul și recorderul.",
      test: originalTest,
      ...(stageId === undefined ? {} : { stageId }),
      capturedSteps: continuation
        ? recordedFlow(originalTest, stageId).length
        : 0,
      queuedEvents: 0,
      canStart: false,
      canStop: false,
      canRetry: false,
      canIgnore: false,
    });

    let test: TestDefinition;
    let page: Page;
    let context: BrowserContext;
    try {
      if (!continuation) {
        await this.prepareBrowser(project, originalTest, stageId);
      }
      test = continuation
        ? this.testsService.continueRecording(projectId, testId, stageId)
        : this.testsService.beginRecording(projectId, testId, stageId);
      page = this.browser.getRunnerPage(projectId);
      context = this.browser.getRunnerContext(projectId);
    } catch (error) {
      this.testsService.cancelRecording(projectId, testId, originalTest);
      this.publishStartFailure(projectId, testId, error);
      throw error;
    }
    const bindingName = `__semanticRecorder_${this.options
      .createId()
      .replace(/[^a-zA-Z0-9_]/g, "_")}`;
    const session: RecorderSession = {
      project,
      originalTest,
      test,
      ...(stageId === undefined ? {} : { stageId }),
      bindingName,
      pages: new Set(),
      navigationListeners: new Map(),
      dialogListeners: new Map(),
      context,
      contextPageListener: () => undefined,
      queue: [],
      navigationGeneration: 0,
      lastNavigationUrl: page.url(),
      ...(!continuation &&
      (stageId === undefined || originalTest.stages?.[0]?.id === stageId)
        ? { initialNavigationUrl: page.url() }
        : {}),
      snapshot: {
        projectId,
        testId,
        state: "recording",
        signal: "green",
        message: continuation
          ? "Poți începe să înregistrezi restul pașilor."
          : "Recorder activ. Execută următoarea acțiune în browser.",
        test,
        ...(stageId === undefined ? {} : { stageId }),
        capturedSteps: recordedFlow(test, stageId).length,
        queuedEvents: 0,
        canStart: false,
        canStop: false,
        canRetry: false,
        canIgnore: false,
        ...(continuation ? { continuationReady: true } : {}),
      },
    };
    session.contextPageListener = (nextPage) => {
      void this.attachPage(session, nextPage);
    };
    context.on("page", session.contextPageListener);
    this.sessions.set(sessionKey, session);
    try {
      await this.attachPage(session, page);
      this.publish(session, {
        ...session.snapshot,
        canStop: true,
      });
      return copySnapshot(session.snapshot);
    } catch (error) {
      this.sessions.delete(sessionKey);
      context.off("page", session.contextPageListener);
      this.testsService.cancelRecording(projectId, testId, originalTest);
      this.publishStartFailure(projectId, testId, error);
      throw error;
    }
  }

  public async stop(
    projectId: string,
    testId: string,
  ): Promise<RecorderSnapshot> {
    const session = this.requireSession(projectId, testId);
    await Promise.all(
      [...session.pages].map(async (page) =>
        flushRecorderPendingInputs(page, session.bindingName).catch(
          () => undefined,
        ),
      ),
    );
    if (session.processing !== undefined) {
      await session.processing;
    }
    const capturedFlow = recordedFlow(session.test, session.stageId);
    const cleanFinish =
      session.snapshot.state === "recording" &&
      session.snapshot.signal === "green" &&
      session.queue.length === 0 &&
      session.snapshot.pendingStep === undefined &&
      capturedFlow.length > 0;
    const emptyRecording = capturedFlow.length === 0;
    const test = cleanFinish
      ? await this.testsService.completeRecording(
          projectId,
          testId,
          session.stageId,
        )
      : emptyRecording
        ? this.testsService.cancelRecording(
            projectId,
            testId,
            session.originalTest,
          )
        : this.testsService.markRecordingIncomplete(projectId, testId);
    await this.cleanup(session);
    const completed: RecorderSnapshot = {
      projectId,
      testId,
      state: "completed",
      signal: cleanFinish || emptyRecording ? "green" : "red",
      message: cleanFinish
        ? "Înregistrarea s-a încheiat. Revizuiește pașii generați."
        : emptyRecording
          ? "Înregistrarea goală a fost anulată. Poți porni din nou recorderul."
          : "Recorderul s-a oprit cu pași sau analize nefinalizate.",
      test,
      ...(session.stageId === undefined ? {} : { stageId: session.stageId }),
      capturedSteps: recordedFlow(test, session.stageId).length,
      queuedEvents: 0,
      canStart: canStartRecording(test.workflowState),
      canStop: false,
      canRetry: false,
      canIgnore: false,
    };
    this.sessions.delete(this.key(projectId, testId));
    this.publishSnapshot(completed);
    return copySnapshot(completed);
  }

  public async addStep(
    projectId: string,
    testId: string,
    draft: RecorderStepDraft,
  ): Promise<RecorderSnapshot> {
    const session = this.requireSession(projectId, testId);
    if (session.snapshot.pendingStep === undefined) {
      throw new Error("Nu există un pas recorder în preview.");
    }
    const uniqueDraft = withUniqueCapturedValueKey(
      session.test,
      structuredClone(draft),
    );
    session.test = this.testsService.appendRecordedStep(
      projectId,
      testId,
      uniqueDraft.step,
      session.stageId,
    );
    this.persistCapturedValue(session.test, uniqueDraft);
    delete session.currentEvent;
    delete session.failedDraft;
    const nextSnapshot = { ...session.snapshot };
    delete nextSnapshot.pendingStep;
    delete nextSnapshot.error;
    this.publish(session, {
      ...nextSnapshot,
      state: "recording",
      signal: session.queue.length === 0 ? "green" : "yellow",
      message:
        session.queue.length === 0
          ? "Pas adăugat. Recorderul este pregătit pentru următoarea acțiune."
          : "Pas adăugat. Se procesează evenimentul următor.",
      test: session.test,
      capturedSteps: recordedFlow(session.test, session.stageId).length,
      queuedEvents: session.queue.length,
      canStop: session.queue.length === 0,
      canRetry: false,
      canIgnore: false,
    });
    if (session.queue.length === 0) {
      await this.setBlocked(session, false);
    } else {
      this.processQueue(session);
    }
    return copySnapshot(session.snapshot);
  }

  public async discardStep(
    projectId: string,
    testId: string,
  ): Promise<RecorderSnapshot> {
    const session = this.requireSession(projectId, testId);
    if (session.snapshot.pendingStep === undefined) {
      throw new Error("Nu există un pas recorder în preview.");
    }
    delete session.currentEvent;
    delete session.failedDraft;
    const nextSnapshot = { ...session.snapshot };
    delete nextSnapshot.pendingStep;
    delete nextSnapshot.error;
    this.publish(session, {
      ...nextSnapshot,
      state: "recording",
      signal: session.queue.length === 0 ? "green" : "yellow",
      message:
        session.queue.length === 0
          ? "Eveniment ignorat. Recorderul este pregătit."
          : "Eveniment ignorat. Se procesează următorul eveniment.",
      queuedEvents: session.queue.length,
      canStop: session.queue.length === 0,
      canRetry: false,
      canIgnore: false,
    });
    if (session.queue.length === 0) {
      await this.setBlocked(session, false);
    } else {
      this.processQueue(session);
    }
    return copySnapshot(session.snapshot);
  }

  public retry(projectId: string, testId: string): RecorderSnapshot {
    const session = this.requireSession(projectId, testId);
    if (
      session.snapshot.state !== "error" ||
      session.currentEvent === undefined
    ) {
      throw new Error("Recorderul nu are o analiză de reîncercat.");
    }
    session.queue.unshift(session.currentEvent);
    delete session.currentEvent;
    delete session.failedDraft;
    const nextSnapshot = { ...session.snapshot };
    delete nextSnapshot.error;
    this.publish(session, {
      ...nextSnapshot,
      state: "recording",
      signal: "yellow",
      message: "Se reîncearcă analiza evenimentului.",
      queuedEvents: session.queue.length,
      canStop: false,
      canRetry: false,
      canIgnore: false,
    });
    this.processQueue(session);
    return copySnapshot(session.snapshot);
  }

  public ignoreError(projectId: string, testId: string): RecorderSnapshot {
    const session = this.requireSession(projectId, testId);
    if (
      session.snapshot.state !== "error" ||
      session.failedDraft === undefined
    ) {
      throw new Error("Recorderul nu are o eroare care poate fi ignorată.");
    }
    this.publish(session, {
      ...session.snapshot,
      state: "preview",
      signal: "red",
      message:
        "Analiza a fost ignorată explicit. Revizuiește pasul fără asociere de pagină.",
      pendingStep: session.failedDraft,
      canStop: true,
      canRetry: false,
      canIgnore: false,
    });
    return copySnapshot(session.snapshot);
  }

  private processQueue(session: RecorderSession): void {
    if (
      session.processing !== undefined ||
      session.snapshot.pendingStep !== undefined ||
      session.snapshot.state === "error"
    ) {
      return;
    }
    const queued = session.queue.shift();
    if (queued === undefined) return;
    session.currentEvent = queued;
    session.processing = this.processEvent(session, queued)
      .catch(() => undefined)
      .finally(() => {
        delete session.processing;
        if (
          session.queue.length > 0 &&
          session.snapshot.pendingStep === undefined &&
          session.snapshot.state !== "error"
        ) {
          this.processQueue(session);
        }
      });
  }

  private async processEvent(
    session: RecorderSession,
    current: { event: RecorderRawEvent; page: Page },
  ): Promise<void> {
    this.publish(session, {
      ...session.snapshot,
      state: "analyzing",
      signal: "yellow",
      message: "Acțiunea a fost capturată. Pagina este analizată.",
      queuedEvents: session.queue.length,
      canStop: false,
      canRetry: false,
      canIgnore: false,
    });
    let draft = buildRecorderStep(current.event, {
      createId: this.options.createId,
    });
    session.failedDraft = draft;
    try {
      let pageId = session.lastAnalyzedPageId;
      if (
        pageId === undefined ||
        session.analyzedGeneration !== session.navigationGeneration
      ) {
        await this.wait(this.stabilizationMs);
        let generation = session.navigationGeneration;
        let result = await this.analysis.analyzeCurrentPage(session.project.id);
        if (generation !== session.navigationGeneration) {
          generation = session.navigationGeneration;
          await this.wait(this.stabilizationMs);
          result = await this.analysis.analyzeCurrentPage(session.project.id);
          if (generation !== session.navigationGeneration) {
            throw new Error(
              "Pagina s-a schimbat din nou în timpul capturii. Reîncearcă.",
            );
          }
        }
        pageId = result.page.id;
        session.lastAnalyzedPageId = pageId;
        session.analyzedGeneration = generation;
      }
      draft = buildRecorderStep(current.event, {
        createId: () => draft.step.id,
        pageId,
      });
      if (
        session.initialNavigationUrl !== undefined &&
        recordedFlow(session.test, session.stageId).length === 0
      ) {
        const initialNavigation = buildRecorderStep(
          {
            type: "navigate",
            url: session.initialNavigationUrl,
            timestamp: this.options.now().toISOString(),
          },
          { createId: this.options.createId },
        ).step;
        session.test = this.testsService.appendRecordedStep(
          session.project.id,
          session.test.id,
          initialNavigation,
          session.stageId,
        );
      }
      if (canMergeNavigation(session, current)) {
        const previous = recordedFlow(session.test, session.stageId).at(-1);
        if (previous?.type === "action" && previous.actionType === "click") {
          const pattern = stableNavigationPattern(current.event.url);
          const destination = new URL(current.event.url).pathname;
          const baseTitle = previous.title.replace(
            /\s+pentru a naviga la .+$/u,
            "",
          );
          const baseDescription = previous.humanDescription.replace(
            /\s+Destinația așteptată este .+\.$/u,
            "",
          );
          const merged = {
            ...previous,
            title: `${baseTitle} pentru a naviga la ${destination}`,
            humanDescription: `${baseDescription} Destinația așteptată este ${pattern}.`,
            waitAfter: {
              type: "url" as const,
              value: pattern,
              timeoutMs: 5_000,
              warningOnly: true,
            },
          };
          session.test = this.testsService.replaceLastRecordedStep(
            session.project.id,
            session.test.id,
            merged,
            session.stageId,
          );
          session.lastAnalyzedPageId = pageId;
          delete session.currentEvent;
          delete session.failedDraft;
          const nextSnapshot = { ...session.snapshot };
          delete nextSnapshot.pendingStep;
          delete nextSnapshot.error;
          this.publish(session, {
            ...nextSnapshot,
            state: "recording",
            signal: session.queue.length === 0 ? "green" : "yellow",
            message: "Navigarea a fost comasată cu click-ul anterior.",
            test: session.test,
            capturedSteps: recordedFlow(session.test, session.stageId).length,
            queuedEvents: session.queue.length,
            canStop: session.queue.length === 0,
            canRetry: false,
            canIgnore: false,
          });
          return;
        }
      }
      draft = withUniqueCapturedValueKey(session.test, draft);
      session.failedDraft = draft;
      session.test = this.testsService.appendRecordedStep(
        session.project.id,
        session.test.id,
        structuredClone(draft.step),
        session.stageId,
      );
      this.persistCapturedValue(session.test, draft);
      session.lastRecordedEvent = current;
      delete session.currentEvent;
      delete session.failedDraft;
      const nextSnapshot = { ...session.snapshot };
      delete nextSnapshot.pendingStep;
      delete nextSnapshot.error;
      this.publish(session, {
        ...nextSnapshot,
        state: "recording",
        signal: session.queue.length === 0 ? "green" : "yellow",
        message:
          session.queue.length === 0
            ? "Pas salvat automat. Poți continua în browser."
            : "Pas salvat automat. Se analizează următorul eveniment.",
        test: session.test,
        capturedSteps: recordedFlow(session.test, session.stageId).length,
        queuedEvents: session.queue.length,
        canStop: session.queue.length === 0,
        canRetry: false,
        canIgnore: false,
      });
    } catch (error) {
      this.publish(session, {
        ...session.snapshot,
        state: "error",
        signal: "red",
        message: "Analiza acțiunii a eșuat.",
        error:
          error instanceof Error
            ? error.message
            : "Eroare recorder necunoscută.",
        queuedEvents: session.queue.length,
        canStop: true,
        canRetry: true,
        canIgnore: true,
      });
    }
  }

  private async attachPage(
    session: RecorderSession,
    page: Page,
  ): Promise<void> {
    if (session.pages.has(page)) return;
    session.pages.add(page);
    await installRecorderCapture(page, session.bindingName, (value) => {
      if (!isRecorderRawEvent(value)) return;
      this.enqueue(session, value, page);
    });
    const navigationListener = (frame: Frame): void => {
      if (frame !== page.mainFrame()) return;
      const url = page.url();
      if (!/^https?:\/\//i.test(url) || url === session.lastNavigationUrl) {
        return;
      }
      session.lastNavigationUrl = url;
      session.navigationGeneration += 1;
      this.enqueue(
        session,
        {
          type: "navigate",
          url,
          timestamp: this.options.now().toISOString(),
        },
        page,
        true,
      );
    };
    session.navigationListeners.set(page, navigationListener);
    page.on("framenavigated", navigationListener);
    const dialogListener = (): void => {
      // Playwright dismisses JavaScript dialogs automatically when no listener
      // exists. Keeping the dialog unresolved lets the person recording choose
      // OK, Cancel or a prompt value directly in the headed browser.
    };
    session.dialogListeners.set(page, dialogListener);
    page.on("dialog", dialogListener);
  }

  private enqueue(
    session: RecorderSession,
    event: RecorderRawEvent,
    page: Page,
    allowWhileBusy = false,
  ): void {
    if (
      !allowWhileBusy &&
      !["recording", "analyzing"].includes(session.snapshot.state)
    ) {
      return;
    }
    const queuedEvent = structuredClone(event);
    const previous = session.queue.at(-1);
    if (
      queuedEvent.type === "scroll" &&
      previous?.event.type === "scroll" &&
      previous.page === page &&
      previous.event.scrollMode === queuedEvent.scrollMode &&
      JSON.stringify(previous.event.target) ===
        JSON.stringify(queuedEvent.target)
    ) {
      previous.event = {
        ...queuedEvent,
        scrollX: (previous.event.scrollX ?? 0) + (queuedEvent.scrollX ?? 0),
        scrollY: (previous.event.scrollY ?? 0) + (queuedEvent.scrollY ?? 0),
      };
    } else {
      session.queue.push({ event: queuedEvent, page });
    }
    this.publish(session, {
      ...session.snapshot,
      state: "recording",
      signal: "yellow",
      message: "Eveniment primit. Se pregătește analiza.",
      queuedEvents: session.queue.length,
      canStop: false,
      canRetry: false,
      canIgnore: false,
    });
    this.processQueue(session);
  }

  private persistCapturedValue(
    test: TestDefinition,
    draft: RecorderStepDraft,
  ): void {
    const valueKey = draft.step.valueKey;
    if (draft.capturedValue === undefined || valueKey === undefined) return;
    const now = this.options.now().toISOString();
    let dataset = this.datasetRepository
      .listByTest(test.id)
      .find((candidate) => candidate.name === "Înregistrare recorder");
    if (dataset === undefined) {
      dataset = this.datasetRepository.create({
        id: this.options.createId(),
        testId: test.id,
        name: "Înregistrare recorder",
        values: {},
        createdAt: now,
        updatedAt: now,
      });
    }
    const value: DatasetPrimitive = draft.capturedValue;
    const updated: TestDataset = {
      ...dataset,
      values: {
        ...dataset.values,
        [valueKey]: { type: "fixed", value },
      },
      updatedAt: now,
    };
    this.datasetRepository.update(updated);
  }

  private async cleanup(session: RecorderSession): Promise<void> {
    session.context.off("page", session.contextPageListener);
    await Promise.all(
      [...session.pages].map(async (page) => {
        const listener = session.navigationListeners.get(page);
        if (listener !== undefined) {
          page.off("framenavigated", listener);
        }
        const dialogListener = session.dialogListeners.get(page);
        if (dialogListener !== undefined) {
          page.off("dialog", dialogListener);
        }
        await stopRecorderCapture(page, session.bindingName).catch(
          () => undefined,
        );
      }),
    );
  }

  private async setBlocked(
    session: RecorderSession,
    blocked: boolean,
  ): Promise<void> {
    await Promise.all(
      [...session.pages].map(async (page) =>
        setRecorderPageBlocked(page, session.bindingName, blocked).catch(
          () => undefined,
        ),
      ),
    );
  }

  private async prepareBrowser(
    project: Project,
    test: TestDefinition,
    stageId?: string,
  ): Promise<void> {
    const status = this.browser.getStatus();
    if (
      activeBrowserStates.has(status.state) &&
      status.projectId !== project.id
    ) {
      throw new Error("Browserul activ aparține altui proiect.");
    }
    if (!activeBrowserStates.has(status.state)) {
      const detections = await this.browser.detectAvailableBrowsers();
      const detected = detections.find(
        (candidate) =>
          candidate.id === project.browserConfig.browserType &&
          candidate.installed &&
          candidate.supported,
      );
      if (detected === undefined) {
        throw new Error("Browserul configurat nu este disponibil.");
      }
      await this.browser.launch({
        projectId: project.id,
        browser: detected.id,
        source: detected.source,
        sessionMode: project.browserConfig.sessionMode,
        ...(detected.executablePath === undefined
          ? {}
          : { executablePath: detected.executablePath }),
        ...(project.browserConfig.profilePath === undefined
          ? {}
          : { profilePath: project.browserConfig.profilePath }),
        ...(project.browserConfig.remoteDebuggingPort === undefined
          ? {}
          : {
              remoteDebuggingPort: project.browserConfig.remoteDebuggingPort,
            }),
        ...(project.browserConfig.viewport === undefined
          ? {}
          : { viewport: project.browserConfig.viewport }),
      });
    }
    if (stageId !== undefined && activeBrowserStates.has(status.state)) return;
    const navigation = await this.browser.openProjectUrl(
      project.id,
      test.startUrl,
    );
    if (navigation.state !== "opened") {
      throw new Error(
        "Autentificarea HTTP trebuie finalizată înainte de recorder.",
      );
    }
  }

  private publish(session: RecorderSession, snapshot: RecorderSnapshot): void {
    session.snapshot = snapshot;
    this.publishSnapshot(snapshot);
  }

  private publishSnapshot(snapshot: RecorderSnapshot): void {
    for (const listener of this.listeners) listener(copySnapshot(snapshot));
  }

  private publishStartFailure(
    projectId: string,
    testId: string,
    error: unknown,
  ): void {
    const test = this.requireTest(projectId, testId);
    this.publishSnapshot({
      projectId,
      testId,
      state: "idle",
      signal: "red",
      message: "Recorderul nu a putut porni. Poți încerca din nou.",
      error:
        error instanceof Error
          ? error.message
          : "Eroare necunoscută la pornirea recorderului.",
      test,
      capturedSteps: test.flowItems.length,
      queuedEvents: 0,
      canStart: canStartRecording(test.workflowState),
      canStop: false,
      canRetry: false,
      canIgnore: false,
    });
  }

  private requireProject(projectId: string): Project {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) throw new Error("Proiectul nu există.");
    return project;
  }

  private requireTest(projectId: string, testId: string): TestDefinition {
    const test = this.testRepository.findById(testId);
    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu există.");
    }
    return test;
  }

  private requireSession(projectId: string, testId: string): RecorderSession {
    const session = this.sessions.get(this.key(projectId, testId));
    if (session === undefined) throw new Error("Recorderul nu este activ.");
    return session;
  }

  private key(projectId: string, testId: string): string {
    return `${projectId}:${testId}`;
  }
}

export const isRecorderState = (value: string): boolean =>
  (RECORDER_STATES as readonly string[]).includes(value);
