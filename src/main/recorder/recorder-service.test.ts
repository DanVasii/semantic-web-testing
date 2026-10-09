import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Frame } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageAnalysisResult } from "../../shared/page-analysis.js";
import type { Project } from "../../shared/persistence.js";
import type {
  RecorderRawEvent,
  RecorderSnapshot,
} from "../../shared/recorder.js";
import type { ActionStep } from "../../shared/test-model.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../persistence/database.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "../persistence/repositories.js";
import { TestsService } from "../tests-service.js";
import {
  RecorderService,
  stableNavigationPattern,
  type RecorderAnalysisGateway,
  type RecorderBrowserGateway,
} from "./recorder-service.js";

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

class MockPage extends EventEmitter {
  public binding?: (_source: unknown, event: unknown) => void;
  public readonly frame = {} as Frame;
  public evaluateCalls: unknown[][] = [];
  private currentUrl = "https://example.test/checkout";

  public exposeBinding(
    _name: string,
    callback: (_source: unknown, event: unknown) => void,
  ): Promise<void> {
    this.binding = callback;
    return Promise.resolve();
  }

  public async addInitScript(): Promise<void> {
    return Promise.resolve();
  }

  public evaluate(...values: unknown[]): Promise<void> {
    this.evaluateCalls.push(values);
    return Promise.resolve();
  }

  public url(): string {
    return this.currentUrl;
  }

  public mainFrame(): Frame {
    return this.frame;
  }

  public capture(event: RecorderRawEvent, sourceFrame = this.frame): void {
    this.binding?.({ frame: sourceFrame }, event);
  }

  public navigate(url: string): void {
    this.currentUrl = url;
    this.emit("framenavigated", this.frame);
  }
}

class MockContext extends EventEmitter {}

