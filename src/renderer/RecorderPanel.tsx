import { useCallback, useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import type {
  RecorderSnapshot,
  RecorderStepDraft,
} from "../shared/recorder.js";
import {
  ACTION_TYPES,
  type LocatorDefinition,
  type LocatorFallback,
} from "../shared/test-model.js";
import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Toast } from "./components/Toast.js";

export interface RecorderPanelProps {
  api: SemanticAppApi;
  project: Project;
  test: TestDefinition;
  onTestUpdated: (test: TestDefinition) => void;
}

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";

const clone = <T,>(value: T): T => structuredClone(value);

const errorMessage = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : "Operația recorderului nu a putut fi finalizată.";

const formatCapturedValue = (draft: RecorderStepDraft): string => {
  if (draft.capturedInputKind === "password") {
    return "Valoare confidențială capturată; va fi salvată numai în dataset.";
  }
  if (draft.capturedValue === undefined)
    return "Acțiunea nu folosește o valoare.";
  return JSON.stringify(draft.capturedValue);
};

const Signal = ({ snapshot }: { snapshot?: RecorderSnapshot | undefined }) => {
  const signal = snapshot?.signal ?? "green";
  const labels = {
    green: "Verde: poți continua",
    yellow: "Galben: analiza este în curs",
    red: "Roșu: este necesară intervenția",
  } as const;

  return (
    <div
      className="flex items-center gap-3 rounded-full border border-app-border bg-app-surface px-4 py-2"
      role="status"
      aria-live="polite"
    >
      {(["green", "yellow", "red"] as const).map((color) => (
        <span
          key={color}
          className={`h-3 w-3 rounded-full ${
            signal === color
              ? color === "green"
                ? "bg-emerald-500 ring-4 ring-emerald-100"
                : color === "yellow"
                  ? "bg-amber-500 ring-4 ring-amber-100"
                  : "bg-red-500 ring-4 ring-red-100"
              : color === "green"
                ? "bg-emerald-200"
                : color === "yellow"
                  ? "bg-amber-200"
                  : "bg-red-200"
          }`}
          aria-label={labels[color]}
        />
      ))}
      <span className="text-xs font-semibold">
        {snapshot?.message ?? "Recorderul este oprit."}
      </span>
    </div>
  );
};

