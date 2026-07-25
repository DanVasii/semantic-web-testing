import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserManagerStatus } from "../../shared/browser-manager.js";
import type { Project, TestDefinition } from "../../shared/persistence.js";
import { getContinueShortcut } from "../../shared/shortcuts.js";
import type { ActionType, TestFlowItem } from "../../shared/test-model.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../persistence/database.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../persistence/repositories.js";
import {
  TestRunnerService,
  type RunnerBrowserGateway,
} from "./test-runner-service.js";

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

const target = {
  primary: {
    type: "css" as const,
    operator: "equals" as const,
    value: "#target",
  },
};

const action = (
  id: string,
  actionType: ActionType,
  extra: Partial<Extract<TestFlowItem, { type: "action" }>> = {},
): Extract<TestFlowItem, { type: "action" }> => ({
  id,
  type: "action",
  actionType,
  title: id,
  humanDescription: `Execută ${id}.`,
  whyExplanation: "Este necesar pentru test.",
  fallbacks: [],
  enabled: true,
  ...extra,
});

const fullFlow = (): TestFlowItem[] => [
  action("navigate", "navigate", { url: "https://example.test/products" }),
  action("click", "click", { target }),
  action("fill", "fill", {
    target,
    inputFieldId: "email",
    valueStrategy: "dataset",
    valueKey: "email",
  }),
  action("select", "select_option", {
    target,
    inputFieldId: "country",
    valueStrategy: "dataset",
    valueKey: "country",
  }),
  action("check", "check", { target }),
  action("uncheck", "uncheck", { target }),
  action("press", "press_key", { key: "Enter" }),
  action("scroll", "scroll"),
  action("wait-element", "wait_for_element", { target }),
  action("wait-url", "wait_for_url", {
    url: "https://example.test/checkout",
  }),
];

const createLocator = () => {
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    click: vi.fn().mockResolvedValue(undefined),
    fill: vi.fn().mockResolvedValue(undefined),
    selectOption: vi.fn().mockResolvedValue([]),
    check: vi.fn().mockResolvedValue(undefined),
    uncheck: vi.fn().mockResolvedValue(undefined),
    press: vi.fn().mockResolvedValue(undefined),
    scrollIntoViewIfNeeded: vi.fn().mockResolvedValue(undefined),
    waitFor: vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({
      tagName: "input",
      type: "text",
    }),
    inputValue: vi.fn().mockResolvedValue("manual-value"),
    isChecked: vi.fn().mockResolvedValue(false),
    filter: vi.fn(),
    locator: vi.fn(),
    and: vi.fn(),
  };
  locator.filter.mockReturnValue(locator);
  locator.locator.mockReturnValue(locator);
  locator.and.mockReturnValue(locator);
  return locator;
};

const createHarness = (locator = createLocator()) => {
  const goto = vi.fn().mockResolvedValue(null);
  const waitForURL = vi.fn().mockResolvedValue(undefined);
  const evaluate = vi.fn().mockResolvedValue(undefined);
  const keyboardPress = vi.fn().mockResolvedValue(undefined);
  const mouseWheel = vi.fn().mockResolvedValue(undefined);
  const clearCookies = vi.fn().mockResolvedValue(undefined);
  const pageLocator = vi.fn().mockReturnValue(locator);
  const page = {
    locator: pageLocator,
    goto,
    waitForURL,
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    evaluate,
    keyboard: { press: keyboardPress },
    mouse: { wheel: mouseWheel },
    url: vi.fn().mockReturnValue("https://example.test/checkout"),
  } as unknown as Page;
  const context = {
    clearCookies,
  } as unknown as BrowserContext;
  let status: BrowserManagerStatus = { state: "idle" };
  const browser: RunnerBrowserGateway = {
    detectAvailableBrowsers: vi.fn().mockResolvedValue([
      {
        installationId: "playwright:chromium",
        id: "chromium",
        displayName: "Chromium",
        engine: "chromium",
        source: "playwright",
        installed: true,
        supported: true,
      },
    ]),
    getStatus: vi.fn(() => status),
    launch: vi.fn().mockImplementation(() => {
      status = {
        state: "running",
        projectId: project.id,
        browser: "chromium",
      };
      return Promise.resolve({
        id: "browser-session",
        projectId: project.id,
        browser: "chromium",
        engine: "chromium",
        sessionMode: "temporary",
        startedAt: "2026-07-24T10:00:00.000Z",
      });
    }),
    openProjectUrl: vi.fn().mockResolvedValue({
      state: "opened",
      tab: {
        id: "tab-1",
        projectId: project.id,
        url: "https://example.test/",
      },
    }),
    getRunnerPage: vi.fn().mockReturnValue(page),
    getRunnerContext: vi.fn().mockReturnValue(context),
  };
  return {
    browser,
    context,
    locator,
    page,
    spies: {
      clearCookies,
      evaluate,
      goto,
      keyboardPress,
      mouseWheel,
      pageLocator,
      waitForURL,
    },
  };
};

