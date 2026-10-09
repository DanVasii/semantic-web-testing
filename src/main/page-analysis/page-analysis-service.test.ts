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
  TestRepository,
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
  allElements: [element],
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
let testRepository: TestRepository;
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
  testRepository = new TestRepository(database.connection);
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
    testRepository,
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
  it("returns no current target when the browser has no open web page", async () => {
    vi.mocked(captureSource.getCurrentPageMetadata).mockRejectedValueOnce(
      new Error("Nu există o pagină web deschisă pentru analiză."),
    );

    await expect(service.getCurrentTarget(project.id)).resolves.toBeUndefined();
  });

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
        completedSteps: 9,
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
    const analysisJson: unknown = JSON.parse(
      readFileSync(join(artifactDirectory, "analysis.json"), "utf8"),
    );
    expect(analysisJson).toMatchObject({
      schemaVersion: 2,
      title: "Produse",
      counts: capture.counts,
      buttons: [expect.objectContaining({ text: "Cumpără" })],
      ariaElements: [expect.objectContaining({ tag: "button" })],
      dataElements: [expect.objectContaining({ tag: "button" })],
    });
    expect(analysisJson).toHaveProperty(
      "semanticAnalysis.elements.0.accessibleName",
      "Cumpără produsul",
    );
    expect(analysisJson).toHaveProperty(
      "semanticAnalysis.elements.0.role",
      "button",
    );
    const semanticJson: unknown = JSON.parse(
      readFileSync(join(artifactDirectory, "semantic-analysis.json"), "utf8"),
    );
    expect(semanticJson).toMatchObject({
      schemaVersion: 1,
    });
    expect(semanticJson).toHaveProperty(
      "elements.0.accessibleName",
      "Cumpără produsul",
    );
    expect(semanticJson).toHaveProperty("elements.0.role", "button");
    expect(projectRepository.getStatistics(project.id).pageCount).toBe(1);
    const summaries = await service.listAnalyzedPages(project.id);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]?.title).toBe("Produse");
    expect(summaries[0]?.counts).toEqual(capture.counts);
    expect(summaries[0]?.latestVersion.versionNumber).toBe(1);
    const aiContext = await service.getAiSemanticContext(project.id, [
      result.page.id,
      "unknown-page",
    ]);
    expect(aiContext).toHaveLength(1);
    expect(aiContext[0]).toMatchObject({
      pageId: result.page.id,
      pageVersionId: result.version.id,
      versionNumber: 1,
      title: "Produse",
    });
    expect(JSON.stringify(aiContext[0])).toContain('"schemaVersion":1');
    expect(JSON.stringify(aiContext)).not.toContain(capture.html);
    expect(JSON.stringify(aiContext)).not.toContain(capture.css);
  });

  it("maps captured forms to semantic fields without using AI", async () => {
    const formPath = "/html[1]/body[1]/form[1]";
    const label = {
      ...element,
      path: `${formPath}/label[1]`,
      cssSelector: "#contact > label",
      tag: "label",
      text: "Adresă e-mail",
      attributes: { for: "contact-email" },
      ariaAttributes: {},
      dataAttributes: {},
      parentPath: formPath,
      formPath,
    };
    const email = {
      ...element,
      path: `${formPath}/input[1]`,
      cssSelector: "#contact-email",
      tag: "input",
      text: "",
      attributes: {
        id: "contact-email",
        name: "customer_email",
        type: "email",
        required: "",
        autocomplete: "email",
      },
      ariaAttributes: {},
      dataAttributes: {},
      parentPath: formPath,
      formPath,
    };
    const consentLabel = {
      ...element,
      path: `${formPath}/label[2]`,
      cssSelector: "#contact > label:nth-of-type(2)",
      tag: "label",
      text: "Sunt de acord să primesc noutăți și oferte prin e-mail.",
      attributes: { for: "marketing-consent" },
      ariaAttributes: {},
      dataAttributes: {},
      parentPath: formPath,
      formPath,
    };
    const consent = {
      ...element,
      path: `${formPath}/input[2]`,
      cssSelector: "#marketing-consent",
      tag: "input",
      text: "",
      attributes: {
        id: "marketing-consent",
        name: "marketing_consent",
        type: "checkbox",
      },
      ariaAttributes: {},
      dataAttributes: {},
      parentPath: formPath,
      formPath,
    };
    const submit = {
      ...element,
      path: `${formPath}/button[1]`,
      cssSelector: "#contact-submit",
      tag: "button",
      text: "Trimite",
      attributes: { id: "contact-submit", type: "submit" },
      ariaAttributes: {},
      dataAttributes: {},
      parentPath: formPath,
      formPath,
    };
    capture = createCapture({
      allElements: [label, email, consentLabel, consent, submit],
      interactiveElements: [email, consent, submit],
      forms: [
        {
          path: formPath,
          cssSelector: "#contact",
          name: "contact",
          method: "post",
          action: "https://example.test/contact",
          fieldPaths: [email.path, consent.path, submit.path],
        },
      ],
      inputs: [email, consent],
      buttons: [submit],
      counts: {
        ...createCapture().counts,
        forms: 1,
        inputs: 2,
        buttons: 1,
      },
    });

    const analyzed = await service.analyzeCurrentPage(project.id);
    const forms = await service.listForms(project.id, analyzed.page.id);

    expect(forms).toHaveLength(1);
    expect(forms[0]).toMatchObject({
      title: "contact",
      method: "post",
      fields: [
        {
          name: "customer_email",
          label: "Adresă e-mail",
          semanticType: "email",
          required: true,
          locator: { value: "#contact-email" },
        },
        {
          name: "marketing_consent",
          label: "Sunt de acord să primesc noutăți și oferte prin e-mail.",
          inputType: "checkbox",
          semanticType: "unknown",
          locator: { value: "#marketing-consent" },
        },
      ],
      submit: { label: "Trimite", locator: { value: "#contact-submit" } },
    });
  });

  it("adds compact runtime hints for custom calendar controls and date cells", async () => {
    const marker = {
      ...element,
      path: "/html[1]/body[1]/div[1]",
      parentPath: "/html[1]/body[1]",
      cssSelector: ".cal-header",
      tag: "div",
      text: "‹ Iulie 2026 ›",
      attributes: { class: "cal-header" },
      ariaAttributes: {},
      dataAttributes: {},
    };
    const next = {
      ...element,
      path: "/html[1]/body[1]/div[1]/button[1]",
      parentPath: marker.path,
      cssSelector: "#at-next-month",
      text: "›",
      attributes: { id: "at-next-month", class: "cal-nav" },
      ariaAttributes: {},
      dataAttributes: {},
    };
    const day = {
      ...element,
      path: "/html[1]/body[1]/div[2]",
      parentPath: "/html[1]/body[1]",
      cssSelector: "#calendar > div:nth-of-type(29)",
      tag: "div",
      text: "29",
      attributes: { "data-date": "2026-07-29", class: "cal-cell" },
      ariaAttributes: {},
      dataAttributes: { "data-date": "2026-07-29" },
    };
    capture = createCapture({
      allElements: [marker, next, day],
      interactiveElements: [next],
      ariaElements: [],
      dataElements: [day],
      statefulElements: [],
      buttons: [next],
      links: [],
    });

    const result = await service.analyzeCurrentPage(project.id);
    const [context] = await service.getAiSemanticContext(project.id, [
      result.page.id,
    ]);
    const serialized = JSON.stringify(context);

    expect(serialized).toContain('"kind":"calendar_period_marker"');
    expect(serialized).toContain('"value":".cal-header"');
    expect(serialized).toContain('"kind":"calendar_next_month"');
    expect(serialized).toContain('"value":"#at-next-month"');
    expect(serialized).toContain('"attribute":"data-date"');
    expect(serialized).toContain('"value":"2026-07-29"');
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
    await expect(service.getCurrentTarget(project.id)).resolves.toMatchObject({
      isAnalyzed: true,
      latestVersionNumber: 2,
    });
  });

  it("invalidates associated tests when the semantic score reaches the threshold", async () => {
    const first = await service.analyzeCurrentPage(project.id);
    testRepository.create({
      id: "test-1",
      projectId: project.id,
      name: "Cumpără produs",
      status: "valid",
      version: 1,
      testMode: "recorded",
      wipeBeforeRun: false,
      startMode: "base_url",
      startUrl: capture.url,
      normalizedStartUrl: capture.url,
      workflowState: "ready",
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      flowItems: [
        {
          id: "click-buy",
          type: "action",
          actionType: "click",
          title: "Cumpără",
          humanDescription: "Apasă butonul de cumpărare.",
          whyExplanation: "Adaugă produsul în coș.",
          pageId: first.page.id,
          target: {
            primary: {
              type: "role",
              role: "button",
              operator: "equals",
              value: "Cumpără produsul",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    });
    now = new Date("2026-07-24T13:00:00.000Z");
    const changedElement = {
      ...element,
      text: "Rezervă",
      attributes: { "aria-label": "Rezervă produsul" },
      ariaAttributes: { "aria-label": "Rezervă produsul" },
    };
    capture = createCapture({
      html: "<html><body><a href='/details'>Detalii</a></body></html>",
      serializedDom:
        "<html><head></head><body><a href='/details'>Detalii</a></body></html>",
      allElements: [changedElement],
      interactiveElements: [changedElement],
      ariaElements: [changedElement],
      buttons: [changedElement],
    });

    const second = await service.analyzeCurrentPage(project.id);

    expect(second.semanticChange?.exceeded).toBe(true);
    expect(second.invalidatedTestIds).toEqual(["test-1"]);
    expect(second.version.change).toEqual(second.semanticChange);
    expect(testRepository.findById("test-1")).toMatchObject({
      status: "invalidated",
      invalidation: {
        pageId: first.page.id,
        pageVersionId: second.version.id,
      },
    });
    expect(
      (await service.listAnalyzedPages(project.id))[0]?.latestChange,
    ).toEqual(second.semanticChange);
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