export const RecorderPanel = ({
  api,
  onTestUpdated,
  project,
  test,
}: RecorderPanelProps) => {
  const [snapshot, setSnapshot] = useState<RecorderSnapshot>();
  const [draft, setDraft] = useState<RecorderStepDraft>();
  const [primaryJson, setPrimaryJson] = useState("");
  const [fallbacksJson, setFallbacksJson] = useState("");
  const [isWorking, setIsWorking] = useState(false);
  const [showRerecordConfirm, setShowRerecordConfirm] = useState(false);
  const [selectedStageId, setSelectedStageId] = useState(
    () => test.stages?.[0]?.id ?? "",
  );
  const [error, setError] = useState<string>();
  const [replay, setReplay] = useState<RunnerSnapshot>();
  const [showContinuationReady, setShowContinuationReady] = useState(false);

  const acceptSnapshot = useCallback(
    (next: RecorderSnapshot): void => {
      if (next.projectId !== project.id || next.testId !== test.id) return;
      setSnapshot(next);
      if (next.pendingStep !== undefined) {
        const nextDraft = clone(next.pendingStep);
        setDraft(nextDraft);
        setPrimaryJson(
          JSON.stringify(nextDraft.step.target?.primary ?? null, null, 2),
        );
        setFallbacksJson(JSON.stringify(nextDraft.step.fallbacks, null, 2));
      } else {
        setDraft(undefined);
        setPrimaryJson("");
        setFallbacksJson("");
      }
      if (
        next.test.version !== test.version ||
        next.test.updatedAt !== test.updatedAt ||
        next.test.workflowState !== test.workflowState
      ) {
        onTestUpdated(next.test);
      }
      if (next.continuationReady === true) {
        setReplay(undefined);
        setShowContinuationReady(true);
      }
    },
    [
      onTestUpdated,
      project.id,
      test.id,
      test.updatedAt,
      test.version,
      test.workflowState,
    ],
  );

  useEffect(() => {
    let mounted = true;
    setError(undefined);
    void api
      .getRecorderStatus(project.id, test.id)
      .then((next) => {
        if (mounted) acceptSnapshot(next);
      })
      .catch((reason: unknown) => {
        if (mounted) setError(errorMessage(reason));
      });
    const unsubscribe = api.onRecorderStatusChange((next) => {
      if (mounted) acceptSnapshot(next);
    });
    const unsubscribeRunner =
      typeof api.onRunnerStatusChange === "function"
        ? api.onRunnerStatusChange((next) => {
            if (
              mounted &&
              next.run?.projectId === project.id &&
              next.run.testId === test.id
            ) {
              setReplay(next);
            }
          })
        : () => undefined;
    return () => {
      mounted = false;
      unsubscribe();
      unsubscribeRunner();
    };
  }, [acceptSnapshot, api, project.id, test.id]);

  const run = async (
    operation: () => Promise<RecorderSnapshot>,
  ): Promise<void> => {
    setIsWorking(true);
    setError(undefined);
    try {
      acceptSnapshot(await operation());
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setIsWorking(false);
    }
  };

  const startSelectedStage = (): Promise<RecorderSnapshot> =>
    selectedStageId.length === 0
      ? api.startRecorder(project.id, test.id)
      : api.startRecorder(project.id, test.id, selectedStageId);

  const continueRecording = async (): Promise<void> => {
    setIsWorking(true);
    setError(undefined);
    setShowContinuationReady(false);
    try {
      setReplay(
        await api.continueRecorder(
          project.id,
          test.id,
          selectedStageId.length === 0 ? undefined : selectedStageId,
        ),
      );
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setIsWorking(false);
    }
  };

  const addStep = async (): Promise<void> => {
    if (draft === undefined) return;
    setError(undefined);
    try {
      const fallbacks = JSON.parse(fallbacksJson) as unknown;
      if (!Array.isArray(fallbacks)) {
        throw new Error("Fallback-urile trebuie să fie o listă JSON.");
      }
      const target =
        draft.step.target === undefined
          ? undefined
          : (() => {
              const primary = JSON.parse(primaryJson) as unknown;
              if (typeof primary !== "object" || primary === null) {
                throw new Error(
                  "Locatorul principal trebuie să fie un obiect JSON.",
                );
              }
              return {
                ...draft.step.target,
                primary: primary as LocatorDefinition,
              };
            })();
      const edited: RecorderStepDraft = {
        ...draft,
        step: {
          ...draft.step,
          ...(target === undefined ? {} : { target }),
          fallbacks: fallbacks as LocatorFallback[],
        },
      };
      await run(() => api.addRecorderStep(project.id, test.id, edited));
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const canFinish =
    snapshot?.state === "recording" &&
    snapshot.signal === "green" &&
    snapshot.capturedSteps > 0 &&
    snapshot.canStop;
  const selectedStage = test.stages?.find(({ id }) => id === selectedStageId);
  const isRerecord =
    snapshot?.canStart === true &&
    ((selectedStage?.flowItems.length ?? snapshot.test.flowItems.length) > 0 ||
      snapshot.test.workflowState !== "not_recorded");
  const editingDisabled = isWorking || snapshot?.signal === "yellow";
  const replayActive =
    replay !== undefined &&
    !["completed", "failed", "stopped"].includes(replay.state);
  const replayCanContinue =
    replay !== undefined &&
    [
      "waiting_for_start",
      "waiting_at_breakpoint",
      "waiting_after_step",
      "waiting_for_manual_intervention",
      "waiting_for_missing_data",
    ].includes(replay.state);
  const supportedActions = useMemo(
    () =>
      ACTION_TYPES.filter((action) =>
        [
          "navigate",
          "hover",
          "click",
          "fill",
          "upload_file",
          "select_option",
          "check",
          "uncheck",
          "press_key",
          "scroll",
        ].includes(action),
      ),
    [],
  );

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
      {showContinuationReady ? (
        <div className="fixed top-4 right-4 z-[70] w-[min(24rem,calc(100vw-2rem))]">
          <Toast
            variant="success"
            title="Recorder pregătit"
            message="Poți începe să înregistrezi restul pașilor."
            onDismiss={() => setShowContinuationReady(false)}
          />
        </div>
      ) : null}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold">Recorder semantic</h3>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-app-muted">
            După fiecare acțiune stabilă, pagina este blocată doar cât durează
            analiza. Pasul este salvat automat, apoi poți continua în browser.
            Editarea completă se face după Done, în etapa de revizuire.
          </p>
        </div>
        <Signal snapshot={snapshot} />
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {test.stages !== undefined && test.stages.length > 1 ? (
          <label className="text-xs font-semibold text-app-muted">
            Etapa înregistrată
            <select
              className="ml-2 min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
              value={selectedStageId}
              disabled={
                isWorking || replayActive || snapshot?.canStart !== true
              }
              onChange={(event) => setSelectedStageId(event.target.value)}
            >
              {test.stages.map((stage, index) => (
                <option key={stage.id} value={stage.id}>
                  {index + 1}. {stage.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {snapshot?.canStart ? (
          <Button
            disabled={isWorking || replayActive}
            onClick={() => {
              if (isRerecord) {
                setShowRerecordConfirm(true);
              } else {
                void run(startSelectedStage);
              }
            }}
          >
            {isRerecord ? "Reînregistrează flow-ul" : "Înregistrează flow-ul"}
          </Button>
        ) : null}
        {snapshot?.canStart && isRerecord ? (
          <Button
            variant="secondary"
            disabled={isWorking || replayActive}
            onClick={() => void continueRecording()}
          >
            Continuă înregistrarea
          </Button>
        ) : null}
        {canFinish ? (
          <Button
            disabled={isWorking}
            onClick={() => {
              void run(() => api.stopRecorder(project.id, test.id));
            }}
          >
            Done
          </Button>
        ) : null}
        {snapshot?.canStop && !canFinish ? (
          <Button
            variant="danger"
            disabled={isWorking}
            onClick={() => {
              void run(() => api.stopRecorder(project.id, test.id));
            }}
          >
            Oprește înregistrarea incompletă
          </Button>
        ) : null}
        <span className="text-xs text-app-muted">
          {snapshot === undefined
            ? "Se încarcă starea recorderului…"
            : `${snapshot.capturedSteps} pași adăugați · ${snapshot.queuedEvents} evenimente în coadă`}
        </span>
      </div>

      {replay !== undefined && !showContinuationReady ? (
        <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
          <p className="font-semibold text-brand-900">
            Se redă flow-ul existent
          </p>
          <p className="mt-1 text-sm text-brand-800">
            {replay.message ?? replay.state} · pasul{" "}
            {Math.max(0, replay.currentStepIndex + 1)} din {replay.totalSteps}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {replayCanContinue && replay.run ? (
              <Button
                onClick={() => {
                  void api
                    .continueRun(replay.run!.id)
                    .then(setReplay)
                    .catch((reason: unknown) => setError(errorMessage(reason)));
                }}
              >
                Continuă replay-ul
              </Button>
            ) : null}
            {replay.state === "paused_on_error" && replay.run ? (
              <>
                <Button
                  onClick={() => {
                    void api
                      .retryRunStep(replay.run!.id)
                      .then(setReplay)
                      .catch((reason: unknown) =>
                        setError(errorMessage(reason)),
                      );
                  }}
                >
                  Reîncearcă pasul
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    void api
                      .skipRunStep(replay.run!.id)
                      .then(setReplay)
                      .catch((reason: unknown) =>
                        setError(errorMessage(reason)),
                      );
                  }}
                >
                  Sari peste pas
                </Button>
              </>
            ) : null}
            {replayActive && replay.run ? (
              <Button
                variant="danger"
                onClick={() => {
                  void api
                    .stopRun(replay.run!.id)
                    .then(setReplay)
                    .catch((reason: unknown) => setError(errorMessage(reason)));
                }}
              >
                Oprește replay-ul
              </Button>
            ) : null}
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

      {snapshot?.state === "error" ? (
        <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">
            {snapshot.error ?? "Analiza paginii a eșuat."}
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              disabled={isWorking || !snapshot.canRetry}
              onClick={() => {
                void run(() => api.retryRecorderAnalysis(project.id, test.id));
              }}
            >
              Reîncearcă analiza
            </Button>
            <Button
              variant="secondary"
              disabled={isWorking || !snapshot.canIgnore}
              onClick={() => {
                void run(() =>
                  api.ignoreRecorderAnalysisError(project.id, test.id),
                );
              }}
            >
              Ignoră evenimentul
            </Button>
          </div>
        </div>
      ) : null}

      {draft !== undefined && snapshot?.state === "preview" ? (
        <fieldset
          className="mt-5 rounded-xl border border-red-300 bg-app-surface p-4"
          disabled={editingDisabled}
        >
          <legend className="px-2 text-sm font-semibold">
            Preview pas capturat
          </legend>
          <div className="grid gap-4 md:grid-cols-2">
            <label className={labelClass}>
              Titlu
              <input
                className={fieldClass}
                value={draft.step.title}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    step: { ...draft.step, title: event.target.value },
                  });
                }}
              />
            </label>
            <label className={labelClass}>
              Acțiune
              <select
                className={fieldClass}
                value={draft.step.actionType}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    step: {
                      ...draft.step,
                      actionType: event.target
                        .value as RecorderStepDraft["step"]["actionType"],
                    },
                  });
                }}
              >
                {supportedActions.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className={`${labelClass} mt-4`}>
            Descriere pentru om
            <textarea
              className={fieldClass}
              rows={2}
              value={draft.step.humanDescription}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  step: {
                    ...draft.step,
                    humanDescription: event.target.value,
                  },
                });
              }}
            />
          </label>
          <label className={`${labelClass} mt-4`}>
            De ce este corect pasul
            <textarea
              className={fieldClass}
              rows={2}
              value={draft.step.whyExplanation}
              onChange={(event) => {
                setDraft({
                  ...draft,
                  step: {
                    ...draft.step,
                    whyExplanation: event.target.value,
                  },
                });
              }}
            />
          </label>

          {draft.step.actionType === "navigate" ? (
            <label className={`${labelClass} mt-4`}>
              URL
              <input
                className={fieldClass}
                value={draft.step.url ?? ""}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    step: { ...draft.step, url: event.target.value },
                  });
                }}
              />
            </label>
          ) : draft.step.actionType === "press_key" ? (
            <label className={`${labelClass} mt-4`}>
              Tastă
              <input
                className={fieldClass}
                value={draft.step.key ?? ""}
                onChange={(event) => {
                  setDraft({
                    ...draft,
                    step: { ...draft.step, key: event.target.value },
                  });
                }}
              />
            </label>
          ) : null}

          {draft.step.target !== undefined ? (
            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <label className={labelClass}>
                Locator principal (JSON)
                <textarea
                  className={`${fieldClass} font-mono`}
                  rows={9}
                  value={primaryJson}
                  onChange={(event) => {
                    setPrimaryJson(event.target.value);
                  }}
                />
              </label>
              <label className={labelClass}>
                Fallback-uri (JSON)
                <textarea
                  className={`${fieldClass} font-mono`}
                  rows={9}
                  value={fallbacksJson}
                  onChange={(event) => {
                    setFallbacksJson(event.target.value);
                  }}
                />
              </label>
            </div>
          ) : null}

          <p className="mt-4 rounded-lg bg-brand-50 p-3 text-xs text-brand-900">
            Valoare finală: {formatCapturedValue(draft)}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={editingDisabled}
              onClick={() => {
                void addStep();
              }}
            >
              Adaugă pasul în test
            </Button>
            <Button
              variant="secondary"
              disabled={editingDisabled}
              onClick={() => {
                void run(() => api.discardRecorderStep(project.id, test.id));
              }}
            >
              Ignoră evenimentul
            </Button>
          </div>
        </fieldset>
      ) : null}

      <p className="mt-4 text-xs leading-5 text-app-muted">
        Tastarea se finalizează la blur, Enter sau navigare, nu caracter cu
        caracter. Tab mută focusul și salvează valoarea câmpului ca fill, fără
        să creeze un pas de tastă separat. Evenimentele interne ale aplicației
        sunt ignorate; Back ori o navigare externă invalidează analiza curentă
        și o reia după stabilizare.
      </p>

      <ConfirmDialog
        open={showRerecordConfirm}
        title="Reînregistrezi testul?"
        message={`La pornire, pașii existenți din etapa „${selectedStage?.name ?? "Flow principal"}” sunt înlocuiți de noua înregistrare. Dacă o oprești fără niciun pas, versiunea actuală va fi restaurată.`}
        confirmLabel="Reînregistrează"
        confirmVariant="danger"
        onCancel={() => {
          setShowRerecordConfirm(false);
        }}
        onConfirm={() => {
          setShowRerecordConfirm(false);
          void run(startSelectedStage);
        }}
      />
    </section>
  );
};
