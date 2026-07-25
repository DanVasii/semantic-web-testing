import type { BrowserContext, Page } from "playwright-core";

import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  DetectedBrowser,
} from "../../shared/browser-manager.js";
import type {
  JsonValue,
  Project,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
} from "../../shared/persistence.js";
import {
  RUN_MODES,
  type RunnerErrorDetails,
  type RunMode,
  type RunnerSnapshot,
  type StartRunInput,
} from "../../shared/runner.js";
import {
  assertShortcutAvailable,
  withContinueShortcut,
} from "../../shared/shortcuts.js";
import { toDeclarativeTestDefinition } from "../../shared/test-editor.js";
import type {
  ActionStep,
  LocatorFallback,
  TestFlowItem,
} from "../../shared/test-model.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../persistence/repositories.js";
import { materializeDataset } from "./dataset-values.js";
import {
  executeFlowItem,
  StepExecutionError,
  type StepExecutionResult,
} from "./step-executor.js";

export interface RunnerBrowserGateway {
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

export interface TestRunnerServiceOptions {
  createId: () => string;
  now: () => Date;
  random?: () => number;
}

export type RunnerStatusListener = (snapshot: RunnerSnapshot) => void;

interface RunnerSession {
  project: Project;
  test: TestDefinition;
  dataset?: TestDataset;
  datasetValues: Record<string, string>;
  page: Page;
  run: TestRun;
  snapshot: RunnerSnapshot;
  stopRequested: boolean;
  mode: RunMode;
  pendingFallback?: PendingFallback;
}

interface PendingFallback {
  item: ActionStep;
  index: number;
  startedAt: string;
  primaryError: RunnerErrorDetails;
  logs: JsonValue[];
}

const activeBrowserStates = new Set([
  "starting",
  "running",
  "reconnecting",
  "waiting_for_basic_auth",
]);

const copySnapshot = (snapshot: RunnerSnapshot): RunnerSnapshot => ({
  ...snapshot,
  ...(snapshot.run === undefined ? {} : { run: { ...snapshot.run } }),
  ...(snapshot.error === undefined ? {} : { error: { ...snapshot.error } }),
  ...(snapshot.fallback === undefined
    ? {}
    : {
        fallback: {
          ...snapshot.fallback,
          locator: structuredClone(snapshot.fallback.locator),
        },
      }),
});

const jsonError = (error: RunnerErrorDetails): JsonValue => ({
  code: error.code,
  message: error.message,
  ...(error.count === undefined ? {} : { count: error.count }),
  ...(error.stepId === undefined ? {} : { stepId: error.stepId }),
});

export class TestRunnerService {
  private readonly listeners = new Set<RunnerStatusListener>();
  private readonly sessions = new Map<string, RunnerSession>();
  private readonly latestByTest = new Map<string, RunnerSnapshot>();

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly pageRepository: PageRepository,
    private readonly runRepository: RunRepository,
    private readonly browser: RunnerBrowserGateway,
    private readonly options: TestRunnerServiceOptions,
  ) {}

