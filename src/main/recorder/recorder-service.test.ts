import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Frame } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PageAnalysisResult } from "../../shared/page-analysis.js";
import type { Project } from "../../shared/persistence.js";
import type { RecorderRawEvent } from "../../shared/recorder.js";
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

  public capture(event: RecorderRawEvent): void {
    this.binding?.({}, event);
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
  it("runs start, live analysis, preview, add and Done as a recorder version", async () => {
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
    await waitForState(service, "preview");
    const preview = service.getStatus(project.id, "test-1");
    expect(preview).toMatchObject({
      state: "preview",
      signal: "red",
      pendingStep: {
        step: {
          actionType: "fill",
          pageId: "page-1",
          valueKey: "adresa_e_mail",
        },
        capturedValue: "dan@example.test",
      },
    });

    const edited = structuredClone(preview.pendingStep);
    if (edited === undefined) throw new Error("Lipsește pasul în preview.");
    edited.step.title = "Completează emailul clientului";
    const added = await service.addStep(project.id, "test-1", edited);
    expect(added).toMatchObject({
      state: "recording",
      signal: "green",
      capturedSteps: 1,
    });
    expect(added.test.flowItems[0]).toMatchObject({
      title: "Completează emailul clientului",
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
    expect(states).toContain("red:preview");
    expect(page.evaluateCalls.length).toBeGreaterThan(3);
  });

  it("retries a failed analysis and returns to preview", async () => {
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
    await waitForState(service, "preview");
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
      signal: "red",
      test: { workflowState: "recorded" },
    });
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
    await waitForState(service, "preview");
    expect(analyzeCurrentPage).toHaveBeenCalledTimes(2);
    expect(
      service.getStatus(project.id, "test-1").pendingStep?.step.pageId,
    ).toBe("page-2");
    expect(service.getStatus(project.id, "test-1").queuedEvents).toBe(1);
  });
});
