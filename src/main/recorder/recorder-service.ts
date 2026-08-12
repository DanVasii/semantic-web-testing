import type { BrowserContext, Frame, Page } from "playwright-core";

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
  bindingName: string;
  snapshot: RecorderSnapshot;
  pages: Set<Page>;
  navigationListeners: Map<Page, (frame: Frame) => void>;
  context: BrowserContext;
  contextPageListener: (page: Page) => void;
  queue: Array<{ event: RecorderRawEvent; page: Page }>;
  processing?: Promise<void>;
  currentEvent?: { event: RecorderRawEvent; page: Page };
  failedDraft?: RecorderStepDraft;
  navigationGeneration: number;
  lastNavigationUrl: string;
}

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
    !("target" in value) ||
    value.target === undefined ||
    isElementSnapshot(value.target)
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
      message: "Se pregătește browserul și recorderul.",
      test: originalTest,
      capturedSteps: 0,
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
      await this.prepareBrowser(project, originalTest);
      test = this.testsService.beginRecording(projectId, testId);
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
      bindingName,
      pages: new Set(),
      navigationListeners: new Map(),
      context,
      contextPageListener: () => undefined,
      queue: [],
      navigationGeneration: 0,
      lastNavigationUrl: page.url(),
      snapshot: {
        projectId,
        testId,
        state: "recording",
        signal: "green",
        message: "Recorder activ. Execută următoarea acțiune în browser.",
        test,
        capturedSteps: 0,
        queuedEvents: 0,
        canStart: false,
        canStop: false,
        canRetry: false,
        canIgnore: false,
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
    const cleanFinish =
      session.snapshot.state === "recording" &&
      session.snapshot.signal === "green" &&
      session.queue.length === 0 &&
      session.snapshot.pendingStep === undefined &&
      session.test.flowItems.length > 0;
    const emptyRecording = session.test.flowItems.length === 0;
    const test = cleanFinish
      ? await this.testsService.completeRecording(projectId, testId)
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
      capturedSteps: test.flowItems.length,
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
    session.test = this.testsService.appendRecordedStep(
      projectId,
      testId,
      structuredClone(draft.step),
    );
    this.persistCapturedValue(session.test, draft);
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
      capturedSteps: session.test.flowItems.length,
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
    await this.setBlocked(session, true);
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
      draft = buildRecorderStep(current.event, {
        createId: () => draft.step.id,
        pageId: result.page.id,
      });
      session.failedDraft = draft;
      session.test = this.testsService.appendRecordedStep(
        session.project.id,
        session.test.id,
        structuredClone(draft.step),
      );
      this.persistCapturedValue(session.test, draft);
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
        capturedSteps: session.test.flowItems.length,
        queuedEvents: session.queue.length,
        canStop: session.queue.length === 0,
        canRetry: false,
        canIgnore: false,
      });
      if (session.queue.length === 0) {
        await this.setBlocked(session, false);
      }
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
  }

  private enqueue(
    session: RecorderSession,
    event: RecorderRawEvent,
    page: Page,
    allowWhileBusy = false,
  ): void {
    if (
      !allowWhileBusy &&
      (session.snapshot.state !== "recording" ||
        session.snapshot.signal !== "green")
    ) {
      return;
    }
    session.queue.push({ event: structuredClone(event), page });
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