  public onStatusChange(listener: RunnerStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async start(input: StartRunInput): Promise<RunnerSnapshot> {
    const key = this.testKey(input.projectId, input.testId);
    const existing = this.latestByTest.get(key);
    if (existing?.canStop === true || existing?.canRetry === true) {
      throw new Error(
        "Testul are deja o rulare activă sau o eroare în review.",
      );
    }

    const project = this.requireProject(input.projectId);
    const test = this.requireTest(input.projectId, input.testId);
    const mode = input.mode ?? "automatic";
    if (!(RUN_MODES as readonly string[]).includes(mode)) {
      throw new Error("Modul de rulare nu este valid.");
    }
    const datasets = this.datasetRepository.listByTest(test.id);
    const dataset = this.selectDataset(datasets, input.datasetId);
    this.assertRunnable(test, datasets);
    this.publishForTest(project.id, test.id, {
      state: "preparing",
      currentStepIndex: -1,
      totalSteps: test.flowItems.length,
      message: "Se încarcă testul și dataset-ul.",
      canStop: false,
      canRetry: false,
    });

    try {
      this.publishForTest(project.id, test.id, {
        state: "browser_starting",
        currentStepIndex: -1,
        totalSteps: test.flowItems.length,
        message: "Se pregătește browserul.",
        canStop: false,
        canRetry: false,
      });
      await this.prepareBrowser(project, test);
      const page = this.browser.getRunnerPage(project.id);
      const context = this.browser.getRunnerContext(project.id);
      if (test.wipeBeforeRun) {
        await this.wipeBrowserState(context, page, test.startUrl);
      }

      const startedAt = this.options.now().toISOString();
      const run: TestRun = {
        id: this.options.createId(),
        projectId: project.id,
        testId: test.id,
        testVersion: test.version,
        ...(dataset === undefined ? {} : { datasetId: dataset.id }),
        startedAt,
        status: "running",
        browserType: project.browserConfig.browserType,
        pageVersionIds: this.findPageVersionIds(test.flowItems),
      };
      this.runRepository.create(run);
      const snapshot: RunnerSnapshot = {
        state: input.waitBeforeStart === true ? "waiting_for_start" : "running",
        run,
        currentStepIndex: 0,
        totalSteps: test.flowItems.length,
        ...(test.flowItems[0] === undefined
          ? {}
          : { currentStepId: test.flowItems[0].id }),
        message:
          input.waitBeforeStart === true
            ? "Browserul este pregătit. Confirmă pornirea testului."
            : "Rularea a început.",
        ...(input.waitBeforeStart === true
          ? {
              pause: {
                kind: "before_start",
                title: "Pornire manuală",
                instructions:
                  "Apasă Continue sau shortcut-ul configurat pentru primul pas.",
                ...(test.flowItems[0] === undefined
                  ? {}
                  : { nextStepId: test.flowItems[0].id }),
              } as const,
            }
          : {}),
        canStop: true,
        canRetry: false,
      };
      const session: RunnerSession = {
        project,
        test,
        ...(dataset === undefined ? {} : { dataset }),
        datasetValues: materializeDataset(dataset, {
          createId: this.options.createId,
          now: this.options.now,
          random: this.options.random ?? Math.random,
        }),
        page,
        run,
        snapshot,
        stopRequested: false,
        mode,
      };
      this.sessions.set(run.id, session);
      this.publish(session, snapshot);
      if (input.waitBeforeStart !== true) {
        void this.continueRun(session);
      }
      return copySnapshot(snapshot);
    } catch (error) {
      const details = this.toRunnerError(error);
      this.publishForTest(project.id, test.id, {
        state:
          this.browser.getStatus().state === "waiting_for_basic_auth"
            ? "waiting_for_basic_auth"
            : "failed",
        currentStepIndex: -1,
        totalSteps: test.flowItems.length,
        message: details.message,
        error: details,
        canStop: false,
        canRetry: false,
      });
      throw error;
    }
  }

  public stop(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (!session.snapshot.canStop) {
      throw new Error("Rularea nu poate fi oprită în starea curentă.");
    }
    session.stopRequested = true;
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "stopped", endedAt };
    this.runRepository.updateStatus(runId, "stopped", endedAt);
    const snapshotWithoutError = { ...session.snapshot };
    delete snapshotWithoutError.error;
    delete snapshotWithoutError.fallback;
    delete snapshotWithoutError.pause;
    delete session.pendingFallback;
    this.publish(session, {
      ...snapshotWithoutError,
      state: "stopped",
      run: session.run,
      message: "Rularea a fost oprită manual.",
      canStop: false,
      canRetry: false,
    });
    return copySnapshot(session.snapshot);
  }

