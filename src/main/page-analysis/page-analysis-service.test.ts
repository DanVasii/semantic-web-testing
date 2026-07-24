import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../persistence/database.js";
import {
  PageRepository,
  ProjectRepository,
} from "../persistence/repositories.js";
import type {
  PageCapture,
  PageCaptureProgressListener,
} from "./page-capture.js";
import {
  PageAnalysisService,
  type PageCaptureSource,
} from "./page-analysis-service.js";

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

const element = {
  path: "/html[1]/body[1]/button[1]",
  cssSelector:
    "html:nth-of-type(1) > body:nth-of-type(1) > button:nth-of-type(1)",
  tag: "button",
  text: "Cumpără",
  attributes: {
    "aria-label": "Cumpără produsul",
    "data-testid": "buy",
  },
  ariaAttributes: { "aria-label": "Cumpără produsul" },
  dataAttributes: { "data-testid": "buy" },
  states: { checked: null, selected: null, disabled: false },
  parentPath: "/html[1]/body[1]",
  formPath: null,
};

const createCapture = (overrides: Partial<PageCapture> = {}): PageCapture => ({
  url: "https://example.test/products?preview=1#card",
  title: "Produse",
  html: "<!doctype html><html><body><button>Cumpără</button></body></html>",
  serializedDom:
    "<html><head></head><body><button>Cumpără</button></body></html>",
  accessibilitySnapshot: '- button "Cumpără"',
  visibleTexts: [
    {
      path: "/html[1]/body[1]/button[1]",
      text: "Cumpără",
    },
  ],
  interactiveElements: [element],
  ariaElements: [element],
  dataElements: [element],
  statefulElements: [],
  forms: [],
  inputs: [],
  buttons: [element],
  links: [],
  selectableElements: [],
  inlineStyles: [
    {
      path: element.path,
      cssSelector: element.cssSelector,
      cssText: "color: red",
    },
  ],
  styleTags: [{ order: 0, media: "", cssText: "button { color: red; }" }],
  stylesheets: [
    {
      order: 0,
      href: "https://example.test/styles.css",
      media: "",
      disabled: false,
      accessible: true,
      cssText: "button { color: red; }",
      failureReason: null,
    },
  ],
  shadowRoots: [],
  css: "button { color: red; }",
  counts: {
    visibleTexts: 1,
    interactiveElements: 1,
    forms: 0,
    inputs: 0,
    buttons: 1,
    links: 0,
    selectableElements: 0,
    inlineStyles: 1,
    styleTags: 1,
    externalStylesheets: 1,
  },
  inaccessibleStylesheets: [],
  ...overrides,
});

