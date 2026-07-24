import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserManagerStatus } from "../../shared/browser-manager.js";
import type { Project, TestDefinition } from "../../shared/persistence.js";
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
  const page = {
    locator: vi.fn().mockReturnValue(locator),
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
});