let directory: string;
let database: ApplicationDatabase;
let projects: ProjectRepository;
let tests: TestRepository;
let datasets: DatasetRepository;
let pages: PageRepository;
let runs: RunRepository;
let nextId: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-runner-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  projects = new ProjectRepository(database.connection);
  tests = new TestRepository(database.connection);
  datasets = new DatasetRepository(database.connection);
  pages = new PageRepository(database.connection);
  runs = new RunRepository(database.connection);
  projects.create(project);
  nextId = 0;
});

afterEach(() => {
  database.close();
  rmSync(directory, { force: true, recursive: true });
});

const createReadyTest = (
  flowItems: TestFlowItem[],
  wipeBeforeRun = false,
): TestDefinition => {
  const test: TestDefinition = {
    id: "test-1",
    projectId: project.id,
    name: "Checkout",
    status: "valid",
    version: 2,
    wipeBeforeRun,
    startMode: "base_url",
    startUrl: "https://example.test/products",
    normalizedStartUrl: "https://example.test/products",
    workflowState: "ready",
    createdAt: "2026-07-24T10:00:00.000Z",
    updatedAt: "2026-07-24T10:00:00.000Z",
    flowItems,
  };
  tests.create(test);
  return test;
};

const createService = (browser: RunnerBrowserGateway): TestRunnerService =>
  new TestRunnerService(projects, tests, datasets, pages, runs, browser, {
    createId: () => `id-${++nextId}`,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    random: () => 0.5,
  });

