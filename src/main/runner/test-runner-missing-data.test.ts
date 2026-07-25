import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Locator, Page } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project, TestDefinition } from "../../shared/persistence.js";
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
  fieldId: "customer_email",
  primary: {
    type: "css" as const,
    operator: "equals" as const,
    value: "#email",
  },
};

const testDefinition = (): TestDefinition => ({
  id: "test-1",
  projectId: project.id,
  name: "Checkout",
  status: "valid",
  version: 2,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/checkout",
  normalizedStartUrl: "https://example.test/checkout",
  workflowState: "ready",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  flowItems: [
    {
      id: "fill-email",
      type: "action",
      actionType: "fill",
      title: "Email",
      humanDescription: "Completează emailul.",
      whyExplanation: "Date client.",
      target,
      inputFieldId: "customer_email",
      valueKey: "customer_email",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    },
  ],
});

const createBrowser = (
  options: {
    checked?: boolean;
    clickFails?: boolean;
    inputType?: string | null;
    inputValue?: string;
    tagName?: string;
  } = {},
) => {
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    fill: vi.fn().mockResolvedValue(undefined),
    click: options.clickFails
      ? vi.fn().mockRejectedValue(new Error("Click failed."))
      : vi.fn().mockResolvedValue(undefined),
    evaluate: vi.fn().mockResolvedValue({
      tagName: options.tagName ?? "input",
      type: options.inputType ?? "text",
    }),
    inputValue: vi.fn().mockResolvedValue(options.inputValue ?? "manual"),
    isChecked: vi.fn().mockResolvedValue(options.checked ?? false),
  } as unknown as Locator;
  const page = {
    locator: vi.fn().mockReturnValue(locator),
    goto: vi.fn().mockResolvedValue(null),
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    url: vi.fn().mockReturnValue(project.normalizedBaseUrl),
  } as unknown as Page;
  const context = {
    clearCookies: vi.fn().mockResolvedValue(undefined),
  } as unknown as BrowserContext;
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
    getStatus: vi
      .fn()
      .mockReturnValue({ state: "running", projectId: project.id }),
    launch: vi.fn(),
    openProjectUrl: vi.fn().mockResolvedValue({
      state: "opened",
      tab: {
        id: "tab-1",
        projectId: project.id,
        url: project.normalizedBaseUrl,
      },
    }),
    getRunnerPage: vi.fn().mockReturnValue(page),
    getRunnerContext: vi.fn().mockReturnValue(context),
  };
  return { browser, locator };
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
  directory = mkdtempSync(join(tmpdir(), "semantic-runner-missing-"));
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
  rmSync(directory, { recursive: true, force: true });
});

const createService = (browser: RunnerBrowserGateway): TestRunnerService =>
  new TestRunnerService(projects, tests, datasets, pages, runs, browser, {
    createId: () => `id-${++nextId}`,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    random: () => 0.5,
  });

describe("TestRunnerService missing data workflow", () => {
  it("uses no dataset explicitly, pauses, creates one and passes", async () => {
    const test = testDefinition();
    tests.create(test);
    datasets.create({
      id: "dataset-existing",
      testId: test.id,
      name: "Existent",
      values: {},
      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
    });
    const harness = createBrowser({ inputValue: "manual@example.test" });
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });

    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_missing_data",
      );
    });
    expect(service.getStatus(project.id, test.id)).toMatchObject({
      run: { status: "running" },
      missingData: {
        fieldId: "customer_email",
        inputKind: "text",
        locator: target.primary,
      },
      canStop: true,
      canRetry: false,
    });

    await service.continueExecution(started.run!.id);
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    const created = datasets
      .listByTest(test.id)
      .find(({ id }) => id !== "dataset-existing");
    expect(created).toMatchObject({
      name: "Run 2026-07-24 12:00",
      values: {
        customer_email: {
          type: "fixed",
          value: "manual@example.test",
        },
      },
    });
    expect(service.getStatus(project.id, test.id).run).toMatchObject({
      datasetId: created?.id,
      status: "passed_with_warnings",
    });
    expect(service.listRuns(project.id, test.id)[0]?.datasetId).toBe(
      created?.id,
    );
  });

  it("updates the selected dataset before a later failure", async () => {
    const test = testDefinition();
    test.flowItems.push({
      id: "click-failing",
      type: "action",
      actionType: "click",
      title: "Fail",
      humanDescription: "Click.",
      whyExplanation: "Test failure.",
      target,
      fallbacks: [],
      enabled: true,
    });
    tests.create(test);
    datasets.create({
      id: "dataset-1",
      testId: test.id,
      name: "Selectat",
      values: {},
      createdAt: test.createdAt,
      updatedAt: test.updatedAt,
    });
    const harness = createBrowser({
      clickFails: true,
      inputValue: "saved-before-failure",
    });
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      datasetId: "dataset-1",
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_missing_data",
      );
    });
    await service.continueExecution(started.run!.id);
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "paused_on_error",
      );
    });

    expect(datasets.findById("dataset-1")?.values).toEqual({
      customer_email: {
        type: "fixed",
        value: "saved-before-failure",
      },
    });
    expect(service.getStatus(project.id, test.id).run?.status).toBe("failed");
  });

  it("keeps the auto-created dataset when stopped after collection", async () => {
    const test = testDefinition();
    test.flowItems.push({
      id: "next",
      type: "action",
      actionType: "scroll",
      title: "Next",
      humanDescription: "Scroll.",
      whyExplanation: "Next step.",
      fallbacks: [],
      enabled: true,
    });
    tests.create(test);
    const harness = createBrowser({ inputValue: "saved-before-stop" });
    const service = createService(harness.browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      mode: "step_by_step",
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_missing_data",
      );
    });
    await service.continueExecution(started.run!.id);
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_after_step",
      );
    });
    service.stop(started.run!.id);

    expect(datasets.listByTest(test.id)[0]?.values).toEqual({
      customer_email: {
        type: "fixed",
        value: "saved-before-stop",
      },
    });
    expect(service.getStatus(project.id, test.id).run?.status).toBe("stopped");
  });

  it.each([
    ["fill", "password", "input", "password", false, "secret", "secret"],
    ["select_option", "select", "select", null, false, "RO", "RO"],
    ["check", "checkbox", "input", "checkbox", true, "on", true],
    ["check", "radio", "input", "radio", true, "premium", "premium"],
  ] as const)(
    "collects %s input as %s",
    async (
      actionType,
      expectedKind,
      tagName,
      inputType,
      checked,
      inputValue,
      expectedValue,
    ) => {
      const test = testDefinition();
      const inputStep = test.flowItems[0];
      if (inputStep?.type !== "action") {
        throw new Error("Missing action fixture.");
      }
      inputStep.actionType = actionType;
      inputStep.valueStrategy = "manual";
      tests.create(test);
      const harness = createBrowser({
        checked,
        inputType,
        inputValue,
        tagName,
      });
      const service = createService(harness.browser);
      const started = await service.start({
        projectId: project.id,
        testId: test.id,
      });
      await vi.waitFor(() => {
        expect(
          service.getStatus(project.id, test.id).missingData?.inputKind,
        ).toBe(expectedKind);
      });

      await service.continueExecution(started.run!.id);
      await vi.waitFor(() => {
        expect(service.getStatus(project.id, test.id).state).toBe("completed");
      });
      expect(datasets.listByTest(test.id)[0]?.values.customer_email).toEqual({
        type: "fixed",
        value: expectedValue,
      });
    },
  );
});
