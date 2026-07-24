import type { Page, PageVersion } from "./persistence.js";

export type PageAnalysisStage =
  | "preparing"
  | "capturing_html"
  | "capturing_accessibility"
  | "capturing_elements"
  | "capturing_styles"
  | "saving_artifacts"
  | "creating_version"
  | "completed";

export interface PageAnalysisProgress {
  projectId: string;
  stage: PageAnalysisStage;
  completedSteps: number;
  totalSteps: number;
  message: string;
}

export interface PageAnalysisCounts {
  visibleTexts: number;
  interactiveElements: number;
  forms: number;
  inputs: number;
  buttons: number;
  links: number;
  selectableElements: number;
  inlineStyles: number;
  styleTags: number;
  externalStylesheets: number;
}

export interface InaccessibleStylesheet {
  href: string;
  reason: string;
}

export interface PageAnalysisTarget {
  projectId: string;
  tabId: string;
  url: string;
  normalizedUrl: string;
  title: string;
  isAnalyzed: boolean;
  pageId?: string;
  latestVersionNumber?: number;
}

export interface PageAnalysisResult {
  projectId: string;
  page: Page;
  version: PageVersion;
  title: string;
  url: string;
  normalizedUrl: string;
  capturedAt: string;
  counts: PageAnalysisCounts;
  inaccessibleStylesheets: InaccessibleStylesheet[];
  artifactDirectory: string;
}

export interface AnalyzedPageSummary {
  page: Page;
  latestVersion: PageVersion;
  title: string;
  counts: PageAnalysisCounts;
  inaccessibleStylesheets: InaccessibleStylesheet[];
}

export const normalizeAnalyzedPageUrl = (value: string): string => {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Pagina curentă trebuie să folosească HTTP sau HTTPS.");
  }

  url.search = "";
  url.hash = "";
  return url.toString();
};
