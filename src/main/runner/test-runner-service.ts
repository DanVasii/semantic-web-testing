import type { BrowserContext, Page } from "playwright-core";

import type { AiProviderId } from "../../shared/ai.js";
import type { ImapMatchedMessage } from "../../shared/imap.js";
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
import type {
  MySqlCleanupPreview,
  MySqlCleanupRowSelection,
  MySqlRunDetails,
  MySqlRunDiff,
  MySqlRunSnapshot,
} from "../../shared/mysql.js";
import {
  MANUAL_WIPE_RESOURCES,
  RUN_MODES,
  type ManualWipeResource,
  type ImapRunDetails,
  type MissingDataDetails,
  type RunnerErrorDetails,
  type RunMode,
  type RunnerSnapshot,
  type StartRunInput,
  type WipeDetails,
} from "../../shared/runner.js";
import { normalizeTestPostRunChecks } from "../../shared/post-run-checks.js";
import type {
  PostRunAiEvaluation,
  PostRunAiEvaluationInput,
} from "../../shared/post-run-checks.js";
import {
  assertShortcutAvailable,
  withContinueShortcut,
} from "../../shared/shortcuts.js";
import { toDeclarativeTestDefinition } from "../../shared/test-editor.js";
import type {
  ActionStep,
  CheckStep,
  LocatorFallback,
  TestFlowItem,
} from "../../shared/test-model.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import { applyAiRunPlan } from "../ai/ai-run-planning-service.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../persistence/repositories.js";
import { materializeDataset } from "./dataset-values.js";
import { inspectMissingInput, readManualInputValue } from "./missing-data.js";
import { classifyRunnerError } from "./runner-errors.js";
import {
  executeFlowItem,
  StepExecutionError,
  type StepExecutionResult,
} from "./step-executor.js";
import { wipeBrowserStateForOrigin, WipeError } from "./wipe-browser-state.js";

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
  mysql?: RunnerMySqlGateway;
  imap?: RunnerImapGateway;
  postRunAi?: RunnerPostRunAiGateway;
}

export interface RunnerMySqlGateway {
  captureBaseline: (
    projectId: string,
    runId: string,
    steps: Extract<TestFlowItem, { type: "check" }>[],
  ) => Promise<MySqlRunSnapshot | undefined>;
  check: (
    projectId: string,
    runId: string,
    step: Extract<TestFlowItem, { type: "check" }>,
  ) => Promise<MySqlRunDiff>;
  getRunDetails: (runId: string) => MySqlRunDetails;
  previewCleanup: (
    runId: string,
    diffId: string,
    selections: MySqlCleanupRowSelection[],
  ) => MySqlCleanupPreview;
  confirmCleanup: (
    projectId: string,
    runId: string,
    previewId: string,
  ) => Promise<unknown>;
}

export interface RunnerImapGateway {
  check: (
    projectId: string,
    runId: string,
    step: CheckStep,
    testStartedAt: string,
  ) => Promise<{ matched: boolean; message: string; evidence?: JsonValue }>;
}

export interface RunnerPostRunAiGateway {
  evaluate: (input: PostRunAiEvaluationInput) => Promise<PostRunAiEvaluation>;
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
  pendingMissingData?: PendingMissingData;
  postRunItems: CheckStep[];
  postRunIndex: number;
  pendingImap?: PendingImap;
  postRunAiRequested: boolean;
  postRunProvider?: AiProviderId;
  postRunModel?: string;
  postRunEvidence: {
    mysql?: JsonValue;
    imap?: JsonValue;
  };
}

interface PendingFallback {
  item: ActionStep;
  index: number;
  startedAt: string;
  primaryError: RunnerErrorDetails;
  logs: JsonValue[];
}

interface PendingMissingData {
  item: ActionStep;
  startedAt: string;
  details: MissingDataDetails;
}

interface PendingImap {
  item: CheckStep;
  startedAt: string;
}

const activeBrowserStates = new Set([
  "starting",
  "running",
  "reconnecting",
  "waiting_for_basic_auth",
]);

const copySnapshot = (snapshot: RunnerSnapshot): RunnerSnapshot => ({
  ...snapshot,
  ...(snapshot.flowItems === undefined
    ? {}
    : { flowItems: structuredClone(snapshot.flowItems) }),
  ...(snapshot.wipe === undefined
    ? {}
    : {
        wipe: {
          ...snapshot.wipe,
          entries: snapshot.wipe.entries.map((entry) => ({ ...entry })),
        },
      }),
  ...(snapshot.cleanup === undefined
    ? {}
    : {
        cleanup: {
          ...snapshot.cleanup,
          entries: snapshot.cleanup.entries.map((entry) => ({ ...entry })),
        },
      }),
  ...(snapshot.mysql === undefined
    ? {}
    : { mysql: structuredClone(snapshot.mysql) }),
  ...(snapshot.imap === undefined ? {} : { imap: { ...snapshot.imap } }),
  ...(snapshot.postRunAi === undefined
    ? {}
    : { postRunAi: structuredClone(snapshot.postRunAi) }),
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
  ...(snapshot.missingData === undefined
    ? {}
    : {
        missingData: {
          ...snapshot.missingData,
          locator: structuredClone(snapshot.missingData.locator),
        },
      }),
});

