import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";

import type {
  AnalyzedPageSummary,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "../../shared/page-analysis.js";
import { normalizeAnalyzedPageUrl } from "../../shared/page-analysis.js";
import type { Page, PageVersion } from "../../shared/persistence.js";
import type { JsonValue } from "../../shared/persistence.js";
import type { SemanticAnalysis } from "../../shared/semantic-analysis.js";
import {
  PageRepository,
  ProjectRepository,
  TestRepository,
} from "../persistence/repositories.js";
import {
  TOTAL_CAPTURE_STEPS,
  type PageCapture,
  type PageCaptureProgressListener,
  toPageAnalysisProgress,
} from "./page-capture.js";
import { analyzePageSemantics } from "./semantic-analyzer.js";
import {
  detectSemanticChange,
  type SemanticComparisonSnapshot,
} from "./semantic-change-detector.js";

export interface CurrentPageMetadata {
  tabId: string;
  projectId: string;
  url: string;
  title: string;
}

export interface PageCaptureSource {
  getCurrentPageMetadata: (projectId: string) => Promise<CurrentPageMetadata>;
  captureCurrentPage: (
    projectId: string,
    onProgress?: PageCaptureProgressListener,
  ) => Promise<PageCapture>;
}

export interface PageAnalysisServiceOptions {
  artifactRoot: string;
  createId: () => string;
  now: () => Date;
  semanticChangeThreshold?: number;
}

interface StoredAnalysisArtifact {
  schemaVersion: 2;
  projectId: string;
  pageId: string;
  pageVersionId: string;
  versionNumber: number;
  capturedAt: string;
  url: string;
  normalizedUrl: string;
  title: string;
  htmlLength: number;
  serializedDomLength: number;
  counts: PageAnalysisResult["counts"];
  inaccessibleStylesheets: PageAnalysisResult["inaccessibleStylesheets"];
  visibleTexts: PageCapture["visibleTexts"];
  interactiveElements: PageCapture["interactiveElements"];
  ariaElements: PageCapture["ariaElements"];
  dataElements: PageCapture["dataElements"];
  statefulElements: PageCapture["statefulElements"];
  forms: PageCapture["forms"];
  inputs: PageCapture["inputs"];
  buttons: PageCapture["buttons"];
  links: PageCapture["links"];
  selectableElements: PageCapture["selectableElements"];
  inlineStyles: PageCapture["inlineStyles"];
  styleTags: PageCapture["styleTags"];
  stylesheets: PageCapture["stylesheets"];
  shadowRoots: PageCapture["shadowRoots"];
  allElements: PageCapture["allElements"];
  semanticAnalysisFilePath: string;
  semanticAnalysis: SemanticAnalysis;
}

const emptyCounts = (): PageAnalysisResult["counts"] => ({
  visibleTexts: 0,
  interactiveElements: 0,
  forms: 0,
  inputs: 0,
  buttons: 0,
  links: 0,
  selectableElements: 0,
  inlineStyles: 0,
  styleTags: 0,
  externalStylesheets: 0,
});

const safeSegment = (value: string): string => {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) {
    throw new Error("Identificatorul artefactului nu este valid.");
  }
  return value;
};

const toPortablePath = (value: string): string => value.replaceAll("\\", "/");

const serializeJson = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

type CapturedElement = PageCapture["allElements"][number];

const calendarControlPattern =
  /calendar|datepicker|date-picker|(?:^|[-_])cal[-_]|prev[-_]?month|next[-_]?month|month[-_]?prev|month[-_]?next/i;
const calendarPeriodPattern =
  /\b(?:ianuarie|februarie|martie|aprilie|mai|iunie|iulie|august|septembrie|octombrie|noiembrie|decembrie|january|february|march|april|may|june|july|august|september|october|november|december)\s+20\d{2}\b/i;

const cssClassLocator = (element: CapturedElement): string | undefined => {
  const classes = (element.attributes.class ?? "")
    .split(/\s+/)
    .filter((token) => /^[a-zA-Z_][\w-]*$/.test(token));
  const preferred =
    classes.find((token) => /calendar|month|header|^cal-/i.test(token)) ??
    classes[0];
  return preferred === undefined ? undefined : `.${preferred}`;
};

