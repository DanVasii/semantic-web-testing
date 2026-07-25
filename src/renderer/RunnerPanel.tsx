import { useCallback, useEffect, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  Project,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { RunnerSnapshot, RunMode } from "../shared/runner.js";
import { getContinueShortcut, matchesShortcut } from "../shared/shortcuts.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

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
  project: Project;
  test: TestDefinition;
}

export const RunnerPanel = ({ api, project, test }: RunnerPanelProps) => {
  const projectId = project.id;
  const [snapshot, setSnapshot] = useState<RunnerSnapshot>(idleSnapshot);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [stepResults, setStepResults] = useState<StepRunResult[]>([]);
  const [datasets, setDatasets] = useState<TestDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isFallbackBusy, setIsFallbackBusy] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("automatic");
  const [waitBeforeStart, setWaitBeforeStart] = useState(false);
  const [shortcut, setShortcut] = useState(() =>
    getContinueShortcut(project.shortcutConfig),
  );
  const [shortcutInput, setShortcutInput] = useState(shortcut);
  const [isSavingShortcut, setIsSavingShortcut] = useState(false);
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

  const loadDatasets = useCallback(async () => {
    setDatasets(await api.listDatasets(projectId, test.id));
  }, [api, projectId, test.id]);

  useEffect(() => {
    let active = true;
    setSelectedDatasetId("");
    void Promise.all([
      api.getRunnerStatus(projectId, test.id),
      api.listTestRuns(projectId, test.id),
      api.listDatasets(projectId, test.id),
    ])
      .then(async ([status, loadedRuns, loadedDatasets]) => {
        if (!active) return;
        setSnapshot(status);
        setRuns(loadedRuns);
        setDatasets(loadedDatasets);
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
        void loadDatasets();
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [api, loadDatasets, loadHistory, projectId, test.id]);

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
      setSnapshot(
        await api.startRun({
          projectId,
          testId: test.id,
          ...(selectedDatasetId.length === 0
            ? {}
            : { datasetId: selectedDatasetId }),
          mode: runMode,
          waitBeforeStart,
        }),
      );
      setRunDialogOpen(false);
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

  const continueRun = useCallback(async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setError(undefined);
    try {
      setSnapshot(await api.continueRun(snapshot.run.id));
    } catch {
      setError("Rularea nu a putut continua.");
    }
  }, [api, snapshot.run]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const target = event.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement
      ) {
        return;
      }
      if (
        [
          "waiting_for_start",
          "waiting_at_breakpoint",
          "waiting_after_step",
          "waiting_for_missing_data",
        ].includes(snapshot.state) &&
        matchesShortcut(event, shortcut)
      ) {
        event.preventDefault();
        void continueRun();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [continueRun, shortcut, snapshot.state]);

  const saveShortcut = async (): Promise<void> => {
    setIsSavingShortcut(true);
    setError(undefined);
    try {
      const configured = await api.configureRunnerShortcut(
        projectId,
        shortcutInput,
      );
      setShortcut(configured);
      setShortcutInput(configured);
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Shortcut-ul nu a putut fi salvat.",
      );
    } finally {
      setIsSavingShortcut(false);
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
  const isWaitingForContinue = [
    "waiting_for_start",
    "waiting_at_breakpoint",
    "waiting_after_step",
    "waiting_for_missing_data",
  ].includes(snapshot.state);
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
                setRunDialogOpen(true);
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
          {isWaitingForContinue ? (
            <Button
              onClick={() => {
                void continueRun();
              }}
            >
              Continuă ({shortcut})
            </Button>
          ) : null}
        </div>
      </div>

      <fieldset
        className="mt-4 grid gap-3 rounded-xl border border-app-border bg-app-surface p-4 md:grid-cols-3"
        disabled={snapshot.canStop || isStarting}
      >
        <legend className="px-1 text-xs font-semibold">Mod și control</legend>
        <label className="text-xs font-semibold text-app-muted">
          Mod de rulare
          <select
            className="mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm"
            value={runMode}
            onChange={(event) => {
              setRunMode(event.target.value as RunMode);
            }}
          >
            <option value="automatic">Automat</option>
            <option value="breakpoints">Breakpoints custom</option>
            <option value="step_by_step">Pas cu pas</option>
          </select>
        </label>
        <label className="flex min-h-10 items-center gap-2 self-end text-sm">
          <input
            type="checkbox"
            checked={waitBeforeStart}
            onChange={(event) => {
              setWaitBeforeStart(event.target.checked);
            }}
          />
          Așteaptă înainte de primul pas
        </label>
        <div className="flex items-end gap-2">
          <label className="min-w-0 flex-1 text-xs font-semibold text-app-muted">
            Shortcut Continue
            <input
              className="mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm"
              value={shortcutInput}
              onChange={(event) => {
                setShortcutInput(event.target.value);
              }}
            />
          </label>
          <Button
            variant="secondary"
            disabled={isSavingShortcut}
            onClick={() => {
              void saveShortcut();
            }}
          >
            Salvează
          </Button>
        </div>
      </fieldset>

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

      {snapshot.wipe !== undefined ? (
        <section
          className={`mt-4 rounded-xl border p-4 ${
            snapshot.wipe.status === "completed"
              ? "border-emerald-300 bg-emerald-50"
              : "border-red-300 bg-red-50"
          }`}
          aria-label="Log wipe"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold tracking-wide uppercase">
                Wipe înainte de test
              </p>
              <h4 className="mt-1 font-semibold">
                {snapshot.wipe.status === "completed"
                  ? "Curățare finalizată"
                  : "Curățare eșuată critic"}
              </h4>
            </div>
            <code className="rounded bg-white/70 px-2 py-1 text-xs">
              {snapshot.wipe.origin}
            </code>
          </div>
          <ol className="mt-3 grid gap-2 text-sm">
            {snapshot.wipe.entries.map((entry, index) => (
              <li
                key={`${entry.resource}-${index}`}
                className="flex flex-wrap items-start justify-between gap-2 rounded-lg bg-white/70 px-3 py-2"
              >
                <span>
                  <strong>{entry.resource}</strong> · {entry.message}
                </span>
                <span className="font-mono text-xs uppercase">
                  {entry.status}
                  {entry.count === undefined ? "" : ` · ${entry.count}`}
                </span>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {snapshot.pause !== undefined ? (
        <section className="mt-4 rounded-xl border border-brand-300 bg-brand-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-brand-800 uppercase">
            Pauză controlată
          </p>
          <h4 className="mt-1 font-semibold text-brand-950">
            {snapshot.pause.title}
          </h4>
          {snapshot.pause.instructions ? (
            <p className="mt-1 text-sm text-brand-900">
              {snapshot.pause.instructions}
            </p>
          ) : null}
          <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <div>
              <dt className="text-app-muted">Pas anterior</dt>
              <dd className="font-semibold">
                {snapshot.pause.previousStepId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-app-muted">Pas următor</dt>
              <dd className="font-semibold">
                {snapshot.pause.nextStepId ?? "—"}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}

      {snapshot.state === "waiting_for_missing_data" &&
      snapshot.missingData !== undefined ? (
        <section className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase">
            Date lipsă
          </p>
          <h4 className="mt-1 font-semibold text-amber-950">
            Completează câmpul în browser
          </h4>
          <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-amber-800">fieldId</dt>
              <dd className="font-mono font-semibold text-amber-950">
                {snapshot.missingData.fieldId}
              </dd>
            </div>
            <div>
              <dt className="text-amber-800">Tip input</dt>
              <dd className="font-semibold text-amber-950">
                {snapshot.missingData.inputKind}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-sm text-amber-900">
            Introdu valoarea direct în browser. Pentru checkbox și radio,
            setează starea dorită; pentru select, alege opțiunea. Apoi folosește
            Continue ({shortcut}).
          </p>
          {snapshot.missingData.inputKind === "password" ? (
            <p className="mt-2 text-sm font-semibold text-red-800">
              Atenție: parola va fi salvată local în clar în dataset.
            </p>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-semibold text-amber-950">
              Selectorul inputului
            </summary>
            <pre className="mt-2 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(snapshot.missingData.locator, null, 2)}
            </pre>
          </details>
        </section>
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

      <Modal
        open={runDialogOpen}
        title="Configurează rularea"
        onClose={() => {
          if (!isStarting) setRunDialogOpen(false);
        }}
      >
        <dl className="grid gap-2 rounded-lg border border-app-border bg-app-canvas p-3 text-sm">
          <div>
            <dt className="text-app-muted">Test</dt>
            <dd className="font-semibold text-app-ink">{test.name}</dd>
          </div>
          <div>
            <dt className="text-app-muted">Mod</dt>
            <dd className="font-semibold text-app-ink">{runMode}</dd>
          </div>
          <div>
            <dt className="text-app-muted">Wipe înainte</dt>
            <dd className="font-semibold text-app-ink">
              {test.wipeBeforeRun ? "Activ" : "Dezactivat"}
            </dd>
          </div>
        </dl>
        <label className="mt-4 grid gap-1.5 text-sm font-semibold text-app-ink">
          Dataset
          <select
            className="min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 text-sm"
            value={selectedDatasetId}
            onChange={(event) => {
              setSelectedDatasetId(event.target.value);
            }}
          >
            <option value="">Fără dataset</option>
            {datasets.map((dataset) => (
              <option key={dataset.id} value={dataset.id}>
                {dataset.name}
              </option>
            ))}
          </select>
        </label>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Fără dataset, valorile lipsă vor fi colectate manual și salvate local
          în clar într-un dataset creat automat.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button
            variant="secondary"
            disabled={isStarting}
            onClick={() => {
              setRunDialogOpen(false);
            }}
          >
            Anulează
          </Button>
          <Button
            disabled={isStarting}
            onClick={() => {
              void start();
            }}
          >
            {isStarting ? "Se pornește..." : "Pornește rularea"}
          </Button>
        </div>
      </Modal>
    </section>
  );
};