describe("TestRunnerService", () => {
  it("executes K7-K16, loads the dataset and persists a passed run with logs", async () => {
    const test = createReadyTest(fullFlow(), true);
    datasets.create({
      id: "dataset-1",
      testId: test.id,
      name: "Principal",
      values: {
        email: "ana@example.test",
        country: "RO",
      },
      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
    });
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      datasetId: "dataset-1",
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(started.run?.datasetId).toBe("dataset-1");
    expect(harness.spies.clearCookies).toHaveBeenCalledOnce();
    const cookieFilter = harness.spies.clearCookies.mock.calls[0]?.[0] as
      { domain?: RegExp } | undefined;
    expect(cookieFilter?.domain?.test(".example.test")).toBe(true);
    expect(cookieFilter?.domain?.test("other.test")).toBe(false);
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();
    expect(harness.spies.goto).toHaveBeenCalledTimes(2);
    expect(harness.locator.click).toHaveBeenCalledOnce();
    expect(harness.locator.fill).toHaveBeenCalledWith("ana@example.test");
    expect(harness.locator.selectOption).toHaveBeenCalledWith("RO");
    expect(harness.locator.check).toHaveBeenCalledOnce();
    expect(harness.locator.uncheck).toHaveBeenCalledOnce();
    expect(harness.spies.keyboardPress).toHaveBeenCalledWith("Enter");
    expect(harness.spies.mouseWheel).toHaveBeenCalledWith(0, 700);
    expect(harness.locator.waitFor).toHaveBeenCalledOnce();
    expect(harness.spies.waitForURL).toHaveBeenCalledWith(
      "https://example.test/checkout",
    );
    expect(service.listRuns(project.id, test.id)[0]?.status).toBe("passed");
    const results = service.listStepResults(
      project.id,
      test.id,
      started.run?.id ?? "",
    );
    expect(results).toHaveLength(10);
    expect(results.every((result) => result.status === "passed")).toBe(true);
    expect(results.every((result) => result.logs.length > 0)).toBe(true);
  });

  it("blocks on locator ambiguity, saves failure and retries the current step", async () => {
    const test = createReadyTest([action("click", "click", { target })]);
    const locator = createLocator();
    locator.count.mockResolvedValue(2);
    const harness = createHarness(locator);
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "paused_on_error",
      );
    });
    const failed = service.getStatus(project.id, test.id);
    expect(failed.error).toMatchObject({
      code: "locator_ambiguous",
      count: 2,
    });
    expect(failed.run?.status).toBe("failed");
    expect(failed.canRetry).toBe(true);

    locator.count.mockResolvedValue(1);
    service.retry(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? ""),
    ).toHaveLength(2);
  });

  it("stops a running test manually and leaves the browser session available", async () => {
    const test = createReadyTest([action("click", "click", { target })]);
    let releaseClick: (() => void) | undefined;
    const locator = createLocator();
    locator.click.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseClick = resolve;
        }),
    );
    const harness = createHarness(locator);
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(releaseClick).toBeTypeOf("function");
    });
    const stopped = service.stop(started.run?.id ?? "");
    expect(stopped.state).toBe("stopped");
    expect(stopped.run?.status).toBe("stopped");
    releaseClick?.();
    await vi.waitFor(() => {
      expect(
        service.listStepResults(project.id, test.id, started.run?.id ?? "")[0]
          ?.status,
      ).toBe("stopped");
    });
    expect(harness.browser.getStatus().state).toBe("running");
  });

  it("waits for a fallback decision, runs it and persists the used locator and warning", async () => {
    const fallbackLocator = {
      type: "css" as const,
      operator: "equals" as const,
      value: "#fallback",
    };
    const test = createReadyTest([
      action("click", "click", {
        target,
        fallbacks: [
          {
            locator: fallbackLocator,
            humanDescription: "Buton alternativ",
            whyExplanation: "Folosit când selectorul principal lipsește.",
          },
        ],
      }),
    ]);
    const primary = createLocator();
    primary.count.mockResolvedValue(0);
    const fallback = createLocator();
    const harness = createHarness(primary);
    harness.spies.pageLocator.mockImplementation((selector: string) =>
      selector === "#fallback" ? fallback : primary,
    );
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_fallback_decision",
      );
    });
    expect(service.getStatus(project.id, test.id).fallback).toMatchObject({
      index: 0,
      total: 1,
      humanDescription: "Buton alternativ",
      locator: fallbackLocator,
    });

    await service.runCurrentFallback(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    const completedRun = service.listRuns(project.id, test.id)[0];
    expect(completedRun).toMatchObject({
      status: "passed_with_warnings",
      warnings: [
        expect.objectContaining({
          code: "fallback_used",
          fallbackIndex: 0,
        }),
      ],
    });
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({
      status: "passed_with_fallback",
      fallbackIndex: 0,
      locatorUsed: fallbackLocator,
    });
    expect(fallback.click).toHaveBeenCalledOnce();
  });

  it("skips to the next fallback and fails after all fallbacks are exhausted", async () => {
    const test = createReadyTest([
      action("click", "click", {
        target,
        fallbacks: [
          {
            locator: {
              type: "css",
              operator: "equals",
              value: "#fallback-1",
            },
            humanDescription: "Fallback unu",
            whyExplanation: "Prima alternativă.",
          },
          {
            locator: {
              type: "css",
              operator: "equals",
              value: "#fallback-2",
            },
            humanDescription: "Fallback doi",
            whyExplanation: "A doua alternativă.",
          },
        ],
      }),
    ]);
    const missing = createLocator();
    missing.count.mockResolvedValue(0);
    const harness = createHarness(missing);
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).fallback?.index).toBe(0);
    });
    const second = service.skipCurrentFallback(started.run?.id ?? "");
    expect(second).toMatchObject({
      state: "waiting_for_fallback_decision",
      fallback: { index: 1, total: 2 },
    });
    const exhausted = service.skipCurrentFallback(started.run?.id ?? "");
    expect(exhausted).toMatchObject({
      state: "failed",
      run: { status: "failed" },
      canRetry: false,
    });
    expect(exhausted.message).toContain(
      "Toate fallback-urile au fost epuizate",
    );
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({ status: "failed" });
  });

  it("automatically offers the next fallback when the current one fails", async () => {
    const test = createReadyTest([
      action("click", "click", {
        target,
        fallbacks: [
          {
            locator: {
              type: "css",
              operator: "equals",
              value: "#missing-fallback",
            },
            humanDescription: "Fallback lipsă",
            whyExplanation: "Prima alternativă.",
          },
          {
            locator: {
              type: "css",
              operator: "equals",
              value: "#working-fallback",
            },
            humanDescription: "Fallback funcțional",
            whyExplanation: "A doua alternativă.",
          },
        ],
      }),
    ]);
    const missing = createLocator();
    missing.count.mockResolvedValue(0);
    const working = createLocator();
    const harness = createHarness(missing);
    harness.spies.pageLocator.mockImplementation((selector: string) =>
      selector === "#working-fallback" ? working : missing,
    );
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).fallback?.index).toBe(0);
    });

    const nextFallback = await service.runCurrentFallback(
      started.run?.id ?? "",
    );
    expect(nextFallback).toMatchObject({
      state: "waiting_for_fallback_decision",
      fallback: { index: 1 },
    });
    await service.runCurrentFallback(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(working.click).toHaveBeenCalledOnce();
  });

  it("stops exactly at an enabled breakpoint and continues on command", async () => {
    const test = createReadyTest([
      {
        id: "breakpoint-1",
        type: "breakpoint",
        title: "Verifică pagina",
        instructions: "Confirmă vizual coșul.",
        enabled: true,
      },
      action("scroll", "scroll"),
    ]);
    const harness = createHarness();
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      mode: "breakpoints",
    });

    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_at_breakpoint",
      );
    });
    expect(service.getStatus(project.id, test.id).pause).toMatchObject({
      kind: "breakpoint",
      title: "Verifică pagina",
      instructions: "Confirmă vizual coșul.",
      nextStepId: "scroll",
    });
    expect(harness.spies.mouseWheel).not.toHaveBeenCalled();

    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.mouseWheel).toHaveBeenCalledOnce();
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({
      stepId: "breakpoint-1",
      status: "passed",
    });
  });

  it("pauses after every action in step-by-step mode", async () => {
    const test = createReadyTest([
      action("scroll-1", "scroll"),
      action("scroll-2", "scroll"),
    ]);
    const harness = createHarness();
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      mode: "step_by_step",
    });

    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_after_step",
      );
    });
    expect(service.getStatus(project.id, test.id).pause).toMatchObject({
      kind: "after_step",
      previousStepId: "scroll-1",
      nextStepId: "scroll-2",
    });
    expect(harness.spies.mouseWheel).toHaveBeenCalledOnce();

    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.mouseWheel).toHaveBeenCalledTimes(2);
  });

  it("waits before the first step when manual start is configured", async () => {
    const test = createReadyTest([action("scroll", "scroll")]);
    const harness = createHarness();
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      waitBeforeStart: true,
    });

    expect(started).toMatchObject({
      state: "waiting_for_start",
      pause: {
        kind: "before_start",
        nextStepId: "scroll",
      },
    });
    expect(harness.spies.mouseWheel).not.toHaveBeenCalled();
    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.mouseWheel).toHaveBeenCalledOnce();
  });

  it("persists the Continue shortcut and rejects conflicts", () => {
    projects.update({
      ...project,
      shortcutConfig: {
        stopRun: "Alt+S",
      },
    });
    const service = createService(createHarness().browser);

    expect(
      service.configureContinueShortcut(project.id, "control + enter"),
    ).toBe("Ctrl+Enter");
    expect(
      getContinueShortcut(projects.findById(project.id)?.shortcutConfig ?? {}),
    ).toBe("Ctrl+Enter");
    expect(() =>
      service.configureContinueShortcut(project.id, "alt+s"),
    ).toThrow("este deja folosit de acțiunea stopRun");
  });
});