const capturedElementHint = (
  element: CapturedElement,
  kind: string,
): JsonValue => {
  const id = element.attributes.id;
  const strategy =
    typeof id === "string" && /^[a-zA-Z_][\w-]*$/.test(id)
      ? { type: "css", operator: "equals", value: `#${id}` }
      : {
          type: "css",
          operator: "equals",
          value: cssClassLocator(element) ?? element.cssSelector,
        };
  return {
    kind,
    tag: element.tag,
    text: element.text.slice(0, 300),
    primaryLocator: {
      strategy,
      unique: true,
      stability: id === undefined ? 0.65 : 0.93,
      reason: "Locator capturat din structura reală a paginii.",
    },
  };
};

const calendarRuntimeHints = (artifact: StoredAnalysisArtifact): JsonValue => {
  const navigationControls = artifact.interactiveElements
    .filter((element) =>
      calendarControlPattern.test(
        `${element.cssSelector} ${JSON.stringify(element.attributes)}`,
      ),
    )
    .slice(0, 8);
  const parentPaths = new Set(
    navigationControls
      .map(({ parentPath }) => parentPath)
      .filter((path): path is string => path !== null),
  );
  const periodMarkers = artifact.allElements
    .filter(
      (element) =>
        parentPaths.has(element.path) &&
        calendarPeriodPattern.test(element.text),
    )
    .slice(0, 4);
  const dateCellTemplates = artifact.dataElements
    .filter((element) =>
      /^20\d{2}-\d{2}-\d{2}$/.test(element.dataAttributes["data-date"] ?? ""),
    )
    .slice(0, 3)
    .map((element): JsonValue => ({
      kind: "calendar_date_cell_template",
      tag: element.tag,
      text: element.text.slice(0, 40),
      primaryLocator: {
        strategy: {
          type: "data_attribute",
          attribute: "data-date",
          operator: "equals",
          value: element.dataAttributes["data-date"]!,
        },
        unique: true,
        stability: 0.95,
        reason: "Atribut data-date capturat din structura reală a paginii.",
      },
    }));
  return {
    periodMarkers: periodMarkers.map((element) =>
      capturedElementHint(element, "calendar_period_marker"),
    ),
    navigationControls: navigationControls.map((element) =>
      capturedElementHint(
        element,
        /prev|previous|anterioar/i.test(
          `${element.cssSelector} ${JSON.stringify(element.attributes)}`,
        )
          ? "calendar_previous_month"
          : "calendar_next_month",
      ),
    ),
    dateCellTemplates,
  };
};