const analysisResult = (pageId = "page-1"): PageAnalysisResult => ({
  projectId: project.id,
  page: {
    id: pageId,
    projectId: project.id,
    name: "Checkout",
    url: "https://example.test/checkout",
    normalizedUrl: "https://example.test/checkout",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  version: {
    id: "page-version-1",
    pageId,
    versionNumber: 1,
    createdAt: "2026-07-25T10:00:00.000Z",
    normalizedUrl: "https://example.test/checkout",
    domFilePath: "dom.html",
    cssFilePath: "styles.css",
    accessibilityFilePath: "accessibility.json",
    analysisFilePath: "analysis.json",
    semanticHash: "semantic-hash",
  },
  title: "Checkout",
  url: "https://example.test/checkout",
  normalizedUrl: "https://example.test/checkout",
  capturedAt: "2026-07-25T10:00:00.000Z",
  counts: {
    visibleTexts: 1,
    interactiveElements: 1,
    forms: 1,
    inputs: 1,
    buttons: 0,
    links: 0,
    selectableElements: 1,
    inlineStyles: 0,
    styleTags: 0,
    externalStylesheets: 0,
  },
  inaccessibleStylesheets: [],
  artifactDirectory: "pages/page-1",
});

const fillEvent = (): RecorderRawEvent => ({
  type: "fill",
  url: "https://example.test/checkout",
  timestamp: "2026-07-25T10:00:01.000Z",
  value: "dan@example.test",
  target: {
    tagName: "input",
    inputType: "email",
    label: "Adresă e-mail",
    role: "textbox",
    dataAttributes: { "data-testid": "email" },
  },
});

const waitForState = async (
  service: RecorderService,
  state: "preview" | "error" | "recording",
): Promise<void> => {
  for (let index = 0; index < 40; index += 1) {
    if (service.getStatus(project.id, "test-1").state === state) return;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`Recorderul nu a ajuns în starea ${state}.`);
};

const waitForCapturedSteps = async (
  service: RecorderService,
  count: number,
): Promise<void> => {
  for (let index = 0; index < 40; index += 1) {
    if (
      service.getStatus(project.id, "test-1").capturedSteps === count &&
      service.getStatus(project.id, "test-1").signal === "green"
    ) {
      return;
    }
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
  }
  throw new Error(`Recorderul nu a salvat automat ${count} pași.`);
};

let directory: string;
let database: ApplicationDatabase;
let projectRepository: ProjectRepository;
let testRepository: TestRepository;
let datasetRepository: DatasetRepository;
let testsService: TestsService;
let page: MockPage;
let context: MockContext;
let browser: RecorderBrowserGateway;
let idCounter: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-recorder-service-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  projectRepository = new ProjectRepository(database.connection);
  testRepository = new TestRepository(database.connection);
  datasetRepository = new DatasetRepository(database.connection);
  projectRepository.create(project);
  testsService = new TestsService(
    projectRepository,
    testRepository,
    datasetRepository,
    {
      createId: () => "test-1",
      now: () => new Date("2026-07-25T10:00:00.000Z"),
      snapshotRoot: join(directory, "versions"),
    },
  );
  testsService.create(project.id, {
    name: "Checkout",
    startUrl: "https://example.test/checkout",
  });
  page = new MockPage();
  context = new MockContext();
  browser = {
    detectAvailableBrowsers: vi.fn().mockResolvedValue([
      {
        installationId: "chromium-playwright",
        id: "chromium",
        displayName: "Chromium",
        source: "playwright",
        installed: true,
        supported: true,
      },
    ]),
    getStatus: vi.fn().mockReturnValue({ state: "idle" }),
    launch: vi.fn().mockResolvedValue({
      browser: "chromium",
      source: "playwright",
      sessionMode: "temporary",
      projectId: project.id,
      startedAt: "2026-07-25T10:00:00.000Z",
      tabs: [],
    }),
    openProjectUrl: vi.fn().mockResolvedValue({
      state: "opened",
      tab: {
        id: "tab-1",
        projectId: project.id,
        url: "https://example.test/checkout",
      },
    }),
    getRunnerPage: vi.fn().mockReturnValue(page),
    getRunnerContext: vi.fn().mockReturnValue(context),
  };
  idCounter = 0;
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

const createService = (analysis: RecorderAnalysisGateway): RecorderService =>
  new RecorderService(
    projectRepository,
    testRepository,
    datasetRepository,
    testsService,
    browser,
    analysis,
    {
      createId: () => `recorder-${++idCounter}`,
      now: () => new Date("2026-07-25T10:00:02.000Z"),
      stabilizationMs: 0,
      wait: () => Promise.resolve(),
    },
  );

describe("RecorderService", () => {
  it("keeps JavaScript dialogs open for the person recording", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    const dialog = {
      accept: vi.fn(),
      dismiss: vi.fn(),
    };

    await service.start(project.id, "test-1");
    expect(page.listenerCount("dialog")).toBe(1);

    page.emit("dialog", dialog);
    expect(dialog.accept).not.toHaveBeenCalled();
    expect(dialog.dismiss).not.toHaveBeenCalled();

    await service.stop(project.id, "test-1");
    expect(page.listenerCount("dialog")).toBe(0);
  });

  it("merges a click and its dynamic navigation into one warning-only step", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    await service.start(project.id, "test-1");
    page.capture({
      type: "click",
      url: "https://example.test/checkout",
      timestamp: "2026-07-25T10:00:01.000Z",
      target: {
        tagName: "button",
        text: "Finalizează comanda",
        role: "button",
        dataAttributes: { "data-testid": "place-order" },
      },
    });
    await waitForCapturedSteps(service, 2);

    page.navigate(
      "https://example.test/order-received/987654321?key=abc#summary",
    );
    await vi.waitFor(() => {
      expect(
        service.getStatus(project.id, "test-1").test.flowItems[1],
      ).toMatchObject({
        actionType: "click",
        waitAfter: {
          type: "url",
          value: "https://example.test/order-received/**",
          warningOnly: true,
        },
      });
    });
    expect(service.getStatus(project.id, "test-1").test.flowItems).toHaveLength(
      2,
    );
    expect(stableNavigationPattern("https://example.test/cart?coupon=1")).toBe(
      "https://example.test/cart",
    );
  });

  it("preserves the cross-origin frame context of a recorded input", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    await service.start(project.id, "test-1");
    const stripeFrame = {
      url: () => "https://js.stripe.com/v3/elements-inner-payment",
    } as unknown as Frame;

    page.capture(fillEvent(), stripeFrame);
    await waitForCapturedSteps(service, 2);

    expect(
      service.getStatus(project.id, "test-1").test.flowItems[1],
    ).toMatchObject({
      actionType: "fill",
      target: {
        frame: { origin: "https://js.stripe.com" },
      },
    });
  });

  it("runs start, live analysis, automatic save and Done as a recorder version", async () => {
    const analyzeCurrentPage = vi.fn().mockResolvedValue(analysisResult());
    const service = createService({ analyzeCurrentPage });
    const states: string[] = [];
    service.onStatusChange((snapshot) => {
      states.push(`${snapshot.signal}:${snapshot.state}`);
    });

    const started = await service.start(project.id, "test-1");
    expect(started).toMatchObject({
      state: "recording",
      signal: "green",
      canStop: true,
      test: { workflowState: "recording" },
    });
    expect(browser.openProjectUrl).toHaveBeenCalledWith(
      project.id,
      "https://example.test/checkout",
    );

    page.capture(fillEvent());
    await waitForCapturedSteps(service, 2);
    const recorded = service.getStatus(project.id, "test-1");
    expect(recorded).toMatchObject({
      state: "recording",
      signal: "green",
      capturedSteps: 2,
      test: {
        flowItems: [
          {
            actionType: "navigate",
            url: "https://example.test/checkout",
          },
          {
            actionType: "fill",
            pageId: "page-1",
            valueKey: "adresa_e_mail",
          },
        ],
      },
    });
    expect(datasetRepository.listByTest("test-1")[0]?.values).toMatchObject({
      adresa_e_mail: { type: "fixed", value: "dan@example.test" },
    });

    const completed = await service.stop(project.id, "test-1");
    expect(completed).toMatchObject({
      state: "completed",
      signal: "green",
      test: { workflowState: "flow_analyzed" },
    });
    expect(testsService.listVersions(project.id, "test-1")[0]?.source).toBe(
      "recorder",
    );
    expect(states).toContain("yellow:analyzing");
    expect(states).toContain("green:recording");
    expect(page.evaluateCalls).toHaveLength(3);
  });

  it("keeps separate dataset values when the same field is filled more than once", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    await service.start(project.id, "test-1");
    const searchTarget: NonNullable<RecorderRawEvent["target"]> = {
      tagName: "input",
      inputType: "search",
      label: "Căutare produse",
      role: "textbox",
      dataAttributes: {},
    };

    page.capture({
      type: "fill",
      url: "https://example.test/shop",
      timestamp: "2026-07-25T10:00:01.000Z",
      target: searchTarget,
      value: "telefon",
    });
    await waitForCapturedSteps(service, 2);

    page.capture({
      type: "fill",
      url: "https://example.test/shop",
      timestamp: "2026-07-25T10:00:02.000Z",
      target: searchTarget,
      value: "tabletă",
    });
    await waitForCapturedSteps(service, 3);

    expect(
      service
        .getStatus(project.id, "test-1")
        .test.flowItems.map((item) =>
          item.type === "action" ? item.valueKey : undefined,
        ),
    ).toEqual([undefined, "cautare_produse", "cautare_produse_2"]);
    expect(datasetRepository.listByTest("test-1")[0]?.values).toMatchObject({
      cautare_produse: { type: "fixed", value: "telefon" },
      cautare_produse_2: { type: "fixed", value: "tabletă" },
    });
  });

  it("retries a failed analysis and saves the step automatically", async () => {
    const analyzeCurrentPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("Captura DOM a eșuat."))
      .mockResolvedValueOnce(analysisResult());
    const service = createService({ analyzeCurrentPage });
    await service.start(project.id, "test-1");

    page.capture(fillEvent());
    await waitForState(service, "error");
    expect(service.getStatus(project.id, "test-1")).toMatchObject({
      signal: "red",
      canRetry: true,
      canIgnore: true,
      error: "Captura DOM a eșuat.",
    });

    service.retry(project.id, "test-1");
    await waitForCapturedSteps(service, 2);
    expect(analyzeCurrentPage).toHaveBeenCalledTimes(2);
  });

  it("allows an analysis error to be explicitly ignored before editing", async () => {
    const service = createService({
      analyzeCurrentPage: vi
        .fn()
        .mockRejectedValue(new Error("Pagina nu este stabilă.")),
    });
    await service.start(project.id, "test-1");
    page.capture(fillEvent());
    await waitForState(service, "error");

    const ignored = service.ignoreError(project.id, "test-1");
    expect(ignored).toMatchObject({
      state: "preview",
      signal: "red",
      pendingStep: { step: { actionType: "fill" } },
    });
    expect(ignored.pendingStep?.step.pageId).toBeUndefined();

    const discarded = await service.discardStep(project.id, "test-1");
    expect(discarded).toMatchObject({
      state: "recording",
      signal: "green",
      capturedSteps: 0,
    });
    const stopped = await service.stop(project.id, "test-1");
    expect(stopped).toMatchObject({
      state: "completed",
      signal: "green",
      canStart: true,
      test: { workflowState: "not_recorded" },
    });
    expect(service.getStatus(project.id, "test-1").canStart).toBe(true);
  });

  it("invalidates and repeats analysis when navigation changes during capture", async () => {
    let call = 0;
    const analyzeCurrentPage = vi.fn().mockImplementation(() => {
      call += 1;
      if (call === 1) page.navigate("https://example.test/cart");
      return Promise.resolve(analysisResult(`page-${call}`));
    });
    const service = createService({ analyzeCurrentPage });
    await service.start(project.id, "test-1");

    page.capture(fillEvent());
    await waitForCapturedSteps(service, 3);
    expect(analyzeCurrentPage).toHaveBeenCalledTimes(2);
    expect(
      service.getStatus(project.id, "test-1").test.flowItems[1],
    ).toMatchObject({ pageId: "page-2" });
    expect(service.getStatus(project.id, "test-1").queuedEvents).toBe(0);
  });

  it("queues interactions while analysis is running and reuses the page capture", async () => {
    let resolveAnalysis: ((result: PageAnalysisResult) => void) | undefined;
    const analyzeCurrentPage = vi.fn(
      () =>
        new Promise<PageAnalysisResult>((resolve) => {
          resolveAnalysis = resolve;
        }),
    );
    const service = createService({ analyzeCurrentPage });
    await service.start(project.id, "test-1");

    page.capture(fillEvent());
    page.capture({
      type: "scroll",
      url: "https://example.test/checkout",
      timestamp: "2026-07-25T10:00:01.500Z",
      scrollX: 0,
      scrollY: 420,
      scrollMode: "wheel",
    });
    page.capture({
      type: "scroll",
      url: "https://example.test/checkout",
      timestamp: "2026-07-25T10:00:01.750Z",
      scrollX: 0,
      scrollY: 180,
      scrollMode: "wheel",
    });
    await Promise.resolve();
    resolveAnalysis?.(analysisResult());

    await waitForCapturedSteps(service, 3);
    expect(analyzeCurrentPage).toHaveBeenCalledTimes(1);
    expect(
      service
        .getStatus(project.id, "test-1")
        .test.flowItems.map((item) =>
          item.type === "action" ? item.actionType : item.type,
        ),
    ).toEqual(["navigate", "fill", "scroll"]);
    expect(
      service.getStatus(project.id, "test-1").test.flowItems[2],
    ).toMatchObject({
      actionType: "scroll",
      scrollY: 600,
      scrollMode: "wheel",
    });
  });

  it("does not merge consecutive scrolls from different containers", async () => {
    let resolveAnalysis: ((result: PageAnalysisResult) => void) | undefined;
    const analyzeCurrentPage = vi.fn(
      () =>
        new Promise<PageAnalysisResult>((resolve) => {
          resolveAnalysis = resolve;
        }),
    );
    const service = createService({ analyzeCurrentPage });
    await service.start(project.id, "test-1");

    page.capture(fillEvent());
    page.capture({
      type: "scroll",
      url: "https://example.test/checkout",
      timestamp: "2026-07-25T10:00:01.500Z",
      scrollX: 0,
      scrollY: 120,
      target: {
        tagName: "div",
        id: "filters",
        dataAttributes: {},
      },
    });
    page.capture({
      type: "scroll",
      url: "https://example.test/checkout",
      timestamp: "2026-07-25T10:00:01.750Z",
      scrollX: 0,
      scrollY: 180,
      target: {
        tagName: "div",
        id: "results",
        dataAttributes: {},
      },
    });
    await Promise.resolve();
    resolveAnalysis?.(analysisResult());

    await waitForCapturedSteps(service, 4);
    const scrolls = service
      .getStatus(project.id, "test-1")
      .test.flowItems.filter(
        (item): item is ActionStep =>
          item.type === "action" && item.actionType === "scroll",
      );
    expect(scrolls).toHaveLength(2);
    expect(scrolls[0]).toMatchObject({ scrollY: 120 });
    expect(scrolls[0]?.target?.primary).toMatchObject({ value: "#filters" });
    expect(scrolls[1]).toMatchObject({ scrollY: 180 });
    expect(scrolls[1]?.target?.primary).toMatchObject({ value: "#results" });
  });

  it("restores the existing test when a re-recording is stopped empty", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    await service.start(project.id, "test-1");
    page.capture(fillEvent());
    await waitForCapturedSteps(service, 2);
    const completed = await service.stop(project.id, "test-1");
    const existingFlow = completed.test.flowItems;

    const restarted = await service.start(project.id, "test-1");
    expect(restarted).toMatchObject({
      state: "recording",
      capturedSteps: 0,
      test: { workflowState: "recording", flowItems: [] },
    });

    const cancelled = await service.stop(project.id, "test-1");
    expect(cancelled).toMatchObject({
      state: "completed",
      signal: "green",
      canStart: true,
      test: {
        workflowState: "flow_analyzed",
        flowItems: existingFlow,
      },
    });
    expect(service.getStatus(project.id, "test-1")).toMatchObject({
      state: "idle",
      canStart: true,
      test: {
        workflowState: "flow_analyzed",
        flowItems: existingFlow,
      },
    });
  });

  it("continues recording from the current page without clearing existing steps", async () => {
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    await service.start(project.id, "test-1");
    page.capture(fillEvent());
    await waitForCapturedSteps(service, 2);
    const completed = await service.stop(project.id, "test-1");

    const continued = await service.continueRecording(project.id, "test-1");

    expect(continued).toMatchObject({
      state: "recording",
      signal: "green",
      continuationReady: true,
      capturedSteps: completed.test.flowItems.length,
      test: {
        workflowState: "recording",
        flowItems: completed.test.flowItems,
      },
    });
    expect(browser.openProjectUrl).toHaveBeenCalledOnce();
  });

  it("keeps the start action available when browser preparation fails", async () => {
    vi.mocked(browser.openProjectUrl).mockRejectedValueOnce(
      new Error("Browser indisponibil."),
    );
    const service = createService({
      analyzeCurrentPage: vi.fn().mockResolvedValue(analysisResult()),
    });
    const states: RecorderSnapshot[] = [];
    service.onStatusChange((value) => {
      states.push(value);
    });

    await expect(service.start(project.id, "test-1")).rejects.toThrow(
      "Browser indisponibil.",
    );

    expect(states.at(-1)).toMatchObject({
      state: "idle",
      signal: "red",
      canStart: true,
      error: "Browser indisponibil.",
    });
    expect(service.getStatus(project.id, "test-1")).toMatchObject({
      state: "idle",
      canStart: true,
      test: { workflowState: "not_recorded" },
    });
  });
});
