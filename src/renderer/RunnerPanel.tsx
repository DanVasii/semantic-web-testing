import { useCallback, useEffect, useMemo, useState } from "react";

import type {
  AiModelInfo,
  AiProviderId,
  AiRunPlanPreview,
  AiRunPlanResult,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { ImapAccountSummary } from "../shared/imap.js";
import type {
  Project,
  JsonValue,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { RunnerSnapshot, RunMode } from "../shared/runner.js";
import { normalizeTestPostRunChecks } from "../shared/post-run-checks.js";
import type { DatasetValue, TestFlowItem } from "../shared/test-model.js";
import { getContinueShortcut, matchesShortcut } from "../shared/shortcuts.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";
import { PostRunModal } from "./PostRunModal.js";

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
  waiting_for_ai_analysis: "AI verifică rezultatele",
  paused_on_error: "Pauză la eroare",
  completed: "Trecut",
  failed: "Eșuat",
  stopped: "Oprit",
};

type DisplayStepStatus =
  | "pending"
  | "running"
  | "waiting"
  | "passed"
  | "passed_with_fallback"
  | "skipped"
  | "failed"
  | "stopped"
  | "disabled";

const stepStatusLabels: Record<DisplayStepStatus, string> = {
  pending: "În așteptare",
  running: "În curs",
  waiting: "Așteaptă intervenție",
  passed: "Finalizat",
  passed_with_fallback: "Finalizat cu fallback",
  skipped: "Sărit",
  failed: "Eșuat",
  stopped: "Oprit",
  disabled: "Dezactivat",
};

const stepStatusClasses: Record<DisplayStepStatus, string> = {
  pending: "bg-slate-100 text-app-muted",
  running: "bg-blue-100 text-blue-800",
  waiting: "bg-amber-100 text-amber-800",
  passed: "bg-emerald-100 text-emerald-800",
  passed_with_fallback: "bg-teal-100 text-teal-800",
  skipped: "bg-slate-200 text-slate-700",
  failed: "bg-red-100 text-red-800",
  stopped: "bg-orange-100 text-orange-800",
  disabled: "bg-slate-100 text-slate-500",
};

const getStepTitle = (item: TestFlowItem, index: number): string =>
  item.title?.trim() || `Pas ${index + 1}`;

const getStepDescription = (item: TestFlowItem): string | undefined => {
  if (item.type === "breakpoint") return item.instructions;
  if (item.type === "manual_intervention") {
    return item.humanDescription || item.instructions;
  }
  return item.humanDescription;
};

const actionTypeLabels: Record<
  Extract<TestFlowItem, { type: "action" }>["actionType"],
  string
> = {
  navigate: "Navigare",
  click: "Click",
  fill: "Completare câmp",
  select_option: "Selectare opțiune",
  check: "Bifare",
  uncheck: "Debifare",
  press_key: "Apăsare tastă",
  scroll: "Derulare",
  wait_for_element: "Așteptare element",
  wait_for_url: "Așteptare URL",
  choose_repeated_item: "Selectare element repetat",
  calendar_select: "Selectare în calendar",
  manual_intervention: "Intervenție manuală",
};

const checkTypeLabels: Record<
  Extract<TestFlowItem, { type: "check" }>["checkType"],
  string
> = {
  element: "Element",
  text: "Text",
  url: "URL",
  mysql: "MySQL",
  imap: "E-mail",
};

const getStepKind = (item: TestFlowItem): string => {
  if (item.type === "action") {
    return `Acțiune · ${actionTypeLabels[item.actionType]}`;
  }
  if (item.type === "check") {
    return `Verificare · ${checkTypeLabels[item.checkType]}`;
  }
  if (item.type === "breakpoint") return "Breakpoint";
  return "Intervenție manuală";
};

const getLogMessage = (log: JsonValue): string => {
  if (
    typeof log === "object" &&
    log !== null &&
    !Array.isArray(log) &&
    typeof log.message === "string"
  ) {
    return log.message;
  }
  if (typeof log === "string") return log;
  return JSON.stringify(log);
};

const waitingStepStates = new Set<RunnerSnapshot["state"]>([
  "waiting_at_breakpoint",
  "waiting_after_step",
  "waiting_for_missing_data",
  "waiting_for_fallback_decision",
  "waiting_for_manual_intervention",
  "waiting_for_mysql_check",
  "waiting_for_imap_check",
  "waiting_for_ai_analysis",
]);

const describeAiPatch = (patch: object): string => {
  const labels: Record<string, string> = {
    actionType: "tipul acțiunii",
    title: "titlul",
    humanDescription: "descrierea",
    whyExplanation: "explicația",
    primaryLocator: "locatorul principal",
    target: "ținta",
    fallbacks: "fallback-urile",
    repeatUntil: "condiția de repetare",
    enabled: "starea activă",
  };
  const fields = Object.keys(patch).map((key) => labels[key] ?? key);
  return fields.length === 0
    ? "Actualizare tehnică a pasului."
    : `Actualizează ${fields.join(", ")}.`;
};

export interface RunnerPanelProps {
  api: SemanticAppApi;
  project: Project;
  test: TestDefinition;
}

const preferredDatasetId = (datasets: TestDataset[]): string =>
  datasets.find((dataset) => dataset.name === "Înregistrare recorder")?.id ??
  (datasets.length === 1 ? (datasets[0]?.id ?? "") : "");

const fixedText = (value: DatasetValue): string | undefined => {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    value.type === "fixed" &&
    typeof value.value === "string"
  ) {
    return value.value;
  }
  return undefined;
};

