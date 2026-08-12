import { useEffect, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { AnalyzedPageSummary } from "../shared/page-analysis.js";
import type { TestDataset } from "../shared/persistence.js";
import { Button } from "./components/Button.js";
import { Select } from "./components/Select.js";

export interface ExportPanelProps {
  api: SemanticAppApi;
  projectId: string;
  testId: string;
}

export const ExportPanel = ({ api, projectId, testId }: ExportPanelProps) => {
  const [datasets, setDatasets] = useState<TestDataset[]>([]);
  const [pages, setPages] = useState<AnalyzedPageSummary[]>([]);
  const [datasetId, setDatasetId] = useState("");
  const [pageId, setPageId] = useState("");
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.listDatasets(projectId, testId),
      api.listAnalyzedPages(projectId),
    ])
      .then(([loadedDatasets, loadedPages]) => {
        if (!active) return;
        setDatasets(loadedDatasets);
        setPages(loadedPages);
        setDatasetId(loadedDatasets[0]?.id ?? "");
        setPageId(loadedPages[0]?.page.id ?? "");
      })
      .catch(() => {
        if (active) setError("Opțiunile de export nu au putut fi încărcate.");
      });
    return () => {
      active = false;
    };
  }, [api, projectId, testId]);

  const runExport = async (
    key: string,
    action: () => Promise<{ path: string } | undefined>,
  ): Promise<void> => {
    setBusy(key);
    setError(undefined);
    setMessage(undefined);
    try {
      const result = await action();
      if (result !== undefined) {
        setMessage(`Export finalizat: ${result.path}`);
      }
    } catch {
      setError("Exportul nu a putut fi finalizat.");
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-app-surface p-4">
      <div>
        <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
          Portabilitate
        </p>
        <h3 className="mt-1 font-semibold">Export JSON și analysis bundle</h3>
        <p className="mt-1 text-sm text-app-muted">
          Exporturile includ schemaVersion 1 și exclud credentialele,
          conexiunile și cheile API.
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={busy !== undefined}
          onClick={() =>
            void runExport("test", () => api.exportTestJson(projectId, testId))
          }
        >
          Exportă test JSON
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== undefined}
          onClick={() =>
            void runExport("all-datasets", () =>
              api.exportAllDatasetsJson(projectId, testId),
            )
          }
        >
          Exportă toate dataset-urile
        </Button>
        <Button
          variant="secondary"
          disabled={busy !== undefined}
          onClick={() =>
            void runExport("bundle", () => api.exportAnalysisBundle(projectId))
          }
        >
          Exportă analysis bundle
        </Button>
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="grid gap-2 rounded-lg border border-app-border bg-slate-50 p-3">
          <Select
            label="Dataset individual"
            value={datasetId}
            disabled={datasets.length === 0 || busy !== undefined}
            options={
              datasets.length === 0
                ? [{ value: "", label: "Niciun dataset" }]
                : datasets.map((dataset) => ({
                    value: dataset.id,
                    label: dataset.name,
                  }))
            }
            onChange={(event) => setDatasetId(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={datasetId.length === 0 || busy !== undefined}
            onClick={() =>
              void runExport("dataset", () =>
                api.exportDatasetJson(projectId, testId, datasetId),
              )
            }
          >
            Exportă dataset-ul selectat
          </Button>
        </div>
        <div className="grid gap-2 rounded-lg border border-app-border bg-slate-50 p-3">
          <Select
            label="Analiză pagină"
            value={pageId}
            disabled={pages.length === 0 || busy !== undefined}
            options={
              pages.length === 0
                ? [{ value: "", label: "Nicio pagină analizată" }]
                : pages.map((page) => ({
                    value: page.page.id,
                    label: page.title,
                  }))
            }
            onChange={(event) => setPageId(event.target.value)}
          />
          <Button
            variant="secondary"
            disabled={pageId.length === 0 || busy !== undefined}
            onClick={() =>
              void runExport("page", () =>
                api.exportPageAnalysisJson(projectId, pageId),
              )
            }
          >
            Exportă analiza selectată
          </Button>
        </div>
      </div>
      {busy !== undefined ? (
        <p className="mt-3 text-sm text-app-muted" role="status">
          Se pregătește exportul...
        </p>
      ) : null}
      {message ? (
        <p className="mt-3 break-all text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