let directory: string;
let database: ApplicationDatabase;
let pageRepository: PageRepository;
let projectRepository: ProjectRepository;
let capture: PageCapture;
let captureSource: PageCaptureSource;
let service: PageAnalysisService;
let now: Date;
let idIndex: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-page-analysis-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  projectRepository = new ProjectRepository(database.connection);
  pageRepository = new PageRepository(database.connection);
  projectRepository.create(project);
  capture = createCapture();
  const getCurrentPageMetadata: PageCaptureSource["getCurrentPageMetadata"] =
    vi.fn(() =>
      Promise.resolve({
        tabId: "tab-1",
        projectId: project.id,
        url: capture.url,
        title: capture.title,
      }),
    );
  const captureCurrentPage: PageCaptureSource["captureCurrentPage"] = vi.fn(
    (_projectId: string, onProgress?: PageCaptureProgressListener) => {
      onProgress?.("preparing", 1, "Pagina a fost identificată.");
      onProgress?.("capturing_styles", 5, "Stilurile au fost capturate.");
      return Promise.resolve(capture);
    },
  );
  captureSource = {
    getCurrentPageMetadata,
    captureCurrentPage,
  };
  now = new Date("2026-07-24T12:00:00.000Z");
  idIndex = 0;
  service = new PageAnalysisService(
    projectRepository,
    pageRepository,
    captureSource,
    {
      artifactRoot: join(directory, "artifacts"),
      createId: () => ["page-1", "version-1", "version-2"][idIndex++]!,
      now: () => now,
    },
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("PageAnalysisService", () => {
  it("captures and persists all G artifacts with a page version", async () => {
    const progress = vi.fn();
    const result = await service.analyzeCurrentPage(project.id, progress);

    expect(result).toMatchObject({
      projectId: project.id,
      title: "Produse",
      normalizedUrl: "https://example.test/products",
      artifactDirectory: "projects/project-1/pages/page-1/v1",
      page: {
        id: "page-1",
        url: capture.url,
      },
      version: {
        id: "version-1",
        versionNumber: 1,
      },
    });
    expect(progress).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "completed",
        completedSteps: 8,
      }),
    );

    const artifactDirectory = join(
      directory,
      "artifacts",
      ...result.artifactDirectory.split("/"),
    );
    expect(readFileSync(join(artifactDirectory, "dom.html"), "utf8")).toBe(
      capture.html,
    );
    expect(readFileSync(join(artifactDirectory, "styles.css"), "utf8")).toBe(
      capture.css,
    );
    expect(
      JSON.parse(
        readFileSync(join(artifactDirectory, "accessibility.json"), "utf8"),
      ),
    ).toMatchObject({
      format: "playwright-aria-snapshot-yaml",
      snapshot: capture.accessibilitySnapshot,
    });
    expect(
      JSON.parse(
        readFileSync(join(artifactDirectory, "analysis.json"), "utf8"),
      ),
    ).toMatchObject({
      schemaVersion: 1,
      title: "Produse",
      counts: capture.counts,
      buttons: [expect.objectContaining({ text: "Cumpără" })],
      ariaElements: [expect.objectContaining({ tag: "button" })],
      dataElements: [expect.objectContaining({ tag: "button" })],
    });
    expect(projectRepository.getStatistics(project.id).pageCount).toBe(1);
    const summaries = await service.listAnalyzedPages(project.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe("Produse");
    expect(summaries[0]?.counts).toEqual(capture.counts);
    expect(summaries[0]?.latestVersion.versionNumber).toBe(1);
  });

  it("creates a new version for the same normalized URL", async () => {
    const first = await service.analyzeCurrentPage(project.id);
    now = new Date("2026-07-24T13:00:00.000Z");
    capture = createCapture({
      url: "https://example.test/products?preview=2#different",
      html: "<html><body>Versiunea 2</body></html>",
    });

    const second = await service.analyzeCurrentPage(project.id);

    expect(second.page.id).toBe(first.page.id);
    expect(second.version.versionNumber).toBe(2);
    expect(projectRepository.getStatistics(project.id).pageCount).toBe(1);
    expect(
      pageRepository
        .listVersions(first.page.id)
        .map(({ versionNumber }) => versionNumber),
    ).toEqual([2, 1]);
    expect((await service.getCurrentTarget(project.id)).isAnalyzed).toBe(true);
    expect(
      (await service.getCurrentTarget(project.id)).latestVersionNumber,
    ).toBe(2);
  });

  it("keeps the analysis successful when an external stylesheet is blocked", async () => {
    capture = createCapture({
      stylesheets: [
        {
          order: 0,
          href: "https://cdn.example.test/private.css",
          media: "",
          disabled: false,
          accessible: false,
          cssText: "",
          failureReason: "Stylesheet inaccesibil (CORS).",
        },
      ],
      inaccessibleStylesheets: [
        {
          href: "https://cdn.example.test/private.css",
          reason: "Stylesheet inaccesibil (CORS).",
        },
      ],
    });

    const result = await service.analyzeCurrentPage(project.id);

    expect(result.inaccessibleStylesheets).toHaveLength(1);
    expect(result.version.versionNumber).toBe(1);
  });

  it("rejects missing projects before starting browser capture", async () => {
    await expect(service.analyzeCurrentPage("missing")).rejects.toThrow(
      "Proiectul nu mai există.",
    );
    expect(captureSource.captureCurrentPage).not.toHaveBeenCalled();
  });
});
