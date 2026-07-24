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
import {
  PageRepository,
  ProjectRepository,
} from "../persistence/repositories.js";
import {
  TOTAL_CAPTURE_STEPS,
  type PageCapture,
  type PageCaptureProgressListener,
  toPageAnalysisProgress,
} from "./page-capture.js";

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
}

interface StoredAnalysisArtifact {
  schemaVersion: 1;
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

export class PageAnalysisService {
  private readonly activeProjects = new Set<string>();

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly pageRepository: PageRepository,
    private readonly captureSource: PageCaptureSource,
    private readonly options: PageAnalysisServiceOptions,
  ) {}

  public async getCurrentTarget(
    projectId: string,
  ): Promise<PageAnalysisTarget> {
    this.requireProject(projectId);
    const metadata = await this.captureSource.getCurrentPageMetadata(projectId);
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
      const versionNumber =
        (existingPage === undefined
          ? 0
          : (this.pageRepository.findLatestVersion(existingPage.id)
              ?.versionNumber ?? 0)) + 1;
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
      };
      const analysisArtifact: StoredAnalysisArtifact = {
        schemaVersion: 1,
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
      };

      onProgress?.(
        toPageAnalysisProgress(
          projectId,
          "saving_artifacts",
          6,
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
          7,
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
        };
      }),
    );
    return summaries.filter(
      (summary): summary is AnalyzedPageSummary => summary !== undefined,
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
