import { useCallback, useEffect, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  StepRunResult,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { Button } from "./components/Button.js";

const idleSnapshot: RunnerSnapshot = {
  state: "idle",
  currentStepIndex: -1,
  totalSteps: 0,
  canStop: false,
  canRetry: false,
};

const stateLabels: Record<RunnerSnapshot["state"], string> = {
  idle: "Pregătit",
  preparing: "Se încarcă testul",
  browser_starting: "Se pregătește browserul",
  waiting_for_basic_auth: "Așteaptă autentificarea HTTP",
  waiting_for_start: "Așteaptă pornirea",
  running: "Rulează",
  waiting_at_breakpoint: "Oprit la breakpoint",
  waiting_after_step: "Așteaptă după pas",
  waiting_for_missing_data: "Lipsesc date",
  waiting_for_fallback_decision: "Așteaptă decizie fallback",
  waiting_for_manual_intervention: "Așteaptă intervenție manuală",
  waiting_for_mysql_check: "Verifică MySQL",
  waiting_for_imap_check: "Verifică e-mailul",
  paused_on_error: "Pauză la eroare",
  completed: "Trecut",
  failed: "Eșuat",
  stopped: "Oprit",
};

export interface RunnerPanelProps {
  api: SemanticAppApi;
  projectId: string;
  test: TestDefinition;
}

export const RunnerPanel = ({ api, projectId, test }: RunnerPanelProps) => {
  const [snapshot, setSnapshot] = useState<RunnerSnapshot>(idleSnapshot);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [stepResults, setStepResults] = useState<StepRunResult[]>([]);
  const [isStarting, setIsStarting] = useState(false);
  const [isFallbackBusy, setIsFallbackBusy] = useState(false);
  const [error, setError] = useState<string>();

  const loadHistory = useCallback(async () => {
    const loadedRuns = await api.listTestRuns(projectId, test.id);
    setRuns(loadedRuns);
    const latest = loadedRuns[0];
    if (latest !== undefined) {
      setStepResults(
        await api.listRunStepResults(projectId, test.id, latest.id),
      );
    }
  }, [api, projectId, test.id]);

  useEffect(() => {
    let active = true;
    void Promise.all([
      api.getRunnerStatus(projectId, test.id),
      api.listTestRuns(projectId, test.id),
    ])
      .then(async ([status, loadedRuns]) => {
        if (!active) return;
        setSnapshot(status);
        setRuns(loadedRuns);
        const latest = loadedRuns[0];
        if (latest !== undefined) {
          const results = await api.listRunStepResults(
            projectId,
            test.id,
            latest.id,
          );
          if (active) setStepResults(results);
        }
      })
      .catch(() => {
        if (active) setError("Istoricul rulărilor nu a putut fi încărcat.");
      });
    const unsubscribe = api.onRunnerStatusChange((nextSnapshot) => {
      if (
        nextSnapshot.run !== undefined &&
        nextSnapshot.run.testId !== test.id
      ) {
        return;
      }
      setSnapshot(nextSnapshot);
      if (
        ["completed", "paused_on_error", "failed", "stopped"].includes(
          nextSnapshot.state,
        )
      ) {
        void loadHistory();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, loadHistory, projectId, test.id]);

  const start = async (): Promise<void> => {
    setIsStarting(true);
    setError(undefined);
    setSnapshot({
      state: "preparing",
      currentStepIndex: -1,
      totalSteps: test.flowItems.length,
      message: "Se pornește runner-ul.",
      canStop: false,
      canRetry: false,
    });
    try {
      setSnapshot(await api.startRun({ projectId, testId: test.id }));
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Rularea nu a putut fi pornită.",
      );
      setSnapshot(idleSnapshot);
    } finally {
      setIsStarting(false);
    }
  };

  const stop = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setError(undefined);
    try {
      setSnapshot(await api.stopRun(snapshot.run.id));
    } catch {
      setError("Rularea nu a putut fi oprită.");
    }
  };

  const retry = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setError(undefined);
    try {
      setSnapshot(await api.retryRunStep(snapshot.run.id));
    } catch {
      setError("Pasul curent nu a putut fi reîncercat.");
    }
  };

  const runFallback = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setIsFallbackBusy(true);
    setError(undefined);
    try {
      setSnapshot(await api.runCurrentFallback(snapshot.run.id));
    } catch {
      setError("Fallback-ul curent nu a putut fi executat.");
    } finally {
      setIsFallbackBusy(false);
    }
  };

  const skipFallback = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setIsFallbackBusy(true);
    setError(undefined);
    try {
      setSnapshot(await api.skipCurrentFallback(snapshot.run.id));
    } catch {
      setError("Nu s-a putut trece la următorul fallback.");
    } finally {
      setIsFallbackBusy(false);
    }
  };

  const canStart =
    test.status === "valid" &&
    test.workflowState === "ready" &&
    !snapshot.canStop &&
    !snapshot.canRetry &&
    !isStarting;
  const progress =
    snapshot.totalSteps === 0
      ? 0
      : Math.min(
          100,
          Math.max(0, (snapshot.currentStepIndex / snapshot.totalSteps) * 100),
        );

  return (
    <section
      className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4"
      aria-labelledby="runner-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 id="runner-heading" className="font-semibold">
            Runner core
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            {stateLabels[snapshot.state]}
            {snapshot.message ? ` · ${snapshot.message}` : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {test.status === "valid" && test.workflowState === "ready" ? (
            <Button
              disabled={!canStart}
              onClick={() => {
                void start();
              }}
            >
              {isStarting ? "Se pornește..." : "Rulează testul"}
            </Button>
          ) : null}
          {snapshot.canStop ? (
            <Button
              variant="danger"
              onClick={() => {
                void stop();
              }}
            >
              Oprește rularea
            </Button>
          ) : null}
          {snapshot.canRetry ? (
            <Button
              onClick={() => {
                void retry();
              }}
            >
              Reîncearcă pasul curent
            </Button>
          ) : null}
        </div>
      </div>

      <div
        className="mt-4 h-2 overflow-hidden rounded-full bg-app-border"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <div
          className="h-full rounded-full bg-brand-600 transition-all"
          style={{ width: `${progress}%` }}
        />
      </div>
      <p className="mt-2 text-xs text-app-muted">
        Pas {Math.max(0, snapshot.currentStepIndex + 1)} din{" "}
        {snapshot.totalSteps}
      </p>

      {snapshot.error ? (
        <p
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {snapshot.error.message}
          {snapshot.error.count === undefined
            ? ""
            : ` (${snapshot.error.count} rezultate)`}
        </p>
      ) : null}

      {snapshot.state === "waiting_for_fallback_decision" &&
      snapshot.fallback !== undefined ? (
        <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Fallback {snapshot.fallback.index + 1} din {snapshot.fallback.total}
          </p>
          <h4 className="mt-1 font-semibold text-amber-950">
            {snapshot.fallback.humanDescription}
          </h4>
          <p className="mt-1 text-sm text-amber-900">
            {snapshot.fallback.whyExplanation}
          </p>
          <pre className="mt-3 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
            {JSON.stringify(snapshot.fallback.locator, null, 2)}
          </pre>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={isFallbackBusy}
              onClick={() => {
                void runFallback();
              }}
            >
              Rulează fallback
            </Button>
            <Button
              variant="secondary"
              disabled={isFallbackBusy}
              onClick={() => {
                void skipFallback();
              }}
            >
              Sari peste fallback
            </Button>
          </div>
        </section>
      ) : null}
      {error ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}

      <details className="mt-4">
        <summary className="cursor-pointer text-sm font-semibold">
          Istoric rulări ({runs.length})
        </summary>
        {runs.length === 0 ? (
          <p className="mt-2 text-xs text-app-muted">
            Testul nu a fost rulat încă.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2 text-xs">
            {runs.map((run) => (
              <li
                key={run.id}
                className="rounded-lg border border-app-border bg-app-surface p-3"
              >
                v{run.testVersion} · {run.status} · {run.startedAt}
                {(run.warnings?.length ?? 0) > 0
                  ? ` · ${run.warnings?.length ?? 0} warning-uri`
                  : ""}
              </li>
            ))}
          </ul>
        )}
      </details>

      {stepResults.length > 0 ? (
        <details className="mt-3">
          <summary className="cursor-pointer text-sm font-semibold">
            Rezultate și logs ({stepResults.length})
          </summary>
          <ol className="mt-2 grid gap-2 text-xs">
            {stepResults.map((result) => (
              <li
                key={result.id}
                className="rounded-lg border border-app-border bg-app-surface p-3"
              >
                <span className="font-semibold">
                  {result.stepId} · {result.status}
                </span>
                <pre className="mt-2 overflow-auto whitespace-pre-wrap text-app-muted">
                  {JSON.stringify(result.logs, null, 2)}
                </pre>
              </li>
            ))}
          </ol>
        </details>
      ) : null}
    </section>
  );
};