export class PageAnalysisService {
  private readonly activeProjects = new Set<string>();

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly pageRepository: PageRepository,
    private readonly testRepository: TestRepository,
    private readonly captureSource: PageCaptureSource,
    private readonly options: PageAnalysisServiceOptions,
  ) {}

  public async getCurrentTarget(
    projectId: string,
  ): Promise<PageAnalysisTarget | undefined> {
    this.requireProject(projectId);
    let metadata: CurrentPageMetadata;
    try {
      metadata = await this.captureSource.getCurrentPageMetadata(projectId);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("Nu există o pagină web deschisă")
      ) {
        return undefined;
      }
      throw error;
    }
    const normalizedUrl = normalizeAnalyzedPageUrl(metadata.url);
    const page = this.pageRepository.findByProjectAndNormalizedUrl(
      projectId,
      normalizedUrl,
    );
    const latestVersion =
      page === undefined
        ? undefined
        : this.pageRepository.findLatestVersion(page.id);

    return {
      projectId,
      tabId: metadata.tabId,
      url: metadata.url,
      normalizedUrl,
      title: metadata.title,
      isAnalyzed: latestVersion !== undefined,
      ...(page === undefined ? {} : { pageId: page.id }),
      ...(latestVersion === undefined
        ? {}
        : { latestVersionNumber: latestVersion.versionNumber }),
    };
  }

  public async analyzeCurrentPage(
    projectId: string,
    onProgress?: (progress: PageAnalysisProgress) => void,
  ): Promise<PageAnalysisResult> {
    this.requireProject(projectId);

    if (this.activeProjects.has(projectId)) {
      throw new Error(
        "O analiză este deja în desfășurare pentru acest proiect.",
      );
    }

    this.activeProjects.add(projectId);
    let finalDirectory: string | undefined;

    try {
      const progressListener: PageCaptureProgressListener = (
        stage,
        completedSteps,
        message,
      ) => {
        onProgress?.(
          toPageAnalysisProgress(projectId, stage, completedSteps, message),
        );
      };
      const capture = await this.captureSource.captureCurrentPage(
        projectId,
        progressListener,
      );
      const normalizedUrl = normalizeAnalyzedPageUrl(capture.url);
      const capturedAt = this.options.now().toISOString();
      const existingPage = this.pageRepository.findByProjectAndNormalizedUrl(
        projectId,
        normalizedUrl,
      );
      const pageId = existingPage?.id ?? this.options.createId();
      const pageVersionId = this.options.createId();
      const previousVersion =
        existingPage === undefined
          ? undefined
          : this.pageRepository.findLatestVersion(existingPage.id);
      const versionNumber = (previousVersion?.versionNumber ?? 0) + 1;
      const title = this.pageTitle(capture.title, capture.url);
      const page: Page = {
        id: pageId,
        projectId,
        name: title,
        url: capture.url,
        normalizedUrl,
        createdAt: existingPage?.createdAt ?? capturedAt,
        updatedAt: capturedAt,
      };
      const portableDirectory = toPortablePath(
        join(
          "projects",
          safeSegment(projectId),
          "pages",
          safeSegment(pageId),
          `v${versionNumber}`,
        ),
      );
      finalDirectory = this.resolveArtifactPath(portableDirectory);
      const temporaryDirectory = `${finalDirectory}.tmp-${safeSegment(pageVersionId)}`;
      const domFilePath = `${portableDirectory}/dom.html`;
      const cssFilePath = `${portableDirectory}/styles.css`;
      const accessibilityFilePath = `${portableDirectory}/accessibility.json`;
      const analysisFilePath = `${portableDirectory}/analysis.json`;
      const semanticHash = createHash("sha256")
        .update(normalizedUrl)
        .update("\0")
        .update(capture.serializedDom)
        .update("\0")
        .update(capture.css)
        .update("\0")
        .update(capture.accessibilitySnapshot)
        .digest("hex");
      onProgress?.(
        toPageAnalysisProgress(
          projectId,
          "analyzing_semantics",
          6,
          "Se construiește modelul semantic local.",
        ),
      );
      const semanticAnalysis = analyzePageSemantics(capture, {
        generatedAt: capturedAt,
        url: capture.url,
      });
      const previousSnapshot =
        previousVersion === undefined
          ? undefined
          : await this.loadComparisonSnapshot(previousVersion);
      const semanticChange =
        previousVersion === undefined || previousSnapshot === undefined
          ? undefined
          : detectSemanticChange({
              previousPageVersionId: previousVersion.id,
              currentPageVersionId: pageVersionId,
              previous: previousSnapshot,
              current: {
                dom: capture.html,
                interactiveElements: capture.interactiveElements,
                forms: capture.forms,
                semanticAnalysis,
              },
              threshold: this.options.semanticChangeThreshold ?? 0.3,
            });
      const semanticAnalysisFilePath = `${portableDirectory}/semantic-analysis.json`;
      const version: PageVersion = {
        id: pageVersionId,
        pageId,
        versionNumber,
        createdAt: capturedAt,
        normalizedUrl,
        domFilePath,
        cssFilePath,
        accessibilityFilePath,
        analysisFilePath,
        semanticHash,
        ...(semanticChange === undefined ? {} : { change: semanticChange }),
      };
      const analysisArtifact: StoredAnalysisArtifact = {
        schemaVersion: 2,
        projectId,
        pageId,
        pageVersionId,
        versionNumber,
        capturedAt,
        url: capture.url,
        normalizedUrl,
        title,
        htmlLength: capture.html.length,
        serializedDomLength: capture.serializedDom.length,
        counts: capture.counts,
        inaccessibleStylesheets: capture.inaccessibleStylesheets,
        visibleTexts: capture.visibleTexts,
        interactiveElements: capture.interactiveElements,
        ariaElements: capture.ariaElements,
        dataElements: capture.dataElements,
        statefulElements: capture.statefulElements,
        forms: capture.forms,
        inputs: capture.inputs,
        buttons: capture.buttons,
        links: capture.links,
        selectableElements: capture.selectableElements,
        inlineStyles: capture.inlineStyles,
        styleTags: capture.styleTags,
        stylesheets: capture.stylesheets,
        shadowRoots: capture.shadowRoots,
        allElements: capture.allElements,
        semanticAnalysisFilePath,
        semanticAnalysis,
      };

      onProgress?.(
        toPageAnalysisProgress(
          projectId,
          "saving_artifacts",
          7,
          "Se salvează artefactele locale.",
        ),
      );
      await mkdir(dirname(temporaryDirectory), { recursive: true });
      await mkdir(temporaryDirectory);
      try {
        await Promise.all([
          writeFile(join(temporaryDirectory, "dom.html"), capture.html, "utf8"),
          writeFile(
            join(temporaryDirectory, "styles.css"),
            capture.css,
            "utf8",
          ),
          writeFile(
            join(temporaryDirectory, "accessibility.json"),
            serializeJson({
              schemaVersion: 1,
              projectId,
              pageId,
              pageVersionId,
              capturedAt,
              url: capture.url,
              format: "playwright-aria-snapshot-yaml",
              snapshot: capture.accessibilitySnapshot,
            }),
            "utf8",
          ),
          writeFile(
            join(temporaryDirectory, "analysis.json"),
            serializeJson(analysisArtifact),
            "utf8",
          ),
          writeFile(
            join(temporaryDirectory, "semantic-analysis.json"),
            serializeJson(semanticAnalysis),
            "utf8",
          ),
        ]);
        await rename(temporaryDirectory, finalDirectory);
      } catch (error) {
        await rm(temporaryDirectory, { recursive: true, force: true });
        throw error;
      }

      onProgress?.(
        toPageAnalysisProgress(
          projectId,
          "creating_version",
          8,
          `Se creează versiunea ${versionNumber} a paginii.`,
        ),
      );
      try {
        if (existingPage === undefined) {
          this.pageRepository.create(page);
        } else {
          this.pageRepository.update(page);
        }
        this.pageRepository.createVersion(version);
      } catch (error) {
        await rm(finalDirectory, { recursive: true, force: true });
        finalDirectory = undefined;
        if (existingPage === undefined) {
          this.pageRepository.delete(page.id);
        } else {
          this.pageRepository.update(existingPage);
        }
        throw error;
      }

      const invalidatedTestIds =
        semanticChange?.exceeded === true
          ? this.invalidateAssociatedTests(
              page,
              version,
              semanticChange.score,
              semanticChange.threshold,
              capturedAt,
            )
          : [];

      const result: PageAnalysisResult = {
        projectId,
        page,
        version,
        title,
        url: capture.url,
        normalizedUrl,
        capturedAt,
        counts: capture.counts,
        inaccessibleStylesheets: capture.inaccessibleStylesheets,
        artifactDirectory: portableDirectory,
        ...(semanticChange === undefined ? {} : { semanticChange }),
        ...(invalidatedTestIds.length === 0 ? {} : { invalidatedTestIds }),
      };
      onProgress?.(
        toPageAnalysisProgress(
          projectId,
          "completed",
          TOTAL_CAPTURE_STEPS,
          "Analiza paginii a fost salvată.",
        ),
      );
      return result;
    } finally {
      this.activeProjects.delete(projectId);
    }
  }

  public async listAnalyzedPages(
    projectId: string,
  ): Promise<AnalyzedPageSummary[]> {
    this.requireProject(projectId);
    const pages = this.pageRepository.listByProject(projectId);
    const summaries = await Promise.all(
      pages.map(async (page): Promise<AnalyzedPageSummary | undefined> => {
        const latestVersion = this.pageRepository.findLatestVersion(page.id);
        if (latestVersion === undefined) {
          return undefined;
        }

        let artifact:
          | Pick<
              StoredAnalysisArtifact,
              "counts" | "inaccessibleStylesheets" | "title"
            >
          | undefined;
        try {
          artifact = JSON.parse(
            await readFile(
              this.resolveArtifactPath(latestVersion.analysisFilePath),
              "utf8",
            ),
          ) as StoredAnalysisArtifact;
        } catch {
          artifact = undefined;
        }

        return {
          page,
          latestVersion,
          title: artifact?.title ?? page.name,
          counts: artifact?.counts ?? emptyCounts(),
          inaccessibleStylesheets: artifact?.inaccessibleStylesheets ?? [],
          ...(latestVersion.change === undefined
            ? {}
            : { latestChange: latestVersion.change }),
        };
      }),
    );
    return summaries.filter(
      (summary): summary is AnalyzedPageSummary => summary !== undefined,
    );
  }

  public async getAiSemanticContext(
    projectId: string,
    pageIds: string[],
  ): Promise<JsonValue[]> {
    this.requireProject(projectId);
    const uniquePageIds = [...new Set(pageIds)].slice(0, 10);
    const contexts = await Promise.all(
      uniquePageIds.map(async (pageId): Promise<JsonValue | undefined> => {
        const page = this.pageRepository.findById(pageId);
        if (page === undefined || page.projectId !== projectId) {
          return undefined;
        }
        const version = this.pageRepository.findLatestVersion(pageId);
        if (version === undefined) return undefined;
        try {
          const artifact = JSON.parse(
            await readFile(
              this.resolveArtifactPath(version.analysisFilePath),
              "utf8",
            ),
          ) as StoredAnalysisArtifact;
          return {
            pageId,
            pageVersionId: version.id,
            versionNumber: version.versionNumber,
            title: artifact.title,
            normalizedUrl: version.normalizedUrl,
            semanticAnalysis: artifact.semanticAnalysis as unknown as JsonValue,
            calendarRuntimeHints: calendarRuntimeHints(artifact),
          };
        } catch {
          return undefined;
        }
      }),
    );
    return contexts.filter(
      (context): context is JsonValue => context !== undefined,
    );
  }

  private requireProject(projectId: string): void {
    if (
      typeof projectId !== "string" ||
      projectId.length === 0 ||
      this.projectRepository.findById(projectId) === undefined
    ) {
      throw new Error("Proiectul nu mai există.");
    }
  }

  private pageTitle(title: string, urlValue: string): string {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length > 0) {
      return trimmedTitle.slice(0, 200);
    }

    const url = new URL(urlValue);
    return (url.pathname === "/" ? url.hostname : url.pathname).slice(0, 200);
  }

  private async loadComparisonSnapshot(
    version: PageVersion,
  ): Promise<SemanticComparisonSnapshot | undefined> {
    try {
      const [dom, artifactText] = await Promise.all([
        readFile(this.resolveArtifactPath(version.domFilePath), "utf8"),
        readFile(this.resolveArtifactPath(version.analysisFilePath), "utf8"),
      ]);
      const artifact = JSON.parse(artifactText) as StoredAnalysisArtifact;
      return {
        dom,
        interactiveElements: artifact.interactiveElements,
        forms: artifact.forms,
        semanticAnalysis: artifact.semanticAnalysis,
      };
    } catch {
      return undefined;
    }
  }

  private invalidateAssociatedTests(
    page: Page,
    version: PageVersion,
    score: number,
    threshold: number,
    detectedAt: string,
  ): string[] {
    const associated = this.testRepository
      .listByProject(page.projectId)
      .filter((test) => {
        const referencedByStep = test.flowItems.some(
          (item) => item.type === "action" && item.pageId === page.id,
        );
        const isStartPage = (() => {
          try {
            return (
              normalizeAnalyzedPageUrl(test.startUrl) === page.normalizedUrl
            );
          } catch {
            return false;
          }
        })();
        return referencedByStep || isStartPage;
      });
    for (const test of associated) {
      this.testRepository.update({
        ...test,
        status: "invalidated",
        updatedAt: detectedAt,
        invalidation: {
          pageId: page.id,
          pageVersionId: version.id,
          detectedAt,
          score,
          threshold,
        },
      });
    }
    return associated.map(({ id }) => id);
  }

  private resolveArtifactPath(portablePath: string): string {
    const root = resolve(this.options.artifactRoot);
    const target = resolve(root, ...portablePath.split("/"));
    const relativeTarget = relative(root, target);

    if (
      relativeTarget.length === 0 ||
      relativeTarget === ".." ||
      relativeTarget.startsWith(`..${sep}`) ||
      resolve(root, relativeTarget) !== target
    ) {
      throw new Error("Calea artefactului nu este validă.");
    }

    return target;
  }
}