const jsonError = (error: RunnerErrorDetails): JsonValue => ({
  code: error.code,
  message: error.message,
  ...(error.count === undefined ? {} : { count: error.count }),
  ...(error.stepId === undefined ? {} : { stepId: error.stepId }),
});

const configuredPostRunItems = (
  test: TestDefinition,
  selection: StartRunInput["postRun"],
): CheckStep[] => {
  const checks = normalizeTestPostRunChecks(test.postRunChecks);
  const mysqlEnabled = selection?.mysql ?? checks.mysql.enabled;
  const imapEnabled = selection?.imap ?? checks.imap.enabled;
  const result: CheckStep[] = [];
  if (mysqlEnabled && checks.mysql.tableNames.length > 0) {
    result.push({
      id: `post-run:mysql:${test.id}`,
      type: "check",
      checkType: "mysql",
      title: "MySQL snapshot post-run",
      humanDescription:
        "Compară tabelele configurate cu baseline-ul capturat înainte de rulare.",
      config: {
        tableNames: [...checks.mysql.tableNames],
        identities: structuredClone(checks.mysql.identities),
      },
      enabled: true,
    });
  }
  const accountIds = selection?.imapAccountIds ?? checks.imap.accountIds;
  if (imapEnabled && accountIds.length > 0) {
    result.push(
      ...accountIds.map<CheckStep>((accountId, index) => ({
        id: `post-run:imap:${test.id}:${index + 1}`,
        type: "check",
        checkType: "imap",
        title: `Ascultare e-mail post-run ${index + 1}`,
        humanDescription:
          "Așteaptă un mesaj primit după momentul pornirii testului.",
        config: {
          accountId,
          mailbox: checks.imap.mailbox,
          receivedAfterTestStart: true as const,
          ...(checks.imap.sender.length === 0
            ? {}
            : { sender: checks.imap.sender }),
          ...(checks.imap.recipient.length === 0
            ? {}
            : { recipient: checks.imap.recipient }),
          ...(checks.imap.subjectEquals.length === 0
            ? {}
            : { subjectEquals: checks.imap.subjectEquals }),
          ...(checks.imap.subjectContains.length === 0
            ? {}
            : { subjectContains: checks.imap.subjectContains }),
          ...(checks.imap.bodyContains.length === 0
            ? {}
            : { bodyContains: checks.imap.bodyContains }),
        },
        enabled: true,
      })),
    );
  }
  if (result.length === 0 && selection === undefined) {
    return test.flowItems.filter(
      (item): item is CheckStep =>
        item.type === "check" &&
        item.enabled &&
        (item.checkType === "mysql" || item.checkType === "imap"),
    );
  }
  return result;
};