  public retry(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (!session.snapshot.canRetry) {
      throw new Error("Pasul curent nu poate fi reîncercat.");
    }
    session.stopRequested = false;
    session.run = {
      ...session.run,
      status: "running",
    };
    delete session.run.endedAt;
    this.runRepository.updateStatus(runId, "running");
    this.publish(session, {
      ...session.snapshot,
      state: "running",
      run: session.run,
      message: "Se reîncearcă pasul curent.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public continueExecution(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (
      ![
        "waiting_for_start",
        "waiting_at_breakpoint",
        "waiting_after_step",
      ].includes(session.snapshot.state)
    ) {
      throw new Error("Rularea nu așteaptă comanda Continue.");
    }

    if (session.snapshot.state === "waiting_at_breakpoint") {
      const breakpoint =
        session.test.flowItems[session.snapshot.currentStepIndex];
      if (breakpoint === undefined || breakpoint.type !== "breakpoint") {
        throw new Error("Breakpoint-ul curent nu mai există.");
      }
      const now = this.options.now().toISOString();
      this.saveStepResult(
        session,
        breakpoint,
        "passed",
        {
          logs: [
            {
              level: "info",
              message: "Breakpoint continuat de utilizator.",
            },
          ],
        },
        now,
      );
      session.snapshot.currentStepIndex += 1;
    }

    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.pause;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      message: "Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public configureContinueShortcut(
    projectId: string,
    shortcut: string,
  ): string {
    const project = this.requireProject(projectId);
    const normalized = assertShortcutAvailable(
      project.shortcutConfig,
      shortcut,
    );
    this.projectRepository.update({
      ...project,
      shortcutConfig: withContinueShortcut(project.shortcutConfig, normalized),
      updatedAt: this.options.now().toISOString(),
    });
    return normalized;
  }

  public async runCurrentFallback(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireFallbackSession(runId);
    const pending = session.pendingFallback;
    const fallback = pending?.item.fallbacks[pending.index];
    if (pending === undefined || fallback === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }

    this.publish(session, {
      ...session.snapshot,
      state: "running",
      message: `Se execută fallback-ul ${pending.index + 1}.`,
      canStop: true,
    });
    let result: StepExecutionResult;
    try {
      result = await executeFlowItem(
        session.page,
        pending.item,
        session.datasetValues,
        fallback.locator,
      );
    } catch (error) {
      const details = this.toRunnerError(error, pending.item.id);
      pending.logs.push({
        level: "warning",
        message: `Fallback-ul ${pending.index + 1} a eșuat: ${details.message}`,
      });
      pending.index += 1;
      if (pending.index >= pending.item.fallbacks.length) {
        return this.finalizeExhaustedFallbacks(session, details);
      }
      this.publishFallbackDecision(session, details);
      return copySnapshot(session.snapshot);
    }

    if (session.stopRequested) {
      this.saveStepResult(
        session,
        pending.item,
        "stopped",
        {
          ...result,
          logs: [
            ...pending.logs,
            ...result.logs,
            { level: "warning", message: "Rularea a fost oprită manual." },
          ],
        },
        pending.startedAt,
        undefined,
        pending.index,
      );
      return copySnapshot(session.snapshot);
    }

    const warningMessage = `A fost folosit fallback-ul ${pending.index + 1}: ${fallback.humanDescription}`;
    const warning: JsonValue = {
      code: "fallback_used",
      stepId: pending.item.id,
      fallbackIndex: pending.index,
      message: warningMessage,
    };
    session.run = this.runRepository.addWarning(session.run.id, warning);
    this.saveStepResult(
      session,
      pending.item,
      "passed_with_fallback",
      {
        ...result,
        logs: [
          ...pending.logs,
          ...result.logs,
          { level: "warning", message: warningMessage },
        ],
      },
      pending.startedAt,
      undefined,
      pending.index,
    );
    session.snapshot.currentStepIndex += 1;
    delete session.pendingFallback;
    if (this.pauseAfterStep(session, pending.item)) {
      return copySnapshot(session.snapshot);
    }
    const nextSnapshot = { ...session.snapshot };
    delete nextSnapshot.error;
    delete nextSnapshot.fallback;
    this.publish(session, {
      ...nextSnapshot,
      state: "running",
      run: session.run,
      message: "Fallback-ul a reușit. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public skipCurrentFallback(runId: string): RunnerSnapshot {
    const session = this.requireFallbackSession(runId);
    const pending = session.pendingFallback;
    if (pending === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }
    pending.logs.push({
      level: "warning",
      message: `Fallback-ul ${pending.index + 1} a fost sărit de utilizator.`,
    });
    pending.index += 1;
    if (pending.index >= pending.item.fallbacks.length) {
      return this.finalizeExhaustedFallbacks(session, pending.primaryError);
    }
    this.publishFallbackDecision(session, pending.primaryError);
    return copySnapshot(session.snapshot);
  }

  public getStatus(projectId: string, testId: string): RunnerSnapshot {
    this.requireTest(projectId, testId);
    return copySnapshot(
      this.latestByTest.get(this.testKey(projectId, testId)) ?? {
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      },
    );
  }

  public listRuns(projectId: string, testId: string): TestRun[] {
    this.requireTest(projectId, testId);
    return this.runRepository
      .listByProject(projectId)
      .filter((run) => run.testId === testId);
  }

  public listStepResults(
    projectId: string,
    testId: string,
    runId: string,
  ): StepRunResult[] {
    this.requireTest(projectId, testId);
    const run = this.runRepository.findById(runId);
    if (
      run === undefined ||
      run.projectId !== projectId ||
      run.testId !== testId
    ) {
      throw new Error("Rularea nu există.");
    }
    return this.runRepository.listStepResults(runId);
  }

  private async continueRun(session: RunnerSession): Promise<void> {
    while (session.snapshot.currentStepIndex < session.test.flowItems.length) {
      if (session.stopRequested) return;
      const index = session.snapshot.currentStepIndex;
      const item = session.test.flowItems[index];
      if (item === undefined) break;
      const stepStartedAt = this.options.now().toISOString();
      this.publish(session, {
        ...session.snapshot,
        state: "running",
        currentStepId: item.id,
        message: `Se execută pasul ${index + 1} din ${session.test.flowItems.length}.`,
      });

      if (!item.enabled) {
        this.saveStepResult(
          session,
          item,
          "skipped",
          {
            logs: [{ level: "info", message: "Pas dezactivat." }],
          },
          stepStartedAt,
        );
        session.snapshot.currentStepIndex += 1;
        continue;
      }

      if (item.type === "breakpoint") {
        const previous = session.test.flowItems[index - 1];
        const next = session.test.flowItems[index + 1];
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_at_breakpoint",
          message: item.title ?? "Rularea este oprită la breakpoint.",
          pause: {
            kind: "breakpoint",
            title: item.title ?? "Breakpoint",
            ...(item.instructions === undefined
              ? {}
              : { instructions: item.instructions }),
            ...(previous === undefined ? {} : { previousStepId: previous.id }),
            ...(next === undefined ? {} : { nextStepId: next.id }),
          },
          canStop: true,
          canRetry: false,
        });
        return;
      }

      try {
        const result = await executeFlowItem(
          session.page,
          item,
          session.datasetValues,
        );
        if (session.stopRequested) {
          this.saveStepResult(
            session,
            item,
            "stopped",
            {
              logs: [
                ...result.logs,
                { level: "warning", message: "Rularea a fost oprită manual." },
              ],
            },
            stepStartedAt,
          );
          return;
        }
        this.saveStepResult(session, item, "passed", result, stepStartedAt);
        session.snapshot.currentStepIndex += 1;
        if (this.pauseAfterStep(session, item)) return;
      } catch (error) {
        const details = this.toRunnerError(error, item.id);
        if (
          item.type === "action" &&
          item.fallbacks.length > 0 &&
          ["locator_not_found", "locator_ambiguous"].includes(details.code)
        ) {
          session.pendingFallback = {
            item,
            index: 0,
            startedAt: stepStartedAt,
            primaryError: details,
            logs: [
              {
                level: "warning",
                message: `Locatorul principal a eșuat: ${details.message}`,
              },
            ],
          };
          this.publishFallbackDecision(session, details);
          return;
        }
        this.saveStepResult(
          session,
          item,
          "failed",
          { logs: [{ level: "error", message: details.message }] },
          stepStartedAt,
          details,
        );
        const endedAt = this.options.now().toISOString();
        session.run = { ...session.run, status: "failed", endedAt };
        this.runRepository.updateStatus(session.run.id, "failed", endedAt);
        this.publish(session, {
          ...session.snapshot,
          state:
            details.code === "missing_data"
              ? "waiting_for_missing_data"
              : "paused_on_error",
          run: session.run,
          message: details.message,
          error: details,
          canStop: false,
          canRetry: true,
        });
        return;
      }
    }

    if (session.stopRequested) return;
    const endedAt = this.options.now().toISOString();
    const finalStatus =
      (session.run.warnings?.length ?? 0) > 0
        ? "passed_with_warnings"
        : "passed";
    session.run = { ...session.run, status: finalStatus, endedAt };
    this.runRepository.updateStatus(session.run.id, finalStatus, endedAt);
    const completedSnapshot = { ...session.snapshot };
    delete completedSnapshot.currentStepId;
    delete completedSnapshot.error;
    delete completedSnapshot.pause;
    this.publish(session, {
      ...completedSnapshot,
      state: "completed",
      run: session.run,
      currentStepIndex: session.test.flowItems.length,
      message:
        finalStatus === "passed_with_warnings"
          ? "Testul a trecut cu fallback-uri."
          : "Testul a trecut.",
      canStop: false,
      canRetry: false,
    });
  }

  private saveStepResult(
    session: RunnerSession,
    item: TestFlowItem,
    status: StepRunResult["status"],
    execution: StepExecutionResult,
    startedAt: string,
    error?: RunnerErrorDetails,
    fallbackIndex?: number,
  ): void {
    const endedAt = this.options.now().toISOString();
    this.runRepository.createStepResult({
      id: this.options.createId(),
      runId: session.run.id,
      stepId: item.id,
      status,
      startedAt,
      endedAt,
      ...(execution.locatorUsed === undefined
        ? {}
        : { locatorUsed: execution.locatorUsed }),
      ...(error === undefined ? {} : { error: jsonError(error) }),
      ...(fallbackIndex === undefined ? {} : { fallbackIndex }),
      logs: execution.logs,
    });
  }

  private pauseAfterStep(session: RunnerSession, item: TestFlowItem): boolean {
    if (
      session.mode !== "step_by_step" ||
      (item.type !== "action" && item.type !== "check") ||
      session.snapshot.currentStepIndex >= session.test.flowItems.length
    ) {
      return false;
    }
    const next = session.test.flowItems[session.snapshot.currentStepIndex];
    const waitingSnapshot = { ...session.snapshot };
    delete waitingSnapshot.error;
    delete waitingSnapshot.fallback;
    this.publish(session, {
      ...waitingSnapshot,
      state: "waiting_after_step",
      run: session.run,
      message: "Mod pas cu pas: confirmă următorul pas.",
      pause: {
        kind: "after_step",
        title: `Pas finalizat: ${item.title}`,
        previousStepId: item.id,
        ...(next === undefined ? {} : { nextStepId: next.id }),
      },
      canStop: true,
      canRetry: false,
    });
    return true;
  }

  private publishFallbackDecision(
    session: RunnerSession,
    error: RunnerErrorDetails,
  ): void {
    const pending = session.pendingFallback;
    const fallback = pending?.item.fallbacks[pending.index];
    if (pending === undefined || fallback === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }
    this.publish(session, {
      ...session.snapshot,
      state: "waiting_for_fallback_decision",
      run: session.run,
      message: `Locatorul principal a eșuat. Alege ce faci cu fallback-ul ${pending.index + 1} din ${pending.item.fallbacks.length}.`,
      error,
      fallback: this.toFallbackDecision(
        fallback,
        pending.index,
        pending.item.fallbacks.length,
      ),
      canStop: true,
      canRetry: false,
    });
  }

  private finalizeExhaustedFallbacks(
    session: RunnerSession,
    lastError: RunnerErrorDetails,
  ): RunnerSnapshot {
    const pending = session.pendingFallback;
    if (pending === undefined) {
      throw new Error("Nu există fallback-uri în așteptare.");
    }
    const exhaustedError: RunnerErrorDetails = {
      ...lastError,
      message: `Toate fallback-urile au fost epuizate. ${lastError.message}`,
      stepId: pending.item.id,
    };
    this.saveStepResult(
      session,
      pending.item,
      "failed",
      {
        logs: [
          ...pending.logs,
          {
            level: "error",
            message: exhaustedError.message,
          },
        ],
      },
      pending.startedAt,
      exhaustedError,
    );
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    delete session.pendingFallback;
    const failedSnapshot = { ...session.snapshot };
    delete failedSnapshot.fallback;
    this.publish(session, {
      ...failedSnapshot,
      state: "failed",
      run: session.run,
      message: exhaustedError.message,
      error: exhaustedError,
      canStop: false,
      canRetry: false,
    });
    return copySnapshot(session.snapshot);
  }

  private toFallbackDecision(
    fallback: LocatorFallback,
    index: number,
    total: number,
  ): NonNullable<RunnerSnapshot["fallback"]> {
    return {
      index,
      total,
      humanDescription: fallback.humanDescription,
      whyExplanation: fallback.whyExplanation,
      locator: structuredClone(fallback.locator),
    };
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
        throw new StepExecutionError(
          "browser_unavailable",
          "Browserul configurat nu este disponibil.",
        );
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
      throw new Error("Autentificarea HTTP trebuie finalizată înainte de run.");
    }
  }

