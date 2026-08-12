// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { AnalyzedPageSummary } from "../shared/page-analysis.js";
import type { TestDataset } from "../shared/test-model.js";
import { ExportPanel } from "./ExportPanel.js";

const dataset: TestDataset = {
  id: "dataset-1",
  testId: "test-1",
  name: "Client demo",
  values: { email: "client@example.test" },
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
};

const page: AnalyzedPageSummary = {
  page: {
    id: "page-1",
    projectId: "project-1",
    name: "Booking",
    url: "https://clinic.example.test/booking",
    normalizedUrl: "https://clinic.example.test/booking",
    createdAt: "2026-07-25T10:00:00.000Z",
    updatedAt: "2026-07-25T10:00:00.000Z",
  },
  latestVersion: {
    id: "version-1",
    pageId: "page-1",
    versionNumber: 1,
    createdAt: "2026-07-25T10:00:00.000Z",
    normalizedUrl: "https://clinic.example.test/booking",
    domFilePath: "dom.html",
    cssFilePath: "styles.css",
    accessibilityFilePath: "accessibility.json",
    analysisFilePath: "analysis.json",
    semanticHash: "hash",
  },
  title: "Booking",
  counts: {
    visibleTexts: 1,
    interactiveElements: 1,
    forms: 0,
    inputs: 0,
    buttons: 1,
    links: 0,
    selectableElements: 0,
    inlineStyles: 0,
    styleTags: 0,
    externalStylesheets: 0,
  },
  inaccessibleStylesheets: [],
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("ExportPanel", () => {
  it("exports test, datasets, page analysis and the full bundle", async () => {
    const user = userEvent.setup();
    const exportTestJson = vi
      .fn()
      .mockResolvedValue({ path: "D:\\exports\\test.json" });
    const exportDatasetJson = vi
      .fn()
      .mockResolvedValue({ path: "D:\\exports\\dataset.json" });
    const exportAllDatasetsJson = vi
      .fn()
      .mockResolvedValue({ path: "D:\\exports\\datasets.json" });
    const exportPageAnalysisJson = vi
      .fn()
      .mockResolvedValue({ path: "D:\\exports\\analysis.json" });
    const exportAnalysisBundle = vi
      .fn()
      .mockResolvedValue({ path: "D:\\exports\\bundle" });
    const api = {
      listDatasets: vi.fn().mockResolvedValue([dataset]),
      listAnalyzedPages: vi.fn().mockResolvedValue([page]),
      exportTestJson,
      exportDatasetJson,
      exportAllDatasetsJson,
      exportPageAnalysisJson,
      exportAnalysisBundle,
    } as unknown as SemanticAppApi;

    render(<ExportPanel api={api} projectId="project-1" testId="test-1" />);
    await waitFor(() => {
      expect(
        screen.getByLabelText<HTMLSelectElement>("Dataset individual").value,
      ).toBe("dataset-1");
      expect(
        screen.getByLabelText<HTMLSelectElement>("Analiză pagină").value,
      ).toBe("page-1");
    });

    await user.click(
      screen.getByRole("button", { name: /Exportă test JSON/i }),
    );
    await waitFor(() => expect(exportTestJson).toHaveBeenCalledOnce());
    await user.click(
      screen.getByRole("button", {
        name: /Exportă toate dataset-urile/i,
      }),
    );
    await waitFor(() => expect(exportAllDatasetsJson).toHaveBeenCalledOnce());
    await user.click(
      screen.getByRole("button", {
        name: /Exportă dataset-ul selectat/i,
      }),
    );
    await waitFor(() => expect(exportDatasetJson).toHaveBeenCalledOnce());
    await user.click(
      screen.getByRole("button", {
        name: /Exportă analiza selectată/i,
      }),
    );
    await waitFor(() => expect(exportPageAnalysisJson).toHaveBeenCalledOnce());
    await user.click(
      screen.getByRole("button", { name: /Exportă analysis bundle/i }),
    );
    await waitFor(() => expect(exportAnalysisBundle).toHaveBeenCalledOnce());

    expect(exportTestJson).toHaveBeenCalledWith("project-1", "test-1");
    expect(exportAllDatasetsJson).toHaveBeenCalledWith("project-1", "test-1");
    expect(exportDatasetJson).toHaveBeenCalledWith(
      "project-1",
      "test-1",
      "dataset-1",
    );
    expect(exportPageAnalysisJson).toHaveBeenCalledWith("project-1", "page-1");
    expect(exportAnalysisBundle).toHaveBeenCalledWith("project-1");
    expect(await screen.findByText(/Export finalizat:/i)).not.toBeNull();
  });
});
