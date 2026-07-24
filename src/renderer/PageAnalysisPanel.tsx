import { useCallback, useEffect, useMemo, useState } from "react";

import type { BrowserManagerStatus } from "../shared/browser-manager.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  AnalyzedPageSummary,
  PageAnalysisProgress,
  PageAnalysisResult,
  PageAnalysisTarget,
} from "../shared/page-analysis.js";
import type { Project } from "../shared/persistence.js";
import { Button } from "./components/Button.js";

export interface PageAnalysisPanelProps {
  api: SemanticAppApi;
  browserStatus: BrowserManagerStatus;
  project: Project;
  onAnalysisCompleted: () => void;
}

const formatCapturedAt = (value: string): string =>
  new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));

const countCards = (result: PageAnalysisResult) => [
  { label: "Texte vizibile", value: result.counts.visibleTexts },
  { label: "Interactive", value: result.counts.interactiveElements },
  { label: "Formulare", value: result.counts.forms },
  { label: "Inputuri", value: result.counts.inputs },
  { label: "Butoane", value: result.counts.buttons },
  { label: "Linkuri", value: result.counts.links },
];

export const PageAnalysisPanel = ({
  api,
  browserStatus,
  project,
  onAnalysisCompleted,
}: PageAnalysisPanelProps) => {
  const [target, setTarget] = useState<PageAnalysisTarget>();
  const [pages, setPages] = useState<AnalyzedPageSummary[]>([]);
  const [progress, setProgress] = useState<PageAnalysisProgress>();
  const [result, setResult] = useState<PageAnalysisResult>();
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string>();
  const browserIsReady =
    browserStatus.state === "running" && browserStatus.projectId === project.id;

  const loadPages = useCallback(async () => {
    try {
      setPages(await api.listAnalyzedPages(project.id));
    } catch {
      setPages([]);
    }
  }, [api, project.id]);

  const loadTarget = useCallback(async () => {
    if (!browserIsReady) {
      setTarget(undefined);
      return;
    }

    try {
      setTarget(await api.getCurrentPageAnalysisTarget(project.id));
    } catch {
      setTarget(undefined);
    }
  }, [api, browserIsReady, project.id]);

  useEffect(() => {
    setResult(undefined);
    setProgress(undefined);
    setError(undefined);
    void loadPages();
    void loadTarget();
  }, [loadPages, loadTarget, project.id]);

  useEffect(() => {
    if (!browserIsReady) {
      return;
    }

    const refreshInterval = window.setInterval(() => {
      void loadTarget();
    }, 1_500);
    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [browserIsReady, loadTarget]);

  useEffect(
    () =>
      api.onPageAnalysisProgress((nextProgress) => {
        if (nextProgress.projectId === project.id) {
          setProgress(nextProgress);
        }
      }),
    [api, project.id],
  );

  const analyze = async (): Promise<void> => {
    setIsAnalyzing(true);
    setError(undefined);
    setResult(undefined);
    setProgress({
      projectId: project.id,
      stage: "preparing",
      completedSteps: 0,
      totalSteps: 9,
      message: "Se pregătește analiza paginii curente.",
    });

    try {
      const analysis = await api.analyzeCurrentPage(project.id);
      setResult(analysis);
      await Promise.all([loadPages(), loadTarget()]);
      onAnalysisCompleted();
    } catch {
      setError(
        "Pagina nu a putut fi analizată. Verifică dacă tabul este deschis și încărcat complet.",
      );
    } finally {
      setIsAnalyzing(false);
    }
  };

  const progressPercent = useMemo(() => {
    if (progress === undefined || progress.totalSteps <= 0) {
      return 0;
    }
    return Math.round((progress.completedSteps / progress.totalSteps) * 100);
  }, [progress]);

  return (
    <section
      className="mt-6 rounded-xl border border-app-border bg-app-canvas p-5"
      aria-labelledby={`page-analysis-${project.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h4
              id={`page-analysis-${project.id}`}
              className="text-base font-semibold"
            >
              Motor de captură pagină
            </h4>
            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
              Diagnostic local · fără AI
            </span>
          </div>
          <p className="mt-1 text-sm text-app-muted">
            În timpul recorderului, această captură rulează automat după
            acțiuni. Butonul manual rămâne pentru diagnostic și reanalizare.
          </p>
        </div>
        <Button
          disabled={!browserIsReady || isAnalyzing}
          onClick={() => {
            void analyze();
          }}
        >
          {isAnalyzing
            ? "Se analizează..."
            : target?.isAnalyzed
              ? "Reanalizează pagina"
              : "Analizează pagina"}
        </Button>
      </div>

      <div className="mt-4 rounded-lg border border-app-border bg-app-surface p-3">
        <p className="text-xs font-semibold tracking-wide text-app-muted uppercase">
          Pagina curentă
        </p>
        {target ? (
          <>
            <p
              className="mt-1 truncate text-sm font-medium"
              title={target.title}
            >
              {target.title || "Fără titlu"}
            </p>
            <p
              className="mt-1 break-all text-xs text-brand-700"
              title={target.url}
            >
              {target.url}
            </p>
            {target.isAnalyzed ? (
              <p className="mt-2 text-xs text-emerald-700">
                Analizată anterior · versiunea {target.latestVersionNumber}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-1 text-sm text-app-muted">
            {browserIsReady
              ? "Nu a fost detectată încă o pagină HTTP(S) deschisă."
              : "Pornește browserul proiectului pentru a analiza pagina curentă."}
          </p>
        )}
      </div>

      {progress && (isAnalyzing || progress.stage === "completed") ? (
        <div className="mt-4" role="status" aria-live="polite">
          <div className="flex items-center justify-between gap-4 text-xs">
            <span className="font-medium">{progress.message}</span>
            <span className="text-app-muted">{progressPercent}%</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-brand-100"
            role="progressbar"
            aria-label="Progres analiză"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={progressPercent}
          >
            <div
              className="h-full rounded-full bg-brand-600 transition-[width]"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        </div>
      ) : null}

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h5 className="font-semibold text-emerald-950">
                Analiză salvată · versiunea {result.version.versionNumber}
              </h5>
              <p className="mt-1 text-xs text-emerald-800">
                {formatCapturedAt(result.capturedAt)}
              </p>
            </div>
            <span className="rounded-full bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800">
              {result.inaccessibleStylesheets.length === 0
                ? "CSS complet accesibil"
                : `${result.inaccessibleStylesheets.length} stylesheet inaccesibil`}
            </span>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
            {countCards(result).map(({ label, value }) => (
              <div
                key={label}
                className="rounded-lg border border-emerald-200 bg-white/80 p-3"
              >
                <p className="text-lg font-semibold text-emerald-950">
                  {value}
                </p>
                <p className="text-[11px] text-emerald-800">{label}</p>
              </div>
            ))}
          </div>
          <div className="mt-4 text-xs text-emerald-900">
            <p className="font-semibold">Artefacte create</p>
            <p className="mt-1 break-all font-mono">
              {result.artifactDirectory}
            </p>
            <p className="mt-1">
              dom.html · styles.css · accessibility.json · analysis.json ·
              semantic-analysis.json
            </p>
          </div>
          {result.inaccessibleStylesheets.length > 0 ? (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
              Analiza a continuat, dar stylesheet-urile blocate de CORS au fost
              marcate în rezultat.
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-5 border-t border-app-border pt-4">
        <h5 className="text-sm font-semibold">Istoric pagini analizate</h5>
        {pages.length === 0 ? (
          <p className="mt-2 text-sm text-app-muted">
            Proiectul nu are încă pagini analizate.
          </p>
        ) : (
          <ul className="mt-3 grid gap-2">
            {pages.map((summary) => (
              <li
                key={summary.page.id}
                className="rounded-lg border border-app-border bg-app-surface p-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">
                      {summary.title}
                    </p>
                    <p className="mt-1 break-all text-xs text-app-muted">
                      {summary.page.normalizedUrl}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold text-brand-700">
                    v{summary.latestVersion.versionNumber}
                  </span>
                </div>
                <p className="mt-2 text-xs text-app-muted">
                  {summary.counts.interactiveElements} elemente interactive ·{" "}
                  {summary.counts.forms} formulare · {summary.counts.buttons}{" "}
                  butoane
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