  private async wipeBrowserState(
    context: BrowserContext,
    page: Page,
    startUrl: string,
  ): Promise<void> {
    const hostname = new URL(startUrl).hostname;
    const escapedHostname = hostname.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    await context.clearCookies({
      domain: new RegExp(`^\\.?${escapedHostname}$`, "i"),
    });
    await page.evaluate(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await page.goto(startUrl, { waitUntil: "domcontentloaded" });
  }

  private assertRunnable(test: TestDefinition, datasets: TestDataset[]): void {
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, test.flowItems, datasets),
    );
    if (
      !validation.valid ||
      test.status !== "valid" ||
      test.workflowState !== "ready"
    ) {
      throw new StepExecutionError(
        "invalid_test",
        "Testul trebuie să fie valid și pregătit de rulare.",
      );
    }
  }

  private selectDataset(
    datasets: TestDataset[],
    datasetId: string | undefined,
  ): TestDataset | undefined {
    if (datasetId === undefined) return datasets[0];
    const dataset = datasets.find((candidate) => candidate.id === datasetId);
    if (dataset === undefined) {
      throw new StepExecutionError(
        "dataset_missing",
        "Dataset-ul selectat nu există pentru acest test.",
      );
    }
    return dataset;
  }

  private findPageVersionIds(items: TestFlowItem[]): string[] {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.type !== "action" || item.pageId === undefined) continue;
      const version = this.pageRepository.findLatestVersion(item.pageId);
      if (version !== undefined) ids.add(version.id);
    }
    return [...ids];
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

  private requireSession(runId: string): RunnerSession {
    const session = this.sessions.get(runId);
    if (session === undefined) throw new Error("Rularea nu există.");
    return session;
  }

  private requireFallbackSession(runId: string): RunnerSession {
    const session = this.requireSession(runId);
    if (
      session.snapshot.state !== "waiting_for_fallback_decision" ||
      session.pendingFallback === undefined
    ) {
      throw new Error("Rularea nu așteaptă o decizie de fallback.");
    }
    return session;
  }

  private testKey(projectId: string, testId: string): string {
    return `${projectId}:${testId}`;
  }

  private publish(session: RunnerSession, snapshot: RunnerSnapshot): void {
    session.snapshot = snapshot;
    this.latestByTest.set(
      this.testKey(session.project.id, session.test.id),
      snapshot,
    );
    this.emit(snapshot);
  }

  private publishForTest(
    projectId: string,
    testId: string,
    snapshot: RunnerSnapshot,
  ): void {
    this.latestByTest.set(this.testKey(projectId, testId), snapshot);
    this.emit(snapshot);
  }

  private emit(snapshot: RunnerSnapshot): void {
    for (const listener of this.listeners) listener(copySnapshot(snapshot));
  }

  private toRunnerError(error: unknown, stepId?: string): RunnerErrorDetails {
    if (error instanceof StepExecutionError) {
      return {
        code: error.code,
        message: error.message,
        ...(error.count === undefined ? {} : { count: error.count }),
        ...(stepId === undefined ? {} : { stepId }),
      };
    }
    return {
      code: "step_failed",
      message:
        error instanceof Error ? error.message : "Eroare necunoscută la run.",
      ...(stepId === undefined ? {} : { stepId }),
    };
  }
}