export const RunnerPanel = ({ api, project, test }: RunnerPanelProps) => {
  const projectId = project.id;
  const [snapshot, setSnapshot] = useState<RunnerSnapshot>(idleSnapshot);
  const [runs, setRuns] = useState<TestRun[]>([]);
  const [stepResults, setStepResults] = useState<StepRunResult[]>([]);
  const [datasets, setDatasets] = useState<TestDataset[]>([]);
  const [selectedDatasetId, setSelectedDatasetId] = useState("");
  const [runDialogOpen, setRunDialogOpen] = useState(false);
  const [postRunOpen, setPostRunOpen] = useState(false);
  const configuredChecks = useMemo(
    () => normalizeTestPostRunChecks(test.postRunChecks),
    [test.postRunChecks],
  );
  const needsAiSettings =
    test.testMode === "dynamic_ai" ||
    configuredChecks.aiPrompt.trim().length > 0;
  const [runMySqlCheck, setRunMySqlCheck] = useState(
    configuredChecks.mysql.enabled &&
      configuredChecks.mysql.tableNames.length > 0,
  );
  const [runImapCheck, setRunImapCheck] = useState(
    configuredChecks.imap.enabled &&
      configuredChecks.imap.accountIds.length > 0,
  );
  const [imapAccounts, setImapAccounts] = useState<ImapAccountSummary[]>([]);
  const [runImapAccountIds, setRunImapAccountIds] = useState<string[]>(
    configuredChecks.imap.accountIds,
  );
  const [runPostAi, setRunPostAi] = useState(
    configuredChecks.aiPrompt.length > 0,
  );
  const [isStarting, setIsStarting] = useState(false);
  const [isFallbackBusy, setIsFallbackBusy] = useState(false);
  const [runMode, setRunMode] = useState<RunMode>("automatic");
  const [waitBeforeStart, setWaitBeforeStart] = useState(false);
  const [shortcut, setShortcut] = useState(() =>
    getContinueShortcut(project.shortcutConfig),
  );
  const [shortcutInput, setShortcutInput] = useState(shortcut);
  const [isSavingShortcut, setIsSavingShortcut] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiProvider, setAiProvider] = useState<AiProviderId>("none");
  const [aiModel, setAiModel] = useState("");
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [aiPreview, setAiPreview] = useState<AiRunPlanPreview>();
  const [aiPlan, setAiPlan] = useState<AiRunPlanResult>();
  const [aiBusy, setAiBusy] = useState<"models" | "preview" | "generate">();
  const [aiError, setAiError] = useState<string>();
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
    const loaded = await api.listDatasets(projectId, test.id);
    setDatasets(loaded);
    setSelectedDatasetId((current) =>
      loaded.some((dataset) => dataset.id === current)
        ? current
        : preferredDatasetId(loaded),
    );
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
        setSelectedDatasetId(preferredDatasetId(loadedDatasets));
        const latest = status.run ?? loadedRuns[0];
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
        [
          "waiting_for_mysql_check",
          "waiting_for_imap_check",
          "waiting_for_ai_analysis",
          "completed",
          "paused_on_error",
          "failed",
          "stopped",
        ].includes(nextSnapshot.state)
      ) {
        setPostRunOpen(true);
      }
      if (nextSnapshot.run !== undefined) {
        void api
          .listRunStepResults(projectId, test.id, nextSnapshot.run.id)
          .then((results) => {
            if (active) setStepResults(results);
          })
          .catch(() => {
            // Snapshot-ul live rămâne util chiar dacă un refresh de logs eșuează.
          });
      }
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

  useEffect(() => {
    if (typeof api.listImapAccounts !== "function") return;
    let active = true;
    void api
      .listImapAccounts()
      .then((accounts) => {
        if (active) setImapAccounts(accounts);
      })
      .catch(() => {
        if (active) setImapAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [api, test.id]);

  useEffect(() => {
    const selectedDataset = datasets.find(
      (dataset) => dataset.id === selectedDatasetId,
    );
    const datasetEmails = new Set(
      Object.values(selectedDataset?.values ?? {})
        .map(fixedText)
        .filter((value): value is string => value !== undefined)
        .map((value) => value.trim().toLocaleLowerCase()),
    );
    const automaticIds = imapAccounts
      .filter((account) =>
        datasetEmails.has(account.username.trim().toLocaleLowerCase()),
      )
      .map((account) => account.id);
    const selected = [
      ...new Set([...configuredChecks.imap.accountIds, ...automaticIds]),
    ];
    setRunImapAccountIds(selected);
    setRunImapCheck(configuredChecks.imap.enabled && selected.length > 0);
  }, [
    configuredChecks.imap.accountIds,
    configuredChecks.imap.enabled,
    datasets,
    imapAccounts,
    selectedDatasetId,
    test.id,
  ]);

  useEffect(() => {
    if (!needsAiSettings) return;
    let active = true;
    void api
      .getAiSettings()
      .then((settings) => {
        if (!active) return;
        setAiProvider(settings.provider);
        setAiModel(
          settings.provider === "gemini"
            ? settings.gemini.model
            : settings.provider === "ollama"
              ? settings.ollama.model
              : "",
        );
      })
      .catch(() => {
        if (active) {
          setAiError("Setările AI nu au putut fi încărcate.");
        }
      });
    return () => {
      active = false;
    };
  }, [api, needsAiSettings, test.id]);

  useEffect(() => {
    if (!needsAiSettings || aiProvider === "none") return;
    let active = true;
    setAiBusy("models");
    void api
      .listAiModels(aiProvider)
      .then((loadedModels) => {
        if (!active) return;
        setAiModels(loadedModels);
        setAiModel((current) =>
          current.length > 0 ? current : (loadedModels[0]?.id ?? ""),
        );
      })
      .catch((caughtError: unknown) => {
        if (active) {
          setAiError(
            caughtError instanceof Error
              ? caughtError.message
              : "Modelele AI nu au putut fi încărcate.",
          );
        }
      })
      .finally(() => {
        if (active) setAiBusy(undefined);
      });
    return () => {
      active = false;
    };
  }, [aiProvider, api, needsAiSettings, test.id]);

  useEffect(() => {
    const checks = normalizeTestPostRunChecks(test.postRunChecks);
    setRunMySqlCheck(
      checks.mysql.enabled && checks.mysql.tableNames.length > 0,
    );
    setRunImapAccountIds(checks.imap.accountIds);
    setRunImapCheck(checks.imap.enabled && checks.imap.accountIds.length > 0);
    setRunPostAi(checks.aiPrompt.length > 0);
  }, [test.id, test.postRunChecks]);

  const invalidateAiPlan = (): void => {
    setAiPreview(undefined);
    setAiPlan(undefined);
    setAiError(undefined);
  };

  const loadAiModels = async (): Promise<void> => {
    if (aiProvider === "none") return;
    setAiBusy("models");
    setAiError(undefined);
    try {
      const models = await api.listAiModels(aiProvider, true);
      setAiModels(models);
      if (aiModel.length === 0 && models[0] !== undefined) {
        setAiModel(models[0].id);
      }
    } catch (caughtError) {
      setAiError(
        caughtError instanceof Error
          ? caughtError.message
          : "Modelele AI nu au putut fi încărcate.",
      );
    } finally {
      setAiBusy(undefined);
    }
  };

  const previewAiRun = async (): Promise<void> => {
    setAiBusy("preview");
    setAiError(undefined);
    setAiPlan(undefined);
    try {
      setAiPreview(
        await api.previewAiRunPlan({
          projectId,
          testId: test.id,
          instruction: aiInstruction.trim(),
          provider: aiProvider,
          model: aiModel,
        }),
      );
    } catch (caughtError) {
      setAiError(
        caughtError instanceof Error
          ? caughtError.message
          : "Preview-ul AI nu a putut fi generat.",
      );
    } finally {
      setAiBusy(undefined);
    }
  };

  const generateAiRun = async (): Promise<void> => {
    setAiBusy("generate");
    setAiError(undefined);
    try {
      setAiPlan(
        await api.generateAiRunPlan({
          projectId,
          testId: test.id,
          instruction: aiInstruction.trim(),
          provider: aiProvider,
          model: aiModel,
        }),
      );
    } catch (caughtError) {
      setAiError(
        caughtError instanceof Error
          ? caughtError.message
          : "Planul AI nu a putut fi generat.",
      );
    } finally {
      setAiBusy(undefined);
    }
  };

  const start = async (): Promise<void> => {
    setIsStarting(true);
    setError(undefined);
    setPostRunOpen(false);
    setStepResults([]);
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
          ...(test.postRunChecks === undefined
            ? {}
            : {
                postRun: {
                  mysql: runMySqlCheck,
                  imap: runImapCheck,
                  imapAccountIds: runImapAccountIds,
                  ai: runPostAi && aiProvider !== "none",
                  provider: aiProvider,
                  model: aiModel,
                },
              }),
          ...(aiPlan === undefined
            ? {}
            : {
                aiPlan: {
                  baseVersion: test.version,
                  instruction: aiInstruction.trim(),
                  proposal: aiPlan.proposal,
                },
              }),
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

  const skipStep = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setError(undefined);
    try {
      setSnapshot(await api.skipRunStep(snapshot.run.id));
    } catch {
      setError("Pasul curent nu a putut fi sărit.");
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
    (test.status === "valid" || test.status === "invalidated") &&
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
  const canSkipCurrentStep = [
    "paused_on_error",
    "failed",
    "waiting_for_fallback_decision",
  ].includes(snapshot.state);
  const progress =
    snapshot.totalSteps === 0
      ? 0
      : Math.min(
          100,
          Math.max(0, (snapshot.currentStepIndex / snapshot.totalSteps) * 100),
        );
  const stepResultsById = useMemo(
    () => new Map(stepResults.map((result) => [result.stepId, result])),
    [stepResults],
  );
  const displayedFlowItems = snapshot.flowItems ?? test.flowItems;
  const isErrorReview =
    snapshot.error !== undefined &&
    ["paused_on_error", "failed"].includes(snapshot.state);
  const getDisplayStatus = (
    item: TestFlowItem,
    index: number,
  ): DisplayStepStatus => {
    if (!item.enabled) return "disabled";
    const result = stepResultsById.get(item.id);
    if (result !== undefined) return result.status;
    if (snapshot.state === "completed") return "passed";
    if (snapshot.currentStepId === item.id) {
      if (snapshot.state === "paused_on_error" || snapshot.state === "failed") {
        return "failed";
      }
      if (snapshot.state === "stopped") return "stopped";
      return waitingStepStates.has(snapshot.state) ? "waiting" : "running";
    }
    if (index < snapshot.currentStepIndex) return "passed";
    return "pending";
  };

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
          {(test.status === "valid" || test.status === "invalidated") &&
          test.workflowState === "ready" ? (
            <Button
              disabled={!canStart}
              onClick={() => {
                setRunDialogOpen(true);
              }}
            >
              {isStarting ? "Se pornește..." : "Rulează testul"}
            </Button>
          ) : null}
          {snapshot.canStop && !isErrorReview ? (
            <Button
              variant="danger"
              onClick={() => {
                void stop();
              }}
            >
              Oprește testul
            </Button>
          ) : null}
          {canSkipCurrentStep && snapshot.run !== undefined ? (
            <Button
              variant="secondary"
              onClick={() => {
                void skipStep();
              }}
            >
              Sari peste pas
            </Button>
          ) : null}
          {snapshot.canRetry && !isErrorReview ? (
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
          {snapshot.run !== undefined &&
          [
            "waiting_for_mysql_check",
            "waiting_for_imap_check",
            "waiting_for_ai_analysis",
            "completed",
            "paused_on_error",
            "failed",
            "stopped",
          ].includes(snapshot.state) ? (
            <Button
              variant="secondary"
              onClick={() => {
                setPostRunOpen(true);
              }}
            >
              Verificări post-run
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

      <section
        className="mt-4 rounded-xl border border-app-border bg-app-surface p-4"
        aria-labelledby="live-execution-heading"
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h4 id="live-execution-heading" className="font-semibold">
              Execuție pas cu pas
            </h4>
            <p className="mt-1 text-xs text-app-muted">
              Vezi în timp real pasul curent, ce urmează și rezultatul fiecărei
              acțiuni.
            </p>
          </div>
          <span className="rounded-full bg-app-canvas px-2.5 py-1 text-xs font-semibold text-app-muted">
            {displayedFlowItems.length} pași
          </span>
        </div>

        {displayedFlowItems.length === 0 ? (
          <p className="mt-3 text-sm text-app-muted">
            Testul nu conține încă pași.
          </p>
        ) : (
          <ol className="mt-4 grid gap-3">
            {displayedFlowItems.map((item, index) => {
              const result = stepResultsById.get(item.id);
              const displayStatus = getDisplayStatus(item, index);
              const isCurrent = snapshot.currentStepId === item.id;
              const description = getStepDescription(item);
              return (
                <li
                  key={item.id}
                  aria-current={isCurrent ? "step" : undefined}
                  className={`rounded-lg border p-3 transition-colors ${
                    isCurrent
                      ? "border-brand-400 bg-brand-50 ring-1 ring-brand-200"
                      : "border-app-border bg-app-canvas"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-app-surface text-xs font-bold text-app-ink">
                        {index + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="font-semibold text-app-ink">
                          {getStepTitle(item, index)}
                        </p>
                        <p className="mt-0.5 text-xs font-medium text-app-muted">
                          {getStepKind(item)}
                        </p>
                        {description ? (
                          <p className="mt-1 text-sm text-app-muted">
                            {description}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${stepStatusClasses[displayStatus]}`}
                    >
                      {stepStatusLabels[displayStatus]}
                    </span>
                  </div>

                  {isCurrent && snapshot.message ? (
                    <p
                      role="status"
                      className="mt-3 rounded-md bg-white/70 px-3 py-2 text-sm font-medium text-brand-900"
                    >
                      Acum: {snapshot.message}
                    </p>
                  ) : null}

                  {result !== undefined && result.logs.length > 0 ? (
                    <ul className="mt-3 grid gap-1 text-xs text-app-muted">
                      {result.logs.map((log, logIndex) => (
                        <li key={logIndex}>• {getLogMessage(log)}</li>
                      ))}
                    </ul>
                  ) : null}
                  {result?.error !== undefined ? (
                    <p className="mt-2 text-xs text-red-700">
                      {getLogMessage(result.error)}
                    </p>
                  ) : null}
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {isErrorReview && snapshot.error ? (
        <section
          className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-950"
          role="alert"
          aria-labelledby="runner-error-heading"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-red-700 uppercase">
                Eroare de execuție · {snapshot.error.code}
              </p>
              <h4 id="runner-error-heading" className="mt-1 font-semibold">
                Rularea este oprită la eroare
              </h4>
              <p className="mt-2 text-sm">
                {snapshot.error.message}
                {snapshot.error.count === undefined
                  ? ""
                  : ` (${snapshot.error.count} rezultate)`}
              </p>
            </div>
            <span className="rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-800">
              {snapshot.error.retryable === false
                ? "Necesită intervenție"
                : "Poate fi reîncercată"}
            </span>
          </div>

          <dl className="mt-4 grid gap-3 text-xs sm:grid-cols-3">
            <div>
              <dt className="text-red-700">Pas</dt>
              <dd className="mt-0.5 font-semibold">
                {snapshot.error.stepId ?? "—"}
              </dd>
            </div>
            <div>
              <dt className="text-red-700">Operație</dt>
              <dd className="mt-0.5 font-semibold">
                {snapshot.error.operation ?? "execuție pas"}
              </dd>
            </div>
            <div>
              <dt className="text-red-700">Moment</dt>
              <dd className="mt-0.5 font-semibold">
                {snapshot.error.occurredAt === undefined
                  ? "—"
                  : new Date(snapshot.error.occurredAt).toLocaleString("ro-RO")}
              </dd>
            </div>
          </dl>

          {snapshot.error.technicalDetails ? (
            <details className="mt-4 rounded-lg border border-red-200 bg-white/70 p-3">
              <summary className="cursor-pointer text-sm font-semibold">
                Detalii tehnice
              </summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-red-900">
                {snapshot.error.technicalDetails}
              </pre>
            </details>
          ) : null}

          <p className="mt-3 text-xs text-red-800">
            Browserul rămâne deschis pentru verificare înainte de Retry sau
            Stop.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {snapshot.canRetry ? (
              <Button
                onClick={() => {
                  void retry();
                }}
              >
                Reîncearcă pasul curent
              </Button>
            ) : null}
            {snapshot.canStop ? (
              <Button
                variant="danger"
                onClick={() => {
                  void stop();
                }}
              >
                Oprește testul
              </Button>
            ) : null}
          </div>
        </section>
      ) : snapshot.error ? (
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

      <PostRunModal
        api={api}
        open={postRunOpen}
        snapshot={snapshot}
        onSnapshot={setSnapshot}
        onClose={() => {
          setPostRunOpen(false);
        }}
      />

      <Modal
        open={runDialogOpen}
        title="Configurează rularea"
        size="wide"
        onClose={() => {
          if (!isStarting) setRunDialogOpen(false);
        }}
      >
        <div className="rounded-xl border border-app-border bg-slate-50 p-4">
          <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
            Test
          </p>
          <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
            <strong className="text-base text-app-ink">{test.name}</strong>
            <span className="rounded-full border border-app-border bg-white px-2.5 py-1 text-xs">
              Curățare automată: dezactivată
            </span>
          </div>
        </div>
        <p className="mt-3 rounded-lg border border-app-border bg-white p-3 text-sm text-app-muted">
          Rularea folosește sesiunea deschisă din secțiunea Browser. Nu
          pornește, nu închide și nu schimbă browserul automat.
        </p>

        <section className="mt-4 rounded-xl border border-app-border p-4">
          <h3 className="font-semibold text-app-ink">Execuție și date</h3>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1.5 text-sm font-semibold text-app-ink">
              Mod de rulare
              <select
                className="min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
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
            <label className="grid gap-1.5 text-sm font-semibold text-app-ink">
              Dataset
              <select
                className="min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
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
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={waitBeforeStart}
              onChange={(event) => {
                setWaitBeforeStart(event.target.checked);
              }}
            />
            Așteaptă confirmarea mea înainte de primul pas
          </label>
        </section>
        <section className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4">
          <h3 className="font-semibold text-orange-950">Checks după rulare</h3>
          <p className="mt-1 text-xs leading-5 text-orange-900">
            Opțiunile salvate în pagina testului sunt preselectate. Pornirea
            rulării confirmă explicit ce verificări vor fi executate și dacă
            rezultatele vor fi trimise la AI.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={runMySqlCheck}
                disabled={configuredChecks.mysql.tableNames.length === 0}
                onChange={(event) => {
                  setRunMySqlCheck(event.target.checked);
                }}
              />
              MySQL snapshot
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={runImapCheck}
                disabled={runImapAccountIds.length === 0}
                onChange={(event) => {
                  setRunImapCheck(event.target.checked);
                }}
              />
              Ascultă e-mailuri
            </label>
            <label className="flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2 text-sm font-semibold">
              <input
                type="checkbox"
                checked={runPostAi}
                disabled={
                  aiProvider === "none" ||
                  configuredChecks.aiPrompt.length === 0
                }
                onChange={(event) => {
                  setRunPostAi(event.target.checked);
                }}
              />
              Evaluează rezultatele cu AI
            </label>
          </div>
          {configuredChecks.mysql.tableNames.length === 0 ? (
            <p className="mt-2 text-xs text-orange-900">
              Pentru MySQL selectează întâi tabelele în secțiunea Checks a
              testului.
            </p>
          ) : null}
          {runImapAccountIds.length === 0 ? (
            <p className="mt-1 text-xs text-orange-900">
              Selectează un cont IMAP sau alege un dataset cu o adresă
              configurată în Setările aplicației.
            </p>
          ) : null}
          {imapAccounts.length > 0 ? (
            <fieldset className="mt-3 rounded-lg border border-orange-200 bg-white p-3">
              <legend className="px-1 text-sm font-semibold">
                Conturile verificate la această rulare
              </legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {imapAccounts.map((account) => (
                  <label
                    key={account.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={runImapAccountIds.includes(account.id)}
                      onChange={(event) => {
                        setRunImapAccountIds((current) =>
                          event.target.checked
                            ? [...new Set([...current, account.id])]
                            : current.filter(
                                (accountId) => accountId !== account.id,
                              ),
                        );
                        if (event.target.checked) setRunImapCheck(true);
                      }}
                    />
                    <span>
                      <strong>{account.name}</strong>
                      <span className="block text-xs text-app-muted">
                        {account.username}
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="mt-2 text-xs text-orange-900">
                Auto-selectat când datasetul conține exact adresa utilizatorului
                IMAP.
              </p>
            </fieldset>
          ) : null}
          {runPostAi ? (
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold">
                Provider pentru evaluarea post-run
                <select
                  className="min-h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm"
                  value={aiProvider}
                  onChange={(event) => {
                    setAiProvider(event.target.value as AiProviderId);
                    setAiModels([]);
                  }}
                >
                  <option value="none">Dezactivat</option>
                  <option value="gemini">Gemini</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Model
                {aiModels.length > 0 ? (
                  <select
                    className="min-h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm"
                    value={aiModel}
                    onChange={(event) => {
                      setAiModel(event.target.value);
                    }}
                  >
                    {aiModel.length > 0 &&
                    !aiModels.some(({ id }) => id === aiModel) ? (
                      <option value={aiModel}>{aiModel}</option>
                    ) : null}
                    {aiModels.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="min-h-10 rounded-lg border border-orange-200 bg-white px-3 text-sm"
                    value={aiModel}
                    onChange={(event) => {
                      setAiModel(event.target.value);
                    }}
                  />
                )}
              </label>
            </div>
          ) : null}
        </section>
        <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          Fără dataset, valorile lipsă vor fi colectate manual și salvate local
          în clar într-un dataset creat automat.
        </p>

        {test.testMode === "dynamic_ai" ? (
          <section className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4">
            <h3 className="font-semibold">
              Instrucțiune AI numai pentru această rulare
            </h3>
            <p className="mt-1 text-xs leading-5 text-app-muted">
              Testul salvat nu este modificat. Datele sunt trimise numai după
              preview și apăsarea explicită pe „Trimite la AI”.
            </p>
            <label className="mt-3 grid gap-1.5 text-sm font-semibold">
              Ce trebuie schimbat la rularea aceasta?
              <textarea
                className="min-h-24 rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm"
                value={aiInstruction}
                placeholder="Ex.: Selectează data de 15 septembrie 2027 și ora 10:30."
                onChange={(event) => {
                  setAiInstruction(event.target.value);
                  invalidateAiPlan();
                }}
              />
            </label>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="grid gap-1.5 text-sm font-semibold">
                Provider
                <select
                  className="min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
                  value={aiProvider}
                  onChange={(event) => {
                    setAiProvider(event.target.value as AiProviderId);
                    setAiModels([]);
                    invalidateAiPlan();
                  }}
                >
                  <option value="none">Dezactivat</option>
                  <option value="gemini">Gemini</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <label className="grid gap-1.5 text-sm font-semibold">
                Model
                {aiModels.length > 0 ? (
                  <select
                    className="min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
                    value={aiModel}
                    onChange={(event) => {
                      setAiModel(event.target.value);
                      invalidateAiPlan();
                    }}
                  >
                    {aiModel.length > 0 &&
                    !aiModels.some(({ id }) => id === aiModel) ? (
                      <option value={aiModel}>
                        {aiModel} · salvat implicit
                      </option>
                    ) : null}
                    {aiModels.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.displayName}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="min-h-10 rounded-lg border border-app-border bg-app-surface px-3 text-sm"
                    value={aiModel}
                    onChange={(event) => {
                      setAiModel(event.target.value);
                      invalidateAiPlan();
                    }}
                  />
                )}
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={aiProvider === "none" || aiBusy !== undefined}
                onClick={() => void loadAiModels()}
              >
                {aiBusy === "models" ? "Se încarcă..." : "Reîncarcă modelele"}
              </Button>
              <Button
                variant="secondary"
                disabled={
                  aiInstruction.trim().length === 0 ||
                  aiModel.trim().length === 0 ||
                  aiBusy !== undefined
                }
                onClick={() => void previewAiRun()}
              >
                {aiBusy === "preview" ? "Se pregătește..." : "1. Preview AI"}
              </Button>
              <Button
                disabled={
                  aiPreview === undefined ||
                  aiProvider === "none" ||
                  aiBusy !== undefined
                }
                onClick={() => void generateAiRun()}
              >
                {aiBusy === "generate" ? "Se generează..." : "2. Trimite la AI"}
              </Button>
            </div>
            {aiError ? (
              <p
                className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                role="alert"
              >
                {aiError}
              </p>
            ) : null}
            {aiPreview ? (
              <div className="mt-3 rounded-lg bg-app-surface p-3 text-xs">
                <p>
                  Preview local: {aiPreview.request.estimatedInputTokens} tokeni
                  estimați · {aiPreview.request.sentContextBytes} bytes ·{" "}
                  {aiPreview.stepIds.length} pași.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer font-semibold">
                    Vezi exact ce va fi trimis
                  </summary>
                  <pre className="mt-2 max-h-64 overflow-auto rounded bg-slate-950 p-3 text-slate-100">
                    {JSON.stringify(
                      {
                        context: aiPreview.request.contextPreview,
                        prompt: aiPreview.request.prompt,
                        omittedPaths: aiPreview.request.omittedPaths,
                      },
                      null,
                      2,
                    )}
                  </pre>
                </details>
              </div>
            ) : null}
            {aiPlan ? (
              <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-sm font-semibold">
                  {aiPlan.proposal.summary}
                </p>
                <p className="mt-1 text-xs text-emerald-900">
                  {aiPlan.usage.totalTokens} tokeni ·{" "}
                  {aiPlan.proposal.changes.length} schimbări ·{" "}
                  {aiPlan.proposal.insertions.length} pași adăugați temporar
                </p>
                <ul className="mt-2 grid gap-2 text-xs">
                  {aiPlan.proposal.changes.map((change) => (
                    <li
                      key={change.stepId}
                      className="rounded border border-emerald-200 bg-app-surface p-2"
                    >
                      <strong>Modificare pas existent</strong>
                      <p className="mt-1">{change.rationale}</p>
                      <p className="mt-1 text-app-muted">
                        {describeAiPatch(change.patch)}
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold">
                          Detalii tehnice
                        </summary>
                        <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-slate-100">
                          {JSON.stringify(change.patch, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                  {aiPlan.proposal.insertions.map((insertion, index) => (
                    <li
                      key={`${insertion.anchorStepId}-${insertion.position}-${index}`}
                      className="rounded border border-sky-200 bg-app-surface p-2"
                    >
                      <strong>Pas nou: {insertion.action.title}</strong> ·{" "}
                      {insertion.position === "before" ? "înainte de" : "după"}{" "}
                      pasul de referință
                      <p className="mt-1">
                        {insertion.action.humanDescription}
                      </p>
                      <p className="mt-1 text-app-muted">
                        {insertion.rationale}
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold">
                          Detalii tehnice
                        </summary>
                        <pre className="mt-1 overflow-auto rounded bg-slate-950 p-2 text-slate-100">
                          {JSON.stringify(insertion.action, null, 2)}
                        </pre>
                      </details>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        ) : null}

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
            disabled={
              isStarting ||
              (test.testMode === "dynamic_ai" &&
                aiInstruction.trim().length > 0 &&
                aiPlan === undefined)
            }
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