const accountIdForImapStep = (item: CheckStep): string | undefined =>
  "accountId" in item.config ? item.config.accountId : undefined;

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
    const storedTest = this.requireTest(input.projectId, input.testId);
    let test = storedTest;
    let datasetOverrides: Record<string, string> = {};
    if (input.aiPlan !== undefined) {
      if (
        storedTest.testMode !== "dynamic_ai" ||
        input.aiPlan.baseVersion !== storedTest.version ||
        input.aiPlan.instruction.trim().length === 0
      ) {
        throw new Error(
          "Planul AI nu corespunde versiunii curente a testului.",
        );
      }
      const applied = applyAiRunPlan(storedTest, input.aiPlan.proposal);
      test = applied.test;
      datasetOverrides = applied.datasetOverrides;
    }
    const mode = input.mode ?? "automatic";
    if (!(RUN_MODES as readonly string[]).includes(mode)) {
      throw new Error("Modul de rulare nu este valid.");
    }
    const datasets = this.datasetRepository.listByTest(test.id);
    const dataset = this.selectDataset(datasets, input.datasetId);
    this.assertRunnable(test, datasets);
    const datasetValues = {
      ...materializeDataset(dataset, {
        createId: this.options.createId,
        now: this.options.now,
        random: this.options.random ?? Math.random,
      }),
      ...datasetOverrides,
    };
    const startedAt = this.options.now().toISOString();
    const invalidationWarning =
      test.status === "invalidated"
        ? {
            code: "test_invalidated",
            message:
              "Testul rulează cu warning după o schimbare semantică a paginii.",
            ...(test.invalidation === undefined
              ? {}
              : {
                  pageId: test.invalidation.pageId,
                  pageVersionId: test.invalidation.pageVersionId,
                  score: test.invalidation.score,
                  threshold: test.invalidation.threshold,
                }),
          }
        : undefined;
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
      ...(invalidationWarning === undefined
        ? {}
        : { warnings: [invalidationWarning] }),
      datasetSnapshot: {
        ...(dataset === undefined
          ? {}
          : { id: dataset.id, name: dataset.name }),
        values: structuredClone(datasetValues),
      },
    };
    this.runRepository.create(run);
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
        message: "Se verifică sesiunea de browser deschisă.",
        canStop: false,
        canRetry: false,
      });
      await this.prepareBrowser(project, test);
      const page = this.browser.getRunnerPage(project.id);
      const postRunItems = configuredPostRunItems(test, input.postRun);
      const normalizedPostRunChecks = normalizeTestPostRunChecks(
        test.postRunChecks,
      );
      const configuredImapItems = postRunItems.filter(
        (item) => item.checkType === "imap",
      );
      console.info("[IMAP][runner] Configurare la pornirea run-ului", {
        runId: run.id,
        testId: test.id,
        runStartedAt: run.startedAt,
        requested: {
          enabled: input.postRun?.imap ?? false,
          accountIds: input.postRun?.imapAccountIds ?? [],
        },
        saved: {
          enabled: normalizedPostRunChecks.imap.enabled,
          accountIds: normalizedPostRunChecks.imap.accountIds,
          mailbox: normalizedPostRunChecks.imap.mailbox,
        },
        scheduledChecks: configuredImapItems.map((item) => ({
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          mailbox: "mailbox" in item.config ? (item.config.mailbox ?? "") : "",
        })),
      });
      if (input.postRun?.imap === true && configuredImapItems.length === 0) {
        console.warn(
          "[IMAP][runner] IMAP a fost cerut, dar nu a fost programat niciun check. Verifică selecția conturilor.",
          {
            runId: run.id,
            selectedAccountIds: input.postRun.imapAccountIds ?? [],
          },
        );
      }
      const mysqlChecks = postRunItems.filter(
        (item): item is Extract<TestFlowItem, { type: "check" }> =>
          item.type === "check" && item.checkType === "mysql" && item.enabled,
      );
      let mysql: MySqlRunDetails | undefined;
      if (mysqlChecks.length > 0) {
        if (this.options.mysql === undefined) {
          const endedAt = this.options.now().toISOString();
          this.runRepository.updateStatus(run.id, "failed", endedAt);
          throw new StepExecutionError(
            "mysql_failed",
            "Runtime-ul MySQL nu este configurat.",
          );
        }
        try {
          await this.options.mysql.captureBaseline(
            project.id,
            run.id,
            mysqlChecks,
          );
          mysql = this.options.mysql.getRunDetails(run.id);
        } catch (error) {
          const endedAt = this.options.now().toISOString();
          this.runRepository.updateStatus(run.id, "failed", endedAt);
          throw error;
        }
      }
      const snapshot: RunnerSnapshot = {
        state: input.waitBeforeStart === true ? "waiting_for_start" : "running",
        run,
        currentStepIndex: 0,
        totalSteps: test.flowItems.length,
        flowItems: structuredClone(test.flowItems),
        ...(test.flowItems[0] === undefined
          ? {}
          : { currentStepId: test.flowItems[0].id }),
        message:
          input.waitBeforeStart === true
            ? "Browserul este pregătit. Confirmă pornirea testului."
            : input.aiPlan === undefined
              ? "Rularea a început."
              : `Rularea a început cu planul AI: ${input.aiPlan.proposal.summary}`,
        ...(mysql === undefined ? {} : { mysql }),
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
        datasetValues,
        page,
        run,
        snapshot,
        stopRequested: false,
        mode,
        postRunItems,
        postRunIndex: 0,
        postRunAiRequested: input.postRun?.ai === true,
        ...(input.postRun?.provider === undefined
          ? {}
          : { postRunProvider: input.postRun.provider }),
        ...(input.postRun?.model === undefined
          ? {}
          : { postRunModel: input.postRun.model }),
        postRunEvidence: {},
      };
      this.sessions.set(run.id, session);
      this.publish(session, snapshot);
      if (input.waitBeforeStart !== true) {
        void this.continueRun(session);
      }
      return copySnapshot(snapshot);
    } catch (error) {
      const details = this.toRunnerError(error, undefined, "browser_start");
      const endedAt = this.options.now().toISOString();
      this.runRepository.updateStatus(run.id, "failed", endedAt);
      this.persistRunError(run.id, details);
      this.publishForTest(project.id, test.id, {
        state:
          this.browser.getStatus().state === "waiting_for_basic_auth"
            ? "waiting_for_basic_auth"
            : "failed",
        currentStepIndex: -1,
        totalSteps: test.flowItems.length,
        message: details.message,
        error: details,
        run: { ...run, status: "failed", endedAt },
        canStop: false,
        canRetry: false,
      });
      throw error;
    }
  }

  public stop(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (!session.snapshot.canStop) {
      throw new Error("Rularea nu poate fi oprită în starea curentă.");
    }
    if (
      session.pendingImap !== undefined &&
      session.snapshot.state === "waiting_for_imap_check"
    ) {
      return Promise.resolve(this.failPendingImap(session));
    }
    session.stopRequested = true;
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "stopped", endedAt };
    this.runRepository.updateStatus(runId, "stopped", endedAt);
    const snapshotWithoutError = { ...session.snapshot };
    delete snapshotWithoutError.error;
    delete snapshotWithoutError.fallback;
    delete snapshotWithoutError.pause;
    delete snapshotWithoutError.missingData;
    delete session.pendingFallback;
    delete session.pendingMissingData;
    delete session.pendingImap;
    this.publish(session, {
      ...snapshotWithoutError,
      state: "stopped",
      run: session.run,
      message: "Rularea a fost oprită manual.",
      canStop: false,
      canRetry: false,
    });
    return Promise.resolve(copySnapshot(session.snapshot));
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
    this.runRepository.updateError(runId, undefined);
    const retryingSnapshot = { ...session.snapshot };
    delete retryingSnapshot.error;
    this.publish(session, {
      ...retryingSnapshot,
      state: "running",
      run: session.run,
      message: "Se reîncearcă pasul curent.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public skipCurrentStep(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (
      !["paused_on_error", "failed", "waiting_for_fallback_decision"].includes(
        session.snapshot.state,
      )
    ) {
      throw new Error("Pasul curent nu poate fi sărit în starea curentă.");
    }
    const item = session.test.flowItems[session.snapshot.currentStepIndex];
    if (item === undefined) {
      throw new Error("Pasul curent nu mai există.");
    }

    session.stopRequested = false;
    delete session.pendingFallback;
    delete session.pendingMissingData;
    session.run = { ...session.run, status: "running" };
    delete session.run.endedAt;
    this.runRepository.updateStatus(runId, "running");
    const warningMessage = `Pasul ${session.snapshot.currentStepIndex + 1} a fost sărit manual: ${item.title ?? item.id}.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "step_skipped_manually",
      stepId: item.id,
      message: warningMessage,
    });
    this.saveStepResult(
      session,
      item,
      "skipped",
      { logs: [{ level: "warning", message: warningMessage }] },
      this.options.now().toISOString(),
    );
    session.snapshot.currentStepIndex += 1;

    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.error;
    delete resumedSnapshot.fallback;
    delete resumedSnapshot.pause;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      run: session.run,
      message: "Pasul a fost sărit. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public async continueExecution(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (session.snapshot.state === "waiting_for_missing_data") {
      return this.continueMissingData(session);
    }
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

  public previewMySqlCleanup(
    runId: string,
    diffId: string,
    rows: MySqlCleanupRowSelection[],
  ): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (this.options.mysql === undefined) {
      throw new Error("Runtime-ul MySQL nu este configurat.");
    }
    const preview = this.options.mysql.previewCleanup(runId, diffId, rows);
    const details = this.options.mysql.getRunDetails(runId);
    this.publish(session, {
      ...session.snapshot,
      mysql: { ...details, cleanupPreview: preview },
      message: "Preview-ul cleanup este pregătit. Confirmă explicit ștergerea.",
    });
    return copySnapshot(session.snapshot);
  }

  public async confirmMySqlCleanup(
    runId: string,
    previewId: string,
  ): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (this.options.mysql === undefined) {
      throw new Error("Runtime-ul MySQL nu este configurat.");
    }
    await this.options.mysql.confirmCleanup(
      session.project.id,
      runId,
      previewId,
    );
    this.publish(session, {
      ...session.snapshot,
      mysql: this.options.mysql.getRunDetails(runId),
      message: "Cleanup-ul MySQL a fost verificat și finalizat.",
    });
    return copySnapshot(session.snapshot);
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
      const details = this.toRunnerError(
        error,
        pending.item.id,
        `fallback_${pending.item.actionType}`,
      );
      pending.logs.push({
        level: "warning",
        message: `Fallback-ul ${pending.index + 1} a eșuat: ${details.message}`,
      });
      if (session.stopRequested) {
        return copySnapshot(session.snapshot);
      }
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

      if (
        item.type === "check" &&
        (item.checkType === "mysql" || item.checkType === "imap")
      ) {
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
        if (session.stopRequested) return;
        let details = this.toRunnerError(
          error,
          item.id,
          item.type === "action"
            ? item.actionType
            : item.type === "check"
              ? item.checkType
              : item.type,
        );
        if (details.code === "missing_data" && item.type === "action") {
          try {
            const missingData = await inspectMissingInput(session.page, item);
            session.pendingMissingData = {
              item,
              startedAt: stepStartedAt,
              details: missingData,
            };
            const waitingSnapshot = { ...session.snapshot };
            delete waitingSnapshot.pause;
            delete waitingSnapshot.fallback;
            this.publish(session, {
              ...waitingSnapshot,
              state: "waiting_for_missing_data",
              run: session.run,
              message:
                "Completează valoarea direct în browser, apoi apasă Continue.",
              error: details,
              missingData,
              canStop: true,
              canRetry: false,
            });
            return;
          } catch (inspectionError) {
            details = this.toRunnerError(
              inspectionError,
              item.id,
              "inspect_missing_input",
            );
          }
        }
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
          if (session.mode === "automatic") {
            await this.runFallbacksAutomatically(session);
          }
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
        this.persistRunError(session.run.id, details);
        this.publish(session, {
          ...session.snapshot,
          state: "paused_on_error",
          run: session.run,
          message: details.message,
          error: details,
          canStop: true,
          canRetry: details.retryable !== false,
        });
        return;
      }
    }

    if (session.stopRequested) return;
    await this.continuePostRun(session);
  }

  private async continuePostRun(session: RunnerSession): Promise<void> {
    await Promise.resolve();
    console.info("[IMAP][runner] Intrare în etapa post-run", {
      runId: session.run.id,
      nextIndex: session.postRunIndex,
      checks: session.postRunItems.map((item) => ({
        stepId: item.id,
        type: item.checkType,
        accountId:
          item.checkType === "imap"
            ? (accountIdForImapStep(item) ?? "")
            : undefined,
      })),
    });
    while (session.postRunIndex < session.postRunItems.length) {
      if (session.stopRequested) return;
      const item = session.postRunItems[session.postRunIndex];
      if (item === undefined) break;
      const stepStartedAt = this.options.now().toISOString();

      if (item.checkType === "imap") {
        console.info("[IMAP][runner] Check-ul a intrat în așteptare", {
          runId: session.run.id,
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          mailbox: "mailbox" in item.config ? (item.config.mailbox ?? "") : "",
          receivedAfter: session.run.startedAt,
        });
        session.pendingImap = { item, startedAt: stepStartedAt };
        const imap: ImapRunDetails = {
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          status: "waiting",
          message:
            this.options.imap === undefined
              ? "Conectorul IMAP va fi configurat în setările etapelor Y–Z. Poți abandona verificarea pentru această rulare."
              : "Se așteaptă mesajul care corespunde filtrelor IMAP.",
          startedAt: stepStartedAt,
        };
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_for_imap_check",
          imap,
          currentStepId: item.id,
          message: imap.message,
          canStop: true,
          canRetry: false,
        });
        return;
      }

      if (this.options.mysql === undefined) {
        this.failPostRunCheck(
          session,
          item,
          stepStartedAt,
          new StepExecutionError(
            "mysql_failed",
            "Runtime-ul MySQL nu este configurat.",
          ),
        );
        return;
      }

      try {
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_for_mysql_check",
          currentStepId: item.id,
          message: "Se capturează și se compară snapshot-ul MySQL.",
          canStop: true,
          canRetry: false,
        });
        const diff = await this.options.mysql.check(
          session.project.id,
          session.run.id,
          item,
        );
        const inserted = diff.tables.reduce(
          (total, table) => total + table.inserted.length,
          0,
        );
        const deleted = diff.tables.reduce(
          (total, table) => total + table.deleted.length,
          0,
        );
        const updated = diff.tables.reduce(
          (total, table) => total + table.updated.length,
          0,
        );
        this.saveStepResult(
          session,
          item,
          "passed",
          {
            logs: [
              {
                level: "info",
                message: `Diff MySQL: ${inserted} inserate, ${deleted} șterse, ${updated} actualizate.`,
                diffId: diff.id,
              },
            ],
          },
          stepStartedAt,
        );
        session.postRunIndex += 1;
        session.snapshot = {
          ...session.snapshot,
          mysql: this.options.mysql.getRunDetails(session.run.id),
        };
        session.postRunEvidence.mysql = JSON.parse(
          JSON.stringify(session.snapshot.mysql),
        ) as JsonValue;
        this.persistPostRunResult(session);
      } catch (error) {
        this.failPostRunCheck(session, item, stepStartedAt, error);
        return;
      }
    }

    if (session.postRunAiRequested) {
      try {
        await this.evaluatePostRunWithAi(session);
      } catch (error) {
        const details = this.toRunnerError(error, undefined, "post_run_ai");
        const endedAt = this.options.now().toISOString();
        session.run = { ...session.run, status: "failed", endedAt };
        this.runRepository.updateStatus(session.run.id, "failed", endedAt);
        this.persistRunError(session.run.id, details);
        this.publish(session, {
          ...session.snapshot,
          state: "paused_on_error",
          run: session.run,
          error: details,
          message: `Evaluarea AI post-run a eșuat: ${details.message}`,
          canStop: true,
          canRetry: details.retryable !== false,
        });
        return;
      }
    }
    this.finalizeRun(session);
  }

  private async evaluatePostRunWithAi(session: RunnerSession): Promise<void> {
    const checks = normalizeTestPostRunChecks(session.test.postRunChecks);
    const hasEvidence =
      session.postRunEvidence.mysql !== undefined ||
      session.postRunEvidence.imap !== undefined;
    if (!hasEvidence || checks.aiPrompt.length === 0) return;
    if (this.options.postRunAi === undefined) {
      throw new Error("Evaluatorul AI post-run nu este configurat.");
    }
    this.publish(session, {
      ...session.snapshot,
      state: "waiting_for_ai_analysis",
      message: "AI evaluează rezultatele DB și e-mail conform instrucțiunilor.",
      canStop: true,
      canRetry: false,
    });
    const evaluation = await this.options.postRunAi.evaluate({
      projectId: session.project.id,
      testId: session.test.id,
      runId: session.run.id,
      prompt: checks.aiPrompt,
      dataset: {
        ...(session.dataset === undefined
          ? {}
          : { id: session.dataset.id, name: session.dataset.name }),
        values: structuredClone(session.datasetValues),
      },
      evidence: structuredClone(session.postRunEvidence),
      ...(session.postRunProvider === undefined
        ? {}
        : { provider: session.postRunProvider }),
      ...(session.postRunModel === undefined
        ? {}
        : { model: session.postRunModel }),
    });
    session.snapshot = {
      ...session.snapshot,
      postRunAi: evaluation,
    };
    this.persistPostRunResult(session);
    if (evaluation.status === "inconclusive") {
      session.run = this.runRepository.addWarning(session.run.id, {
        code: "post_run_ai_inconclusive",
        status: evaluation.status,
        message: evaluation.summary,
      });
    }
  }

  private failPostRunCheck(
    session: RunnerSession,
    item: CheckStep,
    startedAt: string,
    error: unknown,
  ): void {
    const details = this.toRunnerError(
      error,
      item.id,
      `post_run_${item.checkType}`,
    );
    this.saveStepResult(
      session,
      item,
      "failed",
      { logs: [{ level: "error", message: details.message }] },
      startedAt,
      details,
    );
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, details);
    this.persistPostRunResult(session);
    this.publish(session, {
      ...session.snapshot,
      state: "paused_on_error",
      run: session.run,
      message: details.message,
      error: details,
      ...(this.options.mysql === undefined
        ? session.snapshot.mysql === undefined
          ? {}
          : { mysql: session.snapshot.mysql }
        : { mysql: this.options.mysql.getRunDetails(session.run.id) }),
      canStop: true,
      canRetry: details.retryable !== false,
    });
  }

  private persistPostRunResult(session: RunnerSession): void {
    const result = JSON.parse(
      JSON.stringify({
        evidence: session.postRunEvidence,
        ...(session.snapshot.mysql === undefined
          ? {}
          : { mysql: session.snapshot.mysql }),
        ...(session.snapshot.imap === undefined
          ? {}
          : { imap: session.snapshot.imap }),
        ...(session.snapshot.postRunAi === undefined
          ? {}
          : { ai: session.snapshot.postRunAi }),
      }),
    ) as JsonValue;
    this.runRepository.updatePostRunResult(session.run.id, result);
    session.run = { ...session.run, postRunResult: result };
  }

  private finalizeRun(session: RunnerSession): void {
    this.persistPostRunResult(session);
    const endedAt = this.options.now().toISOString();
    const finalStatus =
      session.snapshot.postRunAi?.status === "failed"
        ? "failed"
        : (session.run.warnings?.length ?? 0) > 0
          ? "passed_with_warnings"
          : "passed";
    session.run = { ...session.run, status: finalStatus, endedAt };
    this.runRepository.updateStatus(session.run.id, finalStatus, endedAt);
    const completedSnapshot = { ...session.snapshot };
    delete completedSnapshot.currentStepId;
    delete completedSnapshot.error;
    delete completedSnapshot.pause;
    delete completedSnapshot.missingData;
    this.publish(session, {
      ...completedSnapshot,
      state: finalStatus === "failed" ? "failed" : "completed",
      run: session.run,
      currentStepIndex: session.test.flowItems.length,
      message:
        finalStatus === "failed"
          ? "Testul a eșuat la evaluarea AI post-run."
          : finalStatus === "passed_with_warnings"
            ? "Testul a trecut cu warning-uri. Verifică etapa post-run."
            : "Testul a trecut. Verifică etapa post-run.",
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

  public async manualWipe(
    runId: string,
    resources: ManualWipeResource[],
  ): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (
      !["completed", "stopped", "failed", "paused_on_error"].includes(
        session.snapshot.state,
      )
    ) {
      throw new Error("Wipe-ul manual este disponibil numai după rulare.");
    }
    if (resources.length === 0) {
      throw new Error("Selectează cel puțin un tip de date pentru wipe.");
    }
    const allowed = new Set<ManualWipeResource>(MANUAL_WIPE_RESOURCES);
    if (resources.some((resource) => !allowed.has(resource))) {
      throw new Error("Selecția pentru wipe conține o resursă necunoscută.");
    }

    let cleanup: WipeDetails;
    try {
      cleanup = await wipeBrowserStateForOrigin(
        this.browser.getRunnerContext(session.project.id),
        session.page,
        session.test.startUrl,
        { reloadStartPage: false, resources },
      );
    } catch (error) {
      cleanup =
        error instanceof WipeError
          ? error.result
          : {
              origin: new URL(session.test.startUrl).origin,
              status: "failed" as const,
              entries: [
                {
                  resource: "navigation" as const,
                  status: "failed" as const,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Curățarea sesiunii a eșuat.",
                },
              ],
            };
    }
    this.publish(session, {
      ...session.snapshot,
      cleanup,
      message:
        cleanup.status === "completed"
          ? "Wipe-ul manual selectat a fost finalizat."
          : "Wipe-ul manual a întâmpinat erori. Verifică rezultatele.",
    });
    return copySnapshot(session.snapshot);
  }

  public async pollImapCheck(runId: string): Promise<RunnerSnapshot> {
    console.info("[IMAP][runner] Poll solicitat de interfață", {
      runId,
      requestedAt: this.options.now().toISOString(),
    });
    const session = this.requireSession(runId);
    const pending = session.pendingImap;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_imap_check"
    ) {
      console.warn("[IMAP][runner] Poll ignorat: nu există un check pending", {
        runId,
        state: session.snapshot.state,
        hasPendingImap: pending !== undefined,
      });
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }

    const checkedAt = this.options.now().toISOString();
    if (this.options.imap === undefined) {
      console.warn("[IMAP][runner] Conectorul IMAP nu este disponibil", {
        runId,
        stepId: pending.item.id,
      });
      this.publish(session, {
        ...session.snapshot,
        imap: {
          ...(session.snapshot.imap ?? {
            stepId: pending.item.id,
            status: "waiting" as const,
            message: "Conectorul IMAP nu este configurat.",
            startedAt: pending.startedAt,
          }),
          lastCheckedAt: checkedAt,
        },
      });
      return copySnapshot(session.snapshot);
    }

    console.info("[IMAP][runner] Execută interogarea IMAP", {
      runId,
      stepId: pending.item.id,
      accountId: accountIdForImapStep(pending.item) ?? "",
      receivedAfter: session.run.startedAt,
    });
    let result: Awaited<ReturnType<RunnerImapGateway["check"]>>;
    try {
      result = await this.options.imap.check(
        session.project.id,
        session.run.id,
        pending.item,
        session.run.startedAt,
      );
    } catch (error) {
      console.error("[IMAP][runner] Interogarea IMAP a eșuat", {
        runId,
        stepId: pending.item.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    console.info("[IMAP][runner] Rezultat poll IMAP", {
      runId,
      stepId: pending.item.id,
      matched: result.matched,
      message: result.message,
      hasEvidence: result.evidence !== undefined,
    });
    if (!result.matched) {
      this.publish(session, {
        ...session.snapshot,
        imap: {
          stepId: pending.item.id,
          accountId: accountIdForImapStep(pending.item) ?? "",
          status: "waiting",
          message: result.message,
          startedAt: pending.startedAt,
          lastCheckedAt: checkedAt,
        },
        message: result.message,
      });
      return copySnapshot(session.snapshot);
    }

    const evidence =
      result.evidence ??
      ({
        matched: true,
        message: result.message,
      } satisfies JsonValue);
    const previousEvidence = session.postRunEvidence.imap;
    const previousChecks =
      typeof previousEvidence === "object" &&
      previousEvidence !== null &&
      !Array.isArray(previousEvidence) &&
      "checks" in previousEvidence &&
      Array.isArray(previousEvidence.checks)
        ? previousEvidence.checks
        : [];
    session.postRunEvidence.imap = {
      checks: [...previousChecks, evidence],
    };
    const evidenceRecord =
      typeof evidence === "object" &&
      evidence !== null &&
      !Array.isArray(evidence)
        ? evidence
        : {};
    const matchedMessages = Array.isArray(evidenceRecord.messages)
      ? (evidenceRecord.messages as unknown as ImapMatchedMessage[])
      : [];
    this.saveStepResult(
      session,
      pending.item,
      "passed",
      {
        logs: [{ level: "info", message: result.message, evidence }],
      },
      pending.startedAt,
    );
    session.postRunIndex += 1;
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "running",
      imap: {
        stepId: pending.item.id,
        accountId: accountIdForImapStep(pending.item) ?? "",
        status: "matched",
        message: result.message,
        startedAt: pending.startedAt,
        lastCheckedAt: checkedAt,
        matchedAt: checkedAt,
        ...(typeof evidenceRecord.accountName === "string"
          ? { accountName: evidenceRecord.accountName }
          : {}),
        ...(matchedMessages.length === 0 ? {} : { matchedMessages }),
      },
      message: result.message,
    });
    this.persistPostRunResult(session);
    await this.continuePostRun(session);
    return copySnapshot(session.snapshot);
  }

  public async abandonImapCheck(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    const pending = session.pendingImap;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_imap_check"
    ) {
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }

    const message = `Verificarea IMAP „${pending.item.title}” a fost abandonată manual.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "imap_check_abandoned",
      stepId: pending.item.id,
      message,
    });
    this.saveStepResult(
      session,
      pending.item,
      "skipped",
      { logs: [{ level: "warning", message }] },
      pending.startedAt,
    );
    session.postRunIndex += 1;
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "running",
      run: session.run,
      imap: {
        stepId: pending.item.id,
        status: "abandoned",
        message,
        startedAt: pending.startedAt,
        lastCheckedAt: this.options.now().toISOString(),
      },
      message,
    });
    this.persistPostRunResult(session);
    await this.continuePostRun(session);
    return copySnapshot(session.snapshot);
  }

  private failPendingImap(session: RunnerSession): RunnerSnapshot {
    const pending = session.pendingImap;
    if (pending === undefined) {
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }
    const endedAt = this.options.now().toISOString();
    const message = `Verificarea IMAP „${pending.item.title}” a fost oprită manual și a eșuat.`;
    const error: RunnerErrorDetails = {
      code: "imap_failed",
      stepId: pending.item.id,
      message,
      operation: "post_run_imap",
      technicalDetails: "Verificarea IMAP a fost oprită manual.",
      occurredAt: endedAt,
      retryable: false,
    };
    this.saveStepResult(
      session,
      pending.item,
      "failed",
      { logs: [{ level: "error", message }] },
      pending.startedAt,
      error,
    );
    session.stopRequested = true;
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, error);
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "failed",
      run: session.run,
      imap: {
        stepId: pending.item.id,
        accountId: accountIdForImapStep(pending.item) ?? "",
        status: "abandoned",
        message,
        startedAt: pending.startedAt,
        lastCheckedAt: endedAt,
      },
      error,
      message,
      canStop: false,
      canRetry: false,
    });
    return copySnapshot(session.snapshot);
  }

  private async continueMissingData(
    session: RunnerSession,
  ): Promise<RunnerSnapshot> {
    const pending = session.pendingMissingData;
    if (pending === undefined) {
      throw new Error("Nu există date lipsă în așteptare.");
    }

    let value: string | number | boolean | null;
    try {
      value = await readManualInputValue(session.page, pending.details);
    } catch (error) {
      const details = this.toRunnerError(error, pending.item.id);
      this.publish(session, {
        ...session.snapshot,
        state: "waiting_for_missing_data",
        message: details.message,
        error: details,
        canStop: true,
        canRetry: false,
      });
      return copySnapshot(session.snapshot);
    }

    this.persistManualValue(session, pending.details.valueKey, value);
    const warningMessage =
      pending.details.inputKind === "password"
        ? `Valoarea pentru ${pending.details.fieldId} a fost colectată manual și salvată local în clar.`
        : `Valoarea pentru ${pending.details.fieldId} a fost colectată manual.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "manual_data_collected",
      stepId: pending.item.id,
      fieldId: pending.details.fieldId,
      message: warningMessage,
    });
    this.saveStepResult(
      session,
      pending.item,
      "passed",
      {
        locatorUsed: JSON.parse(
          JSON.stringify(pending.details.locator),
        ) as JsonValue,
        logs: [{ level: "warning", message: warningMessage }],
      },
      pending.startedAt,
    );
    session.snapshot.currentStepIndex += 1;
    delete session.pendingMissingData;
    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.error;
    delete resumedSnapshot.missingData;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      run: session.run,
      message: "Valoarea manuală a fost salvată. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    if (this.pauseAfterStep(session, pending.item)) {
      return copySnapshot(session.snapshot);
    }
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  private persistManualValue(
    session: RunnerSession,
    valueKey: string,
    value: string | number | boolean | null,
  ): void {
    const now = this.options.now();
    let dataset = session.dataset;
    if (dataset === undefined) {
      dataset = {
        id: this.options.createId(),
        testId: session.test.id,
        name: `Run ${now.toISOString().slice(0, 16).replace("T", " ")}`,
        values: {},
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.datasetRepository.create(dataset);
      this.runRepository.assignDataset(session.run.id, dataset.id);
      session.run = { ...session.run, datasetId: dataset.id };
    }

    const updated: TestDataset = {
      ...dataset,
      values: {
        ...dataset.values,
        [valueKey]: { type: "fixed", value },
      },
      updatedAt: now.toISOString(),
    };
    this.datasetRepository.update(updated);
    session.dataset = updated;
    session.datasetValues[valueKey] = value === null ? "" : String(value);
    const datasetSnapshot = {
      id: updated.id,
      name: updated.name,
      values: structuredClone(session.datasetValues),
    };
    this.runRepository.updateDatasetSnapshot(session.run.id, datasetSnapshot);
    session.run = { ...session.run, datasetSnapshot };
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

  private async runFallbacksAutomatically(
    session: RunnerSession,
  ): Promise<void> {
    while (
      !session.stopRequested &&
      session.pendingFallback !== undefined &&
      session.snapshot.state === "waiting_for_fallback_decision"
    ) {
      await this.runCurrentFallback(session.run.id);
    }
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
    this.persistRunError(session.run.id, exhaustedError);
    delete session.pendingFallback;
    const failedSnapshot = { ...session.snapshot };
    delete failedSnapshot.fallback;
    this.publish(session, {
      ...failedSnapshot,
      state: "paused_on_error",
      run: session.run,
      message: exhaustedError.message,
      error: exhaustedError,
      canStop: true,
      canRetry: exhaustedError.retryable !== false,
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
      throw new StepExecutionError(
        "browser_unavailable",
        "Deschide browserul proiectului din secțiunea Browser înainte să pornești testul.",
      );
    }
    const navigation = await this.browser.openProjectUrl(
      project.id,
      test.startUrl,
    );
    if (navigation.state !== "opened") {
      throw new Error("Autentificarea HTTP trebuie finalizată înainte de run.");
    }
  }

  private assertRunnable(test: TestDefinition, datasets: TestDataset[]): void {
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, test.flowItems, datasets),
    );
    if (
      !validation.valid ||
      (test.status !== "valid" && test.status !== "invalidated") ||
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
    if (datasetId === undefined) return undefined;
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

  private toRunnerError(
    error: unknown,
    stepId?: string,
    operation?: string,
  ): RunnerErrorDetails {
    return classifyRunnerError(error, {
      ...(stepId === undefined ? {} : { stepId }),
      ...(operation === undefined ? {} : { operation }),
      now: this.options.now,
    });
  }

  private persistRunError(runId: string, details: RunnerErrorDetails): void {
    this.runRepository.updateError(
      runId,
      structuredClone(details) as unknown as JsonValue,
    );
  }
}
