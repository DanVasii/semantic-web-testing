import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserContext, Page, Request } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { BrowserManagerStatus } from "../../shared/browser-manager.js";
import type { Project, TestDefinition } from "../../shared/persistence.js";
import type { MySqlRunDetails } from "../../shared/mysql.js";
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
import { RunArtifactRepository } from "../persistence/suite-repositories.js";
import {
  TestRunnerService,
  type RunnerBrowserGateway,
  type RunnerImapGateway,
  type RunnerMySqlGateway,
  type RunnerPostRunAiGateway,
  type RunnerVisualCheckGateway,
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
    selectOption: vi.fn().mockImplementation((option: unknown) => {
      if (typeof option === "string") return Promise.resolve([option]);
      if (
        typeof option === "object" &&
        option !== null &&
        "value" in option &&
        typeof option.value === "string"
      ) {
        return Promise.resolve([option.value]);
      }
      return Promise.resolve([]);
    }),
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
    innerText: vi.fn().mockResolvedValue(""),
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

const createHarness = (
  locator = createLocator(),
  initialStatus: BrowserManagerStatus = {
    state: "running",
    projectId: project.id,
    browser: "chromium",
  },
) => {
  const goto = vi.fn().mockResolvedValue(null);
  const waitForURL = vi.fn().mockResolvedValue(undefined);
  const evaluate = vi.fn().mockResolvedValue([
    {
      resource: "localStorage",
      status: "cleared",
      message: "localStorage a fost șters.",
      count: 1,
    },
    {
      resource: "sessionStorage",
      status: "cleared",
      message: "sessionStorage a fost șters.",
      count: 1,
    },
    {
      resource: "indexedDB",
      status: "cleared",
      message: "Bazele IndexedDB au fost șterse.",
      count: 1,
    },
    {
      resource: "cacheStorage",
      status: "cleared",
      message: "Cache Storage a fost șters.",
      count: 1,
    },
    {
      resource: "serviceWorkers",
      status: "cleared",
      message: "Service workers au fost șterși.",
      count: 1,
    },
    {
      resource: "permissions",
      status: "skipped",
      message: "Permisiunile altor origin-uri sunt păstrate.",
    },
  ]);
  const keyboardPress = vi.fn().mockResolvedValue(undefined);
  const mouseWheel = vi.fn().mockResolvedValue(undefined);
  const mouseClick = vi.fn().mockResolvedValue(undefined);
  const waitForTimeout = vi.fn().mockResolvedValue(undefined);
  const setContent = vi.fn().mockResolvedValue(undefined);
  const screenshot = vi.fn().mockResolvedValue(Buffer.from("full-page-jpeg"));
  const content = vi
    .fn()
    .mockResolvedValue("<html><body>Checkout</body></html>");
  const eventHandlers = new Map<string, (value: unknown) => void>();
  const on = vi.fn((event: string, handler: (value: unknown) => void): void => {
    eventHandlers.set(event, handler);
  });
  let cookieJar = [
    {
      name: "session",
      value: "one",
      domain: ".example.test",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ];
  const clearCookies = vi.fn().mockImplementation(() => {
    cookieJar = [];
    return Promise.resolve();
  });
  const cookies = vi.fn().mockImplementation(() => Promise.resolve(cookieJar));
  const pageLocator = vi.fn().mockReturnValue(locator);
  const page = {
    locator: pageLocator,
    goto,
    waitForURL,
    waitForLoadState: vi.fn().mockResolvedValue(undefined),
    waitForTimeout,
    evaluate,
    setContent,
    screenshot,
    content,
    on,
    keyboard: { press: keyboardPress },
    mouse: { click: mouseClick, wheel: mouseWheel },
    url: vi.fn().mockReturnValue("https://example.test/checkout"),
  } as unknown as Page;
  const tracingStart = vi.fn().mockResolvedValue(undefined);
  const tracingStop = vi
    .fn()
    .mockImplementation((options?: { path?: string }) => {
      if (options?.path !== undefined) writeFileSync(options.path, "trace");
      return Promise.resolve();
    });
  const context = {
    clearCookies,
    cookies,
    tracing: { start: tracingStart, stop: tracingStop },
  } as unknown as BrowserContext;
  let status: BrowserManagerStatus = initialStatus;
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
    eventHandlers,
    locator,
    page,
    spies: {
      clearCookies,
      cookies,
      content,
      evaluate,
      goto,
      keyboardPress,
      mouseClick,
      mouseWheel,
      pageLocator,
      setContent,
      screenshot,
      tracingStart,
      tracingStop,
      waitForTimeout,
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
    testMode: "recorded",
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

const createService = (
  browser: RunnerBrowserGateway,
  mysql?: RunnerMySqlGateway,
  imap?: RunnerImapGateway,
  postRunAi?: RunnerPostRunAiGateway,
  visualCheck?: RunnerVisualCheckGateway,
  diagnostics?: {
    artifactRoot: string;
    artifacts: RunArtifactRepository;
  },
): TestRunnerService =>
  new TestRunnerService(projects, tests, datasets, pages, runs, browser, {
    createId: () => `id-${++nextId}`,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    random: () => 0.5,
    ...(mysql === undefined ? {} : { mysql }),
    ...(imap === undefined ? {} : { imap }),
    ...(postRunAi === undefined ? {} : { postRunAi }),
    ...(visualCheck === undefined ? {} : { visualCheck }),
    ...(diagnostics === undefined ? {} : diagnostics),
  });

describe("TestRunnerService", () => {
  it("saves a complete diagnostic package and Playwright trace on failure", async () => {
    const failingLocator = createLocator();
    failingLocator.count.mockResolvedValue(0);
    const failingTest = createReadyTest([
      action("missing-button", "click", { target }),
    ]);
    const harness = createHarness(failingLocator);
    const artifacts = new RunArtifactRepository(database.connection);
    const artifactRoot = join(directory, "artifacts");
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      undefined,
      { artifactRoot, artifacts },
    );

    const started = await service.start({
      projectId: project.id,
      testId: failingTest.id,
      waitBeforeStart: true,
    });
    harness.eventHandlers.get("console")?.({
      type: () => "error",
      text: () => "Checkout crashed",
      location: () => ({ url: "https://example.test/checkout", lineNumber: 8 }),
    });
    harness.eventHandlers.get("requestfailed")?.({
      method: () => "POST",
      url: () => "https://example.test/api/order",
      failure: () => ({ errorText: "net::ERR_FAILED" }),
    });
    await service.continueExecution(started.run!.id);

    await vi.waitFor(() => {
      expect(service.getStatus(project.id, failingTest.id).state).toBe(
        "paused_on_error",
      );
      expect(artifacts.listByRun(started.run!.id)).toHaveLength(5);
    });
    const saved = artifacts.listByRun(started.run!.id);
    expect(saved.map(({ kind }) => kind).sort()).toEqual([
      "console",
      "html",
      "network",
      "screenshot",
      "trace",
    ]);
    expect(
      readFileSync(
        saved.find(({ kind }) => kind === "console")!.filePath,
        "utf8",
      ),
    ).toContain("Checkout crashed");
    expect(
      readFileSync(
        saved.find(({ kind }) => kind === "network")!.filePath,
        "utf8",
      ),
    ).toContain("net::ERR_FAILED");
    expect(harness.spies.tracingStart).toHaveBeenCalledWith({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    expect(harness.spies.tracingStop).toHaveBeenCalledWith({
      path: saved.find(({ kind }) => kind === "trace")!.filePath,
    });
  });

  it("captures the full page and passes a visual AI verdict", async () => {
    const test = createReadyTest([
      {
        id: "visual-check",
        type: "check",
        checkType: "visual",
        title: "Confirmă rezultatul",
        humanDescription: "Pagina arată confirmarea corectă.",
        config: {
          prompt: "Confirmă că pagina arată o comandă finalizată cu succes.",
          minimumConfidence: 0.7,
        },
        timeoutMs: 5_000,
        enabled: true,
      },
    ]);
    const harness = createHarness();
    const evaluate = vi.fn().mockResolvedValue({
      provider: "lm_studio" as const,
      model: "gemma-vision",
      passed: true,
      confidence: 0.92,
      explanation: "Este vizibilă confirmarea comenzii.",
      evidence: ["Comandă finalizată"],
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    });
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate },
    );

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(harness.spies.screenshot).toHaveBeenCalledWith({
      clip: { x: 0, y: 0, width: 1920, height: 1080 },
      type: "jpeg",
      quality: 70,
      animations: "disabled",
      caret: "hide",
    });
    expect(evaluate).toHaveBeenCalledWith({
      prompt: "Confirmă că pagina arată o comandă finalizată cu succes.",
      imagesBase64: [
        Buffer.from("full-page-jpeg").toString("base64"),
        Buffer.from("full-page-jpeg").toString("base64"),
      ],
      mimeType: "image/jpeg",
    });
    const results = service.listStepResults(
      project.id,
      test.id,
      started.run?.id ?? "",
    );
    expect(results).toEqual([
      expect.objectContaining({ stepId: "visual-check", status: "passed" }),
    ]);
    expect(results[0]?.logs[0]).toMatchObject({
      visualCheckDebug: {
        dataUrls: [
          `data:image/jpeg;base64,${Buffer.from("full-page-jpeg").toString("base64")}`,
          `data:image/jpeg;base64,${Buffer.from("full-page-jpeg").toString("base64")}`,
        ],
        mimeType: "image/jpeg",
        byteLength: Buffer.from("full-page-jpeg").byteLength * 2,
        prompt: "Confirmă că pagina arată o comandă finalizată cu succes.",
      },
    });
  });

  it("replays only flow actions and skips checks for recording continuation", async () => {
    const test = createReadyTest([
      action("scroll-page", "scroll"),
      {
        id: "visual-check",
        type: "check",
        checkType: "visual",
        title: "Check omis",
        humanDescription: "Nu trebuie executat în replay.",
        config: { prompt: "Nu executa", minimumConfidence: 0.7 },
        enabled: true,
      },
    ]);
    const harness = createHarness();
    const evaluate = vi.fn();
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate },
    );

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      flowOnly: true,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(
      service
        .listStepResults(project.id, test.id, started.run!.id)
        .map(({ stepId, status }) => ({ stepId, status })),
    ).toEqual([
      { stepId: "scroll-page", status: "passed" },
      { stepId: "visual-check", status: "skipped" },
    ]);
  });

  it("pauses replay for a manual intervention and resumes after confirmation", async () => {
    const test = createReadyTest([
      {
        id: "manual-login",
        type: "manual_intervention",
        title: "Confirmă autentificarea",
        instructions: "Finalizează autentificarea în browser.",
        humanDescription: "Utilizatorul confirmă autentificarea.",
        whyExplanation: "Pasul necesită intervenție umană.",
        enabled: true,
      },
    ]);
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      flowOnly: true,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id)).toMatchObject({
        state: "waiting_for_manual_intervention",
        pause: {
          kind: "manual_intervention",
          instructions: "Finalizează autentificarea în browser.",
        },
      });
    });

    await service.continueExecution(started.run!.id);
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(
      service.listStepResults(project.id, test.id, started.run!.id)[0],
    ).toMatchObject({ stepId: "manual-login", status: "passed" });
  });

  it("uses the full viewport when a visual AI action has no saved region", async () => {
    const test = createReadyTest([
      action("visual-calendar", "visual_ai", {
        visualInstruction:
          "Mergi la luna următoare și selectează prima zi disponibilă.",
      }),
    ]);
    const harness = createHarness();
    const clickRequest = {
      resourceType: () => "xhr",
    } as Request;
    harness.spies.mouseClick.mockImplementation(() => {
      harness.eventHandlers.get("request")?.(clickRequest);
      setTimeout(() => {
        harness.eventHandlers.get("requestfinished")?.(clickRequest);
      }, 0);
      return Promise.resolve();
    });
    harness.spies.evaluate.mockResolvedValue({
      width: 1000,
      height: 800,
      scrollX: 0,
      scrollY: 0,
    });
    const decide = vi
      .fn()
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-vision",
        status: "click",
        x: 0.8,
        y: 0.2,
        confidence: 0.91,
        observation: "Butonul luna următoare este vizibil.",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      })
      .mockResolvedValueOnce({
        provider: "openai",
        model: "gpt-vision",
        status: "done",
        confidence: 0.95,
        observation: "Data disponibilă este selectată.",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      });
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate: vi.fn(), decide },
    );

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(decide).toHaveBeenCalledTimes(2);
    expect(decide.mock.calls[1]?.[0]).toMatchObject({
      actionCount: 1,
      maxActions: 5,
      history: [expect.objectContaining({ actionNumber: 1, x: 0.8, y: 0.2 })],
    });
    expect(harness.spies.screenshot).toHaveBeenCalledWith({
      type: "jpeg",
      quality: 80,
    });
    expect(harness.spies.mouseClick).toHaveBeenCalledWith(800, 160);
    expect(harness.spies.waitForTimeout).toHaveBeenCalledWith(2_000);
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0]
        ?.logs,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ observedRequests: 1, settled: true }),
      ]),
    );
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({ stepId: "visual-calendar", status: "passed" });
  });

  it("keeps a recorded Google Pay click runnable when CDP diagnostics are unavailable", async () => {
    const test = createReadyTest([
      action("google-pay", "click", {
        title: "Apasă Google Pay",
        humanDescription: "Deschide Google Pay.",
        target: {
          primary: {
            type: "css",
            operator: "equals",
            value: "#google-pay",
          },
        },
      }),
    ]);
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    const result = service.listStepResults(
      project.id,
      test.id,
      started.run?.id ?? "",
    )[0];
    expect(result).toMatchObject({ stepId: "google-pay", status: "passed" });
    expect(harness.locator.click).toHaveBeenCalledOnce();
  });

  it("waits and recaptures loading states without consuming click attempts", async () => {
    const test = createReadyTest([
      action("visual-loading", "visual_ai", {
        visualInstruction: "Încarcă și selectează o dată disponibilă.",
      }),
    ]);
    const harness = createHarness();
    harness.spies.evaluate.mockResolvedValue({
      width: 1000,
      height: 800,
      scrollX: 0,
      scrollY: 0,
    });
    const visualResult = (status: "loading" | "done") => ({
      provider: "gemini" as const,
      model: "gemini-2.5-flash",
      status,
      confidence: 0.9,
      observation:
        status === "loading" ? "Este vizibil un spinner." : "Lista este gata.",
      usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
    });
    const decide = vi
      .fn()
      .mockResolvedValueOnce(visualResult("loading"))
      .mockResolvedValueOnce(visualResult("loading"))
      .mockResolvedValueOnce(visualResult("done"));
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate: vi.fn(), decide },
    );

    await service.start({ projectId: project.id, testId: test.id });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(decide).toHaveBeenCalledTimes(3);
    expect(decide).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ actionCount: 0 }),
    );
    expect(decide).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ actionCount: 0 }),
    );
    expect(decide).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ actionCount: 0 }),
    );
    expect(harness.spies.waitForTimeout).toHaveBeenCalledWith(2_000);
    expect(harness.spies.mouseClick).not.toHaveBeenCalled();
    const aiRequests = service.getStatus(project.id, test.id).aiCost?.requests;
    expect(aiRequests).toHaveLength(3);
    expect(aiRequests?.[0]).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      totalTokens: 28,
    });
    expect(aiRequests?.[0]?.reason).toContain("primei acțiuni");
    expect(JSON.stringify(aiRequests?.[0]?.response)).toContain(
      '"status":"loading"',
    );
    expect(JSON.stringify(aiRequests?.[0]?.payload)).toContain(
      "Încarcă și selectează o dată disponibilă.",
    );
    expect(JSON.stringify(aiRequests?.[0]?.payload)).toContain("imagine omisă");
    expect(aiRequests?.[1]?.reason).toContain("retry 1/5");
    expect(aiRequests?.[2]?.reason).toContain("retry 2/5");
  });

  it("pauses a visible page error as a continuable warning", async () => {
    const test = createReadyTest([
      action("visual-error", "visual_ai", {
        visualInstruction: "Selectează o dată disponibilă.",
      }),
    ]);
    const harness = createHarness();
    harness.spies.evaluate.mockResolvedValue({
      width: 1000,
      height: 800,
      scrollX: 0,
      scrollY: 0,
    });
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      {
        evaluate: vi.fn(),
        decide: vi.fn().mockResolvedValue({
          provider: "gemini",
          model: "gemini-2.5-flash",
          status: "error",
          confidence: 0.96,
          observation: "Serviciul de disponibilitate nu răspunde.",
          usage: { inputTokens: 20, outputTokens: 8, totalTokens: 28 },
        }),
      },
    );

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "paused_on_error",
      );
    });
    const warningError = service.getStatus(project.id, test.id).error;
    expect(warningError?.severity).toBe("warning");
    expect(warningError?.retryable).toBe(true);
    expect(warningError?.message).toContain("Serviciul de disponibilitate");

    if (started.run === undefined) throw new Error("Run was not created.");
    service.skipCurrentStep(started.run.id);
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(service.getStatus(project.id, test.id).run?.warnings).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "step_skipped_manually" }),
      ]),
    );
  });

  it("keeps the screenshot sent by a failed visual AI action", async () => {
    const test = createReadyTest([
      action("visual-calendar", "visual_ai", {
        visualInstruction: "Selectează prima dată disponibilă.",
      }),
    ]);
    const harness = createHarness();
    harness.spies.evaluate.mockResolvedValue({
      width: 1000,
      height: 800,
      scrollX: 0,
      scrollY: 0,
    });
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      {
        evaluate: vi.fn(),
        decide: vi
          .fn()
          .mockRejectedValue(new Error("Gemini a returnat JSON incomplet.")),
      },
    );

    await service.start({ projectId: project.id, testId: test.id });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "paused_on_error",
      );
    });

    expect(
      service.getStatus(project.id, test.id).error?.visualCheckDebug,
    ).toEqual({
      dataUrls: [
        `data:image/jpeg;base64,${Buffer.from("full-page-jpeg").toString("base64")}`,
      ],
      mimeType: "image/jpeg",
      byteLength: Buffer.from("full-page-jpeg").byteLength,
      prompt: "Selectează prima dată disponibilă.",
    });
  });

  it("keeps the exact AI screenshot in the error snapshot when visual evaluation fails", async () => {
    const test = createReadyTest([
      {
        id: "visual-check",
        type: "check",
        checkType: "visual",
        title: "Confirmă validarea",
        humanDescription: "Verifică mesajul vizual.",
        config: { prompt: "Trebuie să apară Telefon invalid." },
        timeoutMs: 5_000,
        enabled: true,
      },
    ]);
    const harness = createHarness();
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      {
        evaluate: vi
          .fn()
          .mockRejectedValue(
            new Error("LM Studio nu a returnat verdictul vizual."),
          ),
      },
    );

    await service.start({ projectId: project.id, testId: test.id });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "paused_on_error",
      );
    });

    expect(
      service.getStatus(project.id, test.id).error?.visualCheckDebug,
    ).toEqual({
      dataUrls: [
        `data:image/jpeg;base64,${Buffer.from("full-page-jpeg").toString("base64")}`,
        `data:image/jpeg;base64,${Buffer.from("full-page-jpeg").toString("base64")}`,
      ],
      mimeType: "image/jpeg",
      byteLength: Buffer.from("full-page-jpeg").byteLength * 2,
      prompt: "Trebuie să apară Telefon invalid.",
    });
  });

  it("uses deterministic DOM text for an adaptive check with explicit messages", async () => {
    const test = createReadyTest([
      {
        id: "adaptive-check",
        type: "check",
        checkType: "adaptive",
        title: "Confirmă validarea telefonului",
        humanDescription: "Trebuie să apară mesajul Telefon invalid.",
        config: {
          strategy: "auto",
          expectedTexts: ["Telefon invalid"],
          matchMode: "any",
          caseSensitive: false,
          ignoreDiacritics: true,
          visualPrompt: "Confirmă că utilizatorul este avertizat.",
          visualFallback: true,
          minimumConfidence: 0.6,
        },
        timeoutMs: 0,
        enabled: true,
      },
    ]);
    const harness = createHarness();
    harness.locator.innerText.mockResolvedValue("Telefon invalid");
    const evaluate = vi.fn();
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate },
    );

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(harness.spies.screenshot).not.toHaveBeenCalled();
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? ""),
    ).toEqual([
      expect.objectContaining({ stepId: "adaptive-check", status: "passed" }),
    ]);
  });

  it("uses the visual fallback when adaptive DOM evidence is missing", async () => {
    const test = createReadyTest([
      {
        id: "adaptive-fallback",
        type: "check",
        checkType: "adaptive",
        title: "Confirmă validarea",
        humanDescription: "Utilizatorul trebuie avertizat.",
        config: {
          strategy: "auto",
          expectedTexts: ["Telefon invalid"],
          matchMode: "any",
          visualPrompt: "Confirmă vizual avertizarea pentru telefon invalid.",
          visualFallback: true,
          minimumConfidence: 0.6,
        },
        timeoutMs: 0,
        enabled: true,
      },
    ]);
    const harness = createHarness();
    harness.locator.innerText.mockResolvedValue("Formular de contact");
    const evaluate = vi.fn().mockResolvedValue({
      provider: "gemini" as const,
      model: "gemini-vision",
      passed: true,
      confidence: 0.85,
      explanation: "Avertizarea este vizibilă.",
      evidence: ["Câmp invalid"],
      usage: { inputTokens: 80, outputTokens: 15, totalTokens: 95 },
    });
    const service = createService(
      harness.browser,
      undefined,
      undefined,
      undefined,
      { evaluate },
    );

    await service.start({ projectId: project.id, testId: test.id });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(evaluate).toHaveBeenCalledOnce();
    expect(harness.spies.screenshot).toHaveBeenCalledTimes(2);
  });

  it("clears the selected browser session before the first step", async () => {
    const test = createReadyTest([action("scroll", "scroll")]);
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      waitBeforeStart: true,
      clearSessionBeforeRun: true,
    });

    expect(started.state).toBe("waiting_for_start");
    expect(started.wipe).toMatchObject({
      origin: "https://example.test",
      status: "completed",
    });
    expect(harness.spies.clearCookies).toHaveBeenCalledTimes(1);
    expect(harness.spies.setContent).toHaveBeenCalledTimes(1);
    expect(harness.spies.evaluate).toHaveBeenCalledTimes(1);
    expect(harness.spies.goto).toHaveBeenCalledWith(test.startUrl, {
      waitUntil: "domcontentloaded",
    });
    expect(harness.spies.mouseWheel).not.toHaveBeenCalled();
  });

  it("captures the baseline before the flow and executes a MySQL check", async () => {
    const mysqlCheck: TestFlowItem = {
      id: "mysql-check",
      type: "check",
      checkType: "mysql",
      title: "Verifică programarea",
      humanDescription: "Compară tabela appointments.",
      config: {
        tableNames: ["appointments"],
        identities: [{ tableName: "appointments", columns: ["id"] }],
      },
      enabled: true,
    };
    const test = createReadyTest([action("scroll", "scroll"), mysqlCheck]);
    const harness = createHarness();
    let details: MySqlRunDetails = { diffs: [], cleanupLogs: [] };
    const captureBaseline: RunnerMySqlGateway["captureBaseline"] = (
      _projectId,
      runId,
    ) => {
      details = {
        baselineSnapshotId: "baseline-1",
        diffs: [],
        cleanupLogs: [],
      };
      return Promise.resolve({
        id: "baseline-1",
        runId,
        kind: "baseline",
        capturedAt: project.createdAt,
        tables: [],
      });
    };
    const checkMySql: RunnerMySqlGateway["check"] = (
      _projectId,
      runId,
      step,
    ) => {
      const diff = {
        id: "diff-1",
        runId,
        checkStepId: step.id,
        baselineSnapshotId: "baseline-1",
        currentSnapshotId: "current-1",
        createdAt: project.createdAt,
        tables: [],
      };
      details = { ...details, diffs: [diff] };
      return Promise.resolve(diff);
    };
    const mysql: RunnerMySqlGateway = {
      captureBaseline: vi.fn(captureBaseline),
      check: vi.fn(checkMySql),
      getRunDetails: vi.fn(() => structuredClone(details)),
      previewCleanup: vi.fn(),
      confirmCleanup: vi.fn(),
    };
    const states: string[] = [];
    const service = createService(harness.browser, mysql);
    service.onStatusChange((current) => states.push(current.state));

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(mysql.captureBaseline).toHaveBeenCalledBefore(
      mysql.check as ReturnType<typeof vi.fn>,
    );
    expect(states).toContain("waiting_for_mysql_check");
    expect(service.getStatus(project.id, test.id).mysql).toMatchObject({
      baselineSnapshotId: "baseline-1",
      diffs: [{ id: "diff-1" }],
    });
    expect(
      service
        .listStepResults(project.id, test.id, started.run?.id ?? "")
        .at(-1),
    ).toMatchObject({ stepId: "mysql-check", status: "passed" });
  });

  it("runs multiple stages and carries variables from e-mail and MySQL into later entries", async () => {
    const created = createReadyTest([]);
    const test = tests.update({
      ...created,
      flowItems: [],
      stages: [
        {
          id: "stage-order",
          name: "Plasează comanda",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: [action("create-order", "scroll")],
          postChecks: [
            {
              id: "payment-mail",
              type: "check",
              checkType: "imap",
              title: "Primește linkul de plată",
              humanDescription: "Extrage linkul din email.",
              config: { accountId: "imap-1", receivedAfterTestStart: true },
              enabled: true,
              required: true,
              extractors: [
                {
                  id: "payment-link",
                  source: "imap",
                  field: "link_by_text",
                  selector: { operator: "equals", value: "Plătește acum" },
                  cardinality: "exactly_one",
                  output: {
                    name: "payment_url",
                    type: "url",
                    required: true,
                    overwritePolicy: "deny",
                  },
                },
              ],
            },
          ],
        },
        {
          id: "stage-payment",
          name: "Plătește",
          enabled: true,
          entry: { type: "variable_url", variableName: "payment_url" },
          flowItems: [action("pay", "navigate", { url: "{{payment_url}}" })],
          postChecks: [
            {
              id: "order-db",
              type: "check",
              checkType: "mysql",
              title: "Identifică order id",
              humanDescription: "Extrage comanda creată.",
              config: {
                tableNames: ["orders"],
                identities: [{ tableName: "orders", columns: ["id"] }],
              },
              enabled: true,
              required: true,
              extractors: [
                {
                  id: "order-id",
                  source: "mysql",
                  tableName: "orders",
                  rowSource: "inserted",
                  filters: [],
                  column: "id",
                  cardinality: "exactly_one",
                  output: {
                    name: "order_id",
                    type: "number",
                    required: true,
                    overwritePolicy: "deny",
                  },
                },
              ],
            },
          ],
        },
        {
          id: "stage-admin",
          name: "Verifică în admin",
          enabled: true,
          entry: {
            type: "url_template",
            template: "https://example.test/order/{{order_id}}",
          },
          flowItems: [
            action("verify", "navigate", {
              url: "{{baseUrl}}/admin/order/{{order_id}}",
            }),
          ],
          postChecks: [],
        },
      ],
    });
    const harness = createHarness();
    const imap: RunnerImapGateway = {
      check: vi.fn().mockResolvedValue({
        matched: true,
        message: "Mesaj găsit.",
        evidence: {
          messages: [
            {
              accountId: "imap-1",
              accountName: "Plăți",
              mailbox: "INBOX",
              uid: 10,
              receivedAt: "2026-07-24T12:01:00.000Z",
              subject: "Plătește comanda",
              from: ["shop@example.test"],
              to: ["client@example.test"],
              text: "Plătește acum",
              html: '<a href="https://pay.example.test/session/abc">Plătește acum</a>',
            },
          ],
        },
      }),
    };
    const checkStageMySql: RunnerMySqlGateway["check"] = (
      _projectId,
      runId,
      step,
    ) =>
      Promise.resolve({
        id: "diff-order",
        runId,
        checkStepId: step.id,
        baselineSnapshotId: "baseline-stage-payment",
        currentSnapshotId: "current-stage-payment",
        createdAt: project.createdAt,
        tables: [
          {
            tableName: "orders",
            columns: ["id"],
            identityColumns: ["id"],
            inserted: [{ identity: { id: 42 }, row: { id: 42 } }],
            deleted: [],
            updated: [],
            duplicateIdentities: [],
          },
        ],
      });
    const mysql: RunnerMySqlGateway = {
      captureBaseline: vi.fn().mockResolvedValue({
        id: "baseline-stage-payment",
        runId: "run",
        kind: "baseline",
        capturedAt: project.createdAt,
        tables: [],
      }),
      check: vi.fn(checkStageMySql),
      getRunDetails: vi.fn(() => ({ diffs: [], cleanupLogs: [] })),
      previewCleanup: vi.fn(),
      confirmCleanup: vi.fn(),
    };
    const service = createService(harness.browser, mysql, imap);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_imap_check",
      );
    });
    await service.pollImapCheck(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(harness.spies.goto).toHaveBeenCalledWith(
      "https://pay.example.test/session/abc",
      { waitUntil: "domcontentloaded" },
    );
    expect(harness.spies.goto).toHaveBeenCalledWith(
      "https://example.test/order/42",
      { waitUntil: "domcontentloaded" },
    );
    expect(harness.spies.goto).toHaveBeenCalledWith(
      "https://example.test/admin/order/42",
      { waitUntil: "domcontentloaded" },
    );
    expect(service.getStatus(project.id, test.id).variables).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: "payment_url" }),
        expect.objectContaining({ name: "order_id", value: 42 }),
      ]),
    );
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? ""),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: "stage-order",
          stepId: "payment-mail",
        }),
        expect.objectContaining({
          stageId: "stage-payment",
          stepId: "order-db",
        }),
      ]),
    );
  });

  it("honors the run selection for MySQL checks stored in stages", async () => {
    const created = createReadyTest([]);
    const test = tests.update({
      ...created,
      flowItems: [],
      stages: [
        {
          id: "stage-order",
          name: "Plasează comanda",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: [action("create-order", "scroll")],
          postChecks: [
            {
              id: "order-db",
              type: "check",
              checkType: "mysql",
              title: "Verifică baza de date",
              humanDescription: "Compară tabela orders.",
              config: {
                tableNames: ["orders"],
                identities: [{ tableName: "orders", columns: ["id"] }],
              },
              enabled: true,
              required: true,
            },
          ],
        },
      ],
    });
    const harness = createHarness();
    const mysql: RunnerMySqlGateway = {
      captureBaseline: vi.fn().mockResolvedValue(undefined),
      check: vi.fn(),
      getRunDetails: vi.fn(() => ({ diffs: [], cleanupLogs: [] })),
      previewCleanup: vi.fn(),
      confirmCleanup: vi.fn(),
    };
    const service = createService(harness.browser, mysql);

    await service.start({
      projectId: project.id,
      testId: test.id,
      postRun: { mysql: false, imap: false, ai: false },
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(mysql.captureBaseline).not.toHaveBeenCalled();
    expect(mysql.check).not.toHaveBeenCalled();
  });

  it("runs saved post-run checks outside the flow and evaluates their evidence with AI", async () => {
    const created = createReadyTest([action("scroll", "scroll")]);
    const test = tests.update({
      ...created,
      postRunChecks: {
        aiPrompt:
          "Verifică dacă un rând nou are status confirmed și corespunde datasetului.",
        mysql: {
          enabled: true,
          tableNames: ["appointments"],
          identities: [
            {
              tableName: "appointments",
              columns: ["id"],
            },
          ],
        },
        imap: {
          inboxes: [],
          enabled: false,
          accountIds: [],
          mailbox: "INBOX",
          sender: "",
          recipient: "",
          subjectEquals: "",
          subjectContains: "",
          bodyContains: "",
        },
      },
    });
    datasets.create({
      id: "dataset-post-run",
      testId: test.id,
      name: "Rezervare Ana",
      values: {
        customer_name: { type: "fixed", value: "Ana Popescu" },
        customer_email: {
          type: "fixed",
          value: "ana@example.test",
        },
      },
      createdAt: project.createdAt,
      updatedAt: project.createdAt,
    });
    const harness = createHarness();
    let details: MySqlRunDetails = { diffs: [], cleanupLogs: [] };
    const captureBaseline: RunnerMySqlGateway["captureBaseline"] = (
      _projectId,
      runId,
    ) => {
      details = {
        baselineSnapshotId: "baseline-saved-check",
        diffs: [],
        cleanupLogs: [],
      };
      return Promise.resolve({
        id: "baseline-saved-check",
        runId,
        kind: "baseline",
        capturedAt: project.createdAt,
        tables: [],
      });
    };
    const check: RunnerMySqlGateway["check"] = (_projectId, runId, step) => {
      const diff = {
        id: "diff-saved-check",
        runId,
        checkStepId: step.id,
        baselineSnapshotId: "baseline-saved-check",
        currentSnapshotId: "current-saved-check",
        createdAt: project.createdAt,
        tables: [
          {
            tableName: "appointments",
            columns: ["id", "status"],
            identityColumns: ["id"],
            inserted: [
              {
                identity: { id: 7 },
                row: { id: 7, status: "confirmed" },
              },
            ],
            deleted: [],
            updated: [],
            duplicateIdentities: [],
          },
        ],
      };
      details = { ...details, diffs: [diff] };
      return Promise.resolve(diff);
    };
    const mysql: RunnerMySqlGateway = {
      captureBaseline: vi.fn(captureBaseline),
      check: vi.fn(check),
      getRunDetails: vi.fn(() => structuredClone(details)),
      previewCleanup: vi.fn(),
      confirmCleanup: vi.fn(),
    };
    let evaluatedInput:
      Parameters<RunnerPostRunAiGateway["evaluate"]>[0] | undefined;
    const evaluate: RunnerPostRunAiGateway["evaluate"] = (input) => {
      evaluatedInput = input;
      return Promise.resolve({
        status: "passed",
        summary: "Recordul cerut a fost găsit.",
        findings: [
          {
            source: "mysql",
            passed: true,
            message: "appointments.status este confirmed.",
            evidence: ["appointments id=7"],
          },
        ],
        provider: "gemini",
        model: "gemini-test",
        usage: { inputTokens: 120, outputTokens: 30, totalTokens: 150 },
        evaluatedAt: "2026-07-24T12:00:00.000Z",
      });
    };
    const postRunAi: RunnerPostRunAiGateway = {
      evaluate: vi.fn(evaluate),
    };
    const service = createService(harness.browser, mysql, undefined, postRunAi);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      datasetId: "dataset-post-run",
      postRun: {
        mysql: true,
        imap: false,
        ai: true,
      },
      aiProvider: "gemini",
      aiModel: "gemini-test",
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(mysql.check).toHaveBeenCalledWith(
      project.id,
      started.run?.id,
      expect.objectContaining({
        id: `post-run:mysql:${test.id}`,
        checkType: "mysql",
      }),
    );
    expect(postRunAi.evaluate).toHaveBeenCalledOnce();
    expect(evaluatedInput?.prompt).toContain("status confirmed");
    expect(evaluatedInput?.dataset).toEqual({
      id: "dataset-post-run",
      name: "Rezervare Ana",
      values: {
        customer_name: "Ana Popescu",
        customer_email: "ana@example.test",
      },
    });
    expect(evaluatedInput?.provider).toBe("gemini");
    expect(evaluatedInput?.model).toBe("gemini-test");
    expect(JSON.stringify(evaluatedInput?.evidence.mysql)).toContain(
      "diff-saved-check",
    );
    expect(service.getStatus(project.id, test.id)).toMatchObject({
      state: "completed",
      run: { status: "passed" },
      postRunAi: {
        status: "passed",
        usage: { totalTokens: 150 },
      },
      aiCost: {
        requestCount: 1,
        inputTokens: 120,
        outputTokens: 30,
        totalTokens: 150,
        estimatedUsd: 0,
        unpricedRequests: 1,
        localOnly: false,
      },
    });
  });

  it("polls an IMAP post-run check until a matching message arrives", async () => {
    const imapCheck: TestFlowItem = {
      id: "imap-check",
      type: "check",
      checkType: "imap",
      title: "Confirmare programare",
      humanDescription: "Așteaptă e-mailul de confirmare.",
      config: {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        subjectContains: "Confirmare",
      },
      enabled: true,
    };
    const test = createReadyTest([action("scroll", "scroll"), imapCheck]);
    const harness = createHarness();
    const check = vi
      .fn<RunnerImapGateway["check"]>()
      .mockResolvedValueOnce({
        matched: false,
        message: "Mesajul nu a sosit încă.",
      })
      .mockResolvedValueOnce({
        matched: true,
        message: "Mesajul de confirmare a fost găsit.",
        evidence: {
          accountId: "imap-1",
          accountName: "Confirmări",
          mailbox: "INBOX",
          messages: [
            {
              accountId: "imap-1",
              accountName: "Confirmări",
              mailbox: "INBOX",
              uid: 7,
              receivedAt: "2026-07-24T12:01:00.000Z",
              subject: "Confirmare",
              from: ["sender@example.test"],
              to: ["client@example.test"],
              text: "Mulțumim.",
            },
          ],
        },
      });
    const service = createService(harness.browser, undefined, { check });

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_imap_check",
      );
    });

    const waiting = await service.pollImapCheck(started.run?.id ?? "");
    expect(waiting).toMatchObject({
      state: "waiting_for_imap_check",
      imap: { status: "waiting", message: "Mesajul nu a sosit încă." },
    });
    const completed = await service.pollImapCheck(started.run?.id ?? "");
    expect(completed).toMatchObject({
      state: "completed",
      imap: { status: "matched" },
      run: { status: "passed" },
    });
    const persistedImapResult = service
      .listStepResults(project.id, test.id, started.run?.id ?? "")
      .at(-1);
    expect(persistedImapResult).toMatchObject({
      stepId: "imap-check",
      status: "passed",
    });
    expect(JSON.stringify(persistedImapResult?.logs)).toContain(
      '"subject":"Confirmare"',
    );
  });

  it("waits for every configured IMAP check before completing the run", async () => {
    const imapChecks: TestFlowItem[] = [
      {
        id: "imap-first",
        type: "check",
        checkType: "imap",
        title: "Confirmare internă",
        humanDescription: "Așteaptă primul e-mail.",
        config: {
          accountId: "imap-1",
          receivedAfterTestStart: true,
          subjectContains: "Confirmare internă",
        },
        enabled: true,
      },
      {
        id: "imap-second",
        type: "check",
        checkType: "imap",
        title: "Confirmare client",
        humanDescription: "Așteaptă al doilea e-mail.",
        config: {
          accountId: "imap-1",
          receivedAfterTestStart: true,
          subjectContains: "Confirmare client",
        },
        enabled: true,
      },
    ];
    const test = createReadyTest([action("scroll", "scroll"), ...imapChecks]);
    const check = vi
      .fn<RunnerImapGateway["check"]>()
      .mockResolvedValueOnce({
        matched: true,
        message: "Primul mesaj a fost găsit.",
        evidence: {
          accountId: "imap-1",
          accountName: "Inbox comun",
          mailbox: "INBOX",
          messages: [
            {
              accountId: "imap-1",
              accountName: "Inbox comun",
              mailbox: "INBOX",
              uid: 7,
              receivedAt: "2026-07-24T12:01:00.000Z",
              subject: "Confirmare internă",
              from: ["sender@example.test"],
              to: ["client@example.test"],
              text: "Primul mesaj.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        matched: true,
        message: "Același mesaj a fost găsit din nou.",
        evidence: {
          accountId: "imap-1",
          accountName: "Inbox comun",
          mailbox: "INBOX",
          messages: [
            {
              accountId: "imap-1",
              accountName: "Inbox comun",
              mailbox: "INBOX",
              uid: 7,
              receivedAt: "2026-07-24T12:01:00.000Z",
              subject: "Confirmare internă",
              from: ["sender@example.test"],
              to: ["client@example.test"],
              text: "Primul mesaj.",
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        matched: true,
        message: "Al doilea mesaj a fost găsit.",
        evidence: {
          accountId: "imap-1",
          accountName: "Inbox comun",
          mailbox: "INBOX",
          messages: [
            {
              accountId: "imap-1",
              accountName: "Inbox comun",
              mailbox: "INBOX",
              uid: 8,
              receivedAt: "2026-07-24T12:02:00.000Z",
              subject: "Confirmare client",
              from: ["sender@example.test"],
              to: ["client@example.test"],
              text: "Al doilea mesaj.",
            },
          ],
        },
      });
    const service = createService(createHarness().browser, undefined, {
      check,
    });

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id)).toMatchObject({
        state: "waiting_for_imap_check",
        imap: { stepId: "imap-first" },
      });
    });

    const waitingForSecond = await service.pollImapCheck(started.run?.id ?? "");
    expect(waitingForSecond).toMatchObject({
      state: "waiting_for_imap_check",
      imap: { stepId: "imap-second", status: "waiting" },
      run: { status: "running" },
    });

    const stillWaitingForSecond = await service.pollImapCheck(
      started.run?.id ?? "",
    );
    expect(stillWaitingForSecond).toMatchObject({
      state: "waiting_for_imap_check",
      imap: {
        stepId: "imap-second",
        status: "waiting",
        message:
          "Mesajele găsite au fost deja folosite de un check IMAP anterior; se așteaptă un mesaj nou.",
      },
    });

    const completed = await service.pollImapCheck(started.run?.id ?? "");
    expect(completed).toMatchObject({
      state: "completed",
      imap: {
        stepId: "imap-second",
        status: "matched",
        allEvidence: {
          checks: [
            { messages: [{ uid: 7, subject: "Confirmare internă" }] },
            { messages: [{ uid: 8, subject: "Confirmare client" }] },
          ],
        },
      },
      run: { status: "passed" },
    });
    expect(
      service
        .listStepResults(project.id, test.id, started.run?.id ?? "")
        .filter(({ stepId }) => stepId.startsWith("imap-")),
    ).toMatchObject([
      { stepId: "imap-first", status: "passed" },
      { stepId: "imap-second", status: "passed" },
    ]);
  });

  it("marks a pending IMAP check failed and stops the run manually", async () => {
    const imapCheck: TestFlowItem = {
      id: "imap-stop",
      type: "check",
      checkType: "imap",
      title: "Așteaptă confirmarea",
      humanDescription: "Așteaptă mesajul.",
      config: {
        accountId: "imap-1",
        receivedAfterTestStart: true,
      },
      enabled: true,
    };
    const test = createReadyTest([imapCheck]);
    const service = createService(createHarness().browser);
    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_imap_check",
      );
    });

    const stopped = await service.stop(started.run?.id ?? "");

    expect(stopped).toMatchObject({
      state: "failed",
      run: { status: "failed" },
      imap: { status: "abandoned" },
    });
    expect(
      service
        .listStepResults(project.id, test.id, started.run?.id ?? "")
        .at(-1),
    ).toMatchObject({ stepId: "imap-stop", status: "failed" });
  });

  it("abandons an unavailable IMAP post-run check with a warning", async () => {
    const imapCheck: TestFlowItem = {
      id: "imap-check",
      type: "check",
      checkType: "imap",
      title: "Confirmare programare",
      humanDescription: "Așteaptă e-mailul de confirmare.",
      config: {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        subjectContains: "Confirmare",
      },
      enabled: true,
    };
    const test = createReadyTest([imapCheck]);
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe(
        "waiting_for_imap_check",
      );
    });
    const completed = await service.abandonImapCheck(started.run?.id ?? "");

    expect(completed).toMatchObject({
      state: "completed",
      imap: { status: "abandoned" },
      run: { status: "passed_with_warnings" },
    });
    expect(
      service
        .listStepResults(project.id, test.id, started.run?.id ?? "")
        .at(-1),
    ).toMatchObject({ stepId: "imap-check", status: "skipped" });
  });

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
    expect(harness.spies.clearCookies).not.toHaveBeenCalled();
    expect(harness.spies.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      deltaX: 0,
      deltaY: 700,
    });
    expect(harness.spies.goto).toHaveBeenCalledOnce();
    expect(harness.locator.click).toHaveBeenCalledOnce();
    expect(harness.locator.fill).toHaveBeenCalledWith("ana@example.test");
    expect(harness.locator.selectOption).toHaveBeenCalledWith(
      { value: "RO" },
      { timeout: 2_000 },
    );
    expect(harness.locator.check).toHaveBeenCalledOnce();
    expect(harness.locator.uncheck).toHaveBeenCalledOnce();
    expect(harness.spies.keyboardPress).toHaveBeenCalledWith("Enter");
    expect(harness.spies.mouseWheel).not.toHaveBeenCalled();
    expect(harness.locator.waitFor).toHaveBeenCalledWith({
      state: "visible",
      timeout: 1_500,
    });
    expect(harness.locator.waitFor).toHaveBeenCalledWith({
      state: "visible",
    });
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
    expect(service.getStatus(project.id, test.id).cleanup).toBeUndefined();
  });

  it("applies an AI run plan temporarily with repeat and dataset overrides", async () => {
    const created = createReadyTest([
      action("year", "select_option", {
        target,
        inputFieldId: "calendar_year",
        valueStrategy: "dataset",
        valueKey: "calendar_year",
      }),
      action("next-month", "click", { target }),
      action("day", "click", { target }),
    ]);
    tests.update({ ...created, testMode: "dynamic_ai" });
    datasets.create({
      id: "dataset-1",
      testId: created.id,
      name: "Înregistrare recorder",
      values: { calendar_year: "2027" },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
    });
    const harness = createHarness();
    const service = createService(harness.browser);

    await service.start({
      projectId: project.id,
      testId: created.id,
      datasetId: "dataset-1",
      aiPlan: {
        baseVersion: created.version,
        instruction: "Selectează 15 septembrie 2028.",
        proposal: {
          summary: "Calendar adaptat temporar.",
          changes: [
            {
              stepId: "year",
              patch: { datasetValue: "2028" },
              rationale: "Schimbă anul.",
            },
            {
              stepId: "next-month",
              patch: { repeat: 2 },
              rationale: "Ajunge în septembrie.",
            },
            {
              stepId: "day",
              patch: {
                primaryLocator: {
                  type: "data_attribute",
                  attribute: "data-testid",
                  operator: "equals",
                  value: "calendar-day-2028-09-15",
                },
              },
              rationale: "Alege ziua cerută.",
            },
          ],
          insertions: [],
        },
      },
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, created.id).state).toBe("completed");
    });

    expect(harness.locator.selectOption).toHaveBeenCalledWith(
      { value: "2028" },
      { timeout: 2_000 },
    );
    expect(harness.locator.click).toHaveBeenCalledTimes(3);
    expect(harness.spies.pageLocator).toHaveBeenCalledWith(
      '[data-testid="calendar-day-2028-09-15"]',
    );
    expect(tests.findById(created.id)?.flowItems[1]).not.toHaveProperty(
      "repeat",
    );
  });

  it("reports a manual wipe failure without changing the finished run", async () => {
    const test = createReadyTest([action("scroll", "scroll")], true);
    const harness = createHarness();
    harness.spies.evaluate.mockResolvedValue([
      {
        resource: "localStorage",
        status: "cleared",
        message: "localStorage a fost șters.",
        count: 1,
      },
      {
        resource: "indexedDB",
        status: "failed",
        message: "Ștergerea este blocată.",
      },
    ]);
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    const wiped = await service.manualWipe(started.run?.id ?? "", [
      "indexedDB",
    ]);

    expect(wiped).toMatchObject({
      state: "completed",
      cleanup: {
        origin: "https://example.test",
        status: "failed",
      },
    });
    expect(service.listRuns(project.id, test.id)[0]?.status).toBe("passed");
  });

  it("wipes only selected data after explicit confirmation", async () => {
    projects.update({
      ...project,
      browserConfig: {
        ...project.browserConfig,
        sessionMode: "persistent_profile",
        profilePath: "D:\\profiles\\semantic-test",
      },
    });
    const test = createReadyTest([action("scroll", "scroll")], true);
    const harness = createHarness();
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
    });
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });

    expect(harness.browser.launch).not.toHaveBeenCalled();
    expect(harness.spies.clearCookies).not.toHaveBeenCalled();
    const wiped = await service.manualWipe(started.run?.id ?? "", ["cookies"]);
    expect(wiped.cleanup).toMatchObject({
      origin: "https://example.test",
      status: "completed",
    });
    const cookieFilter: unknown = harness.spies.clearCookies.mock.calls[0]?.[0];
    if (
      typeof cookieFilter !== "object" ||
      cookieFilter === null ||
      !("domain" in cookieFilter) ||
      !(cookieFilter.domain instanceof RegExp)
    ) {
      throw new Error("Filtrul cookie nu este RegExp.");
    }
    expect(cookieFilter.domain.test("other.test")).toBe(false);
    expect(harness.spies.evaluate).toHaveBeenCalledTimes(1);
    expect(harness.spies.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      deltaX: 0,
      deltaY: 700,
    });
  });

  it("requires the project browser to be opened before starting a test", async () => {
    const test = createReadyTest([action("click", "click", { target })]);
    const harness = createHarness(createLocator(), { state: "idle" });
    const service = createService(harness.browser);

    await expect(
      service.start({
        projectId: project.id,
        testId: test.id,
      }),
    ).rejects.toThrow(
      "Deschide browserul proiectului din secțiunea Browser înainte să pornești testul.",
    );
    expect(harness.browser.detectAvailableBrowsers).not.toHaveBeenCalled();
    expect(harness.browser.launch).not.toHaveBeenCalled();
    expect(runs.listByProject(project.id)[0]).toMatchObject({
      status: "failed",
      error: {
        code: "browser_unavailable",
        operation: "browser_start",
        retryable: true,
      },
    });
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
    expect(runs.findById(started.run?.id ?? "")?.error).toMatchObject({
      code: "locator_ambiguous",
      stepId: "click",
      operation: "click",
      retryable: true,
    });

    locator.count.mockResolvedValue(1);
    service.retry(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(runs.findById(started.run?.id ?? "")?.error).toBeUndefined();
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
    const stopped = await service.stop(started.run?.id ?? "");
    expect(stopped.state).toBe("stopped");
    expect(stopped.run?.status).toBe("stopped");
    expect(stopped.cleanup).toBeUndefined();
    expect(harness.spies.clearCookies).not.toHaveBeenCalled();
    releaseClick?.();
    await vi.waitFor(() => {
      expect(
        service.listStepResults(project.id, test.id, started.run?.id ?? "")[0]
          ?.status,
      ).toBe("stopped");
    });
    expect(harness.browser.getStatus().state).toBe("running");
  });

  it("walks the fallback chain automatically and persists the working locator", async () => {
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
            locator: {
              type: "css",
              operator: "equals",
              value: "#missing-fallback",
            },
            humanDescription: "Buton alternativ indisponibil",
            whyExplanation: "Prima alternativă nu există în acest layout.",
          },
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
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    const completedRun = service.listRuns(project.id, test.id)[0];
    expect(completedRun).toMatchObject({
      status: "passed_with_warnings",
      warnings: [
        expect.objectContaining({
          code: "fallback_used",
          fallbackIndex: 1,
        }),
      ],
    });
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({
      status: "passed_with_fallback",
      fallbackIndex: 1,
      locatorUsed: fallbackLocator,
    });
    expect(fallback.click).toHaveBeenCalledOnce();
    expect(primary.waitFor).toHaveBeenCalledTimes(1);
    expect(fallback.waitFor).not.toHaveBeenCalled();
    const repaired = tests.findById(test.id);
    const repairedStep = repaired?.flowItems[0];
    expect(repaired).toMatchObject({ version: 3 });
    expect(repairedStep?.type).toBe("action");
    if (repairedStep?.type !== "action") {
      throw new Error("Pasul reparat trebuie să fie o acțiune.");
    }
    expect(repairedStep.target?.primary).toEqual(fallbackLocator);
    expect(repairedStep.fallbacks[0]?.locator).toEqual(target.primary);
    expect(repairedStep.fallbacks[1]?.locator).toMatchObject({
      value: "#missing-fallback",
    });
  });

  it("runs fallbacks automatically in step-by-step mode and pauses after the recovered step", async () => {
    const fallbackDefinition = {
      type: "css" as const,
      operator: "equals" as const,
      value: "#working-fallback",
    };
    const test = createReadyTest([
      action("click-with-fallback", "click", {
        target,
        fallbacks: [
          {
            locator: fallbackDefinition,
            humanDescription: "Link alternativ",
            whyExplanation: "Este vizibil în acest layout.",
          },
        ],
      }),
      action("next-scroll", "scroll"),
    ]);
    const primary = createLocator();
    primary.count.mockResolvedValue(0);
    const fallback = createLocator();
    const harness = createHarness(primary);
    harness.spies.pageLocator.mockImplementation((selector: string) =>
      selector === "#working-fallback" ? fallback : primary,
    );
    const service = createService(harness.browser);

    const started = await service.start({
      projectId: project.id,
      testId: test.id,
      mode: "step_by_step",
    });

    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id)).toMatchObject({
        state: "waiting_after_step",
        pause: {
          kind: "after_step",
          previousStepId: "click-with-fallback",
          nextStepId: "next-scroll",
        },
      });
    });
    expect(fallback.click).toHaveBeenCalledOnce();
    expect(harness.spies.evaluate).not.toHaveBeenCalled();

    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();
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
      mode: "breakpoints",
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
      state: "paused_on_error",
      run: { status: "failed" },
      canStop: true,
      canRetry: true,
    });
    expect(exhausted.message).toContain(
      "Toate fallback-urile au fost epuizate",
    );
    expect(
      service.listStepResults(project.id, test.id, started.run?.id ?? "")[0],
    ).toMatchObject({ status: "failed" });

    const skipped = service.skipCurrentStep(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(skipped.state).toBe("running");
    expect(service.getStatus(project.id, test.id)).toMatchObject({
      state: "completed",
      run: { status: "passed_with_warnings" },
    });
    expect(service.getStatus(project.id, test.id).cleanup).toBeUndefined();
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
      mode: "breakpoints",
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
    expect(harness.spies.evaluate).not.toHaveBeenCalled();

    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();
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
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();

    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.evaluate).toHaveBeenCalledTimes(2);
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
    expect(harness.spies.evaluate).not.toHaveBeenCalled();
    await service.continueExecution(started.run?.id ?? "");
    await vi.waitFor(() => {
      expect(service.getStatus(project.id, test.id).state).toBe("completed");
    });
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();
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
