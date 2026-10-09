import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AiModelInfo,
  AiProviderId,
  AiSettingsSummary,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { MySqlCleanupRowSelection } from "../shared/mysql.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import { normalizeTestPostRunChecks } from "../shared/post-run-checks.js";
import { testFlowRequiresAi } from "../shared/test-ai-requirements.js";
import type { TestDataset } from "../shared/test-model.js";
import type { BatchRun, TestSuite } from "../shared/test-suites.js";
import {
  MANUAL_WIPE_RESOURCES,
  type RunnerSnapshot,
  type StartRunInput,
} from "../shared/runner.js";
import { AiModelPricingPanel } from "./components/AiModelPricingPanel.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

type BatchPhase =
  "loading" | "configure" | "running" | "finalize" | "cleaning" | "completed";

type BatchItemStatus =
  "queued" | "running" | "passed" | "flaky" | "failed" | "stopped" | "skipped";

interface BatchItem {
  test: TestDefinition;
  datasetId: string;
  status: BatchItemStatus;
  snapshot?: RunnerSnapshot;
  error?: string;
  batchItemId?: string;
  retryCount: number;
}

export interface ProjectRunAllModalProps {
  api: SemanticAppApi;
  open: boolean;
  project: Project;
  tests: TestDefinition[];
  suite?: TestSuite;
  onClose: () => void;
  onFinished: () => void;
}

const terminalStates = new Set<RunnerSnapshot["state"]>([
  "completed",
  "failed",
  "stopped",
  "paused_on_error",
]);

const runnable = (test: TestDefinition): boolean =>
  (test.status === "valid" || test.status === "invalidated") &&
  test.workflowState === "ready";

const preferredDatasetId = (datasets: TestDataset[]): string =>
  datasets.find((dataset) => dataset.name === "Înregistrare recorder")?.id ??
  (datasets.length === 1 ? (datasets[0]?.id ?? "") : "");

const modelFromSettings = (
  settings: AiSettingsSummary,
  provider: AiProviderId = settings.provider,
): string => {
  if (provider === "gemini") return settings.gemini.model;
  if (provider === "openai") return settings.openai.model;
  if (provider === "lm_studio") return settings.lmStudio.model;
  if (provider === "ollama") return settings.ollama.model;
  return "";
};

const statusLabels: Record<BatchItemStatus, string> = {
  queued: "În așteptare",
  running: "Rulează",
  passed: "Passed",
  flaky: "Flaky",
  failed: "Failed",
  stopped: "Oprit",
  skipped: "Omis",
};

const statusClasses: Record<BatchItemStatus, string> = {
  queued: "border-slate-200 bg-slate-50 text-slate-700",
  running: "border-blue-200 bg-blue-50 text-blue-800",
  passed: "border-emerald-200 bg-emerald-50 text-emerald-800",
  flaky: "border-violet-200 bg-violet-50 text-violet-800",
  failed: "border-red-200 bg-red-50 text-red-800",
  stopped: "border-amber-200 bg-amber-50 text-amber-800",
  skipped: "border-slate-200 bg-slate-100 text-slate-600",
};

const selectionKey = (selection: MySqlCleanupRowSelection): string =>
  `${selection.tableName}:${JSON.stringify(selection.identity)}`;

export const ProjectRunAllModal = ({
  api,
  onClose,
  onFinished,
  open,
  project,
  suite,
  tests,
}: ProjectRunAllModalProps) => {
  const [phase, setPhase] = useState<BatchPhase>("loading");
  const [items, setItems] = useState<BatchItem[]>([]);
  const [datasets, setDatasets] = useState<Record<string, TestDataset[]>>({});
  const [aiSettings, setAiSettings] = useState<AiSettingsSummary>();
  const [aiProvider, setAiProvider] = useState<AiProviderId>("none");
  const [aiModel, setAiModel] = useState("");
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string>();
  const [clearBeforeEachTest, setClearBeforeEachTest] = useState(false);
  const [continueOnFailure, setContinueOnFailure] = useState(true);
  const [maxStepRetries, setMaxStepRetries] = useState(0);
  const [error, setError] = useState<string>();
  const [cleanupMessages, setCleanupMessages] = useState<string[]>([]);
  const [imapBusy, setImapBusy] = useState(false);

  const itemsRef = useRef<BatchItem[]>([]);
  const currentIndexRef = useRef(-1);
  const stopRequestedRef = useRef(false);
  const continueOnFailureRef = useRef(true);
  const clearBeforeEachTestRef = useRef(false);
  const maxStepRetriesRef = useRef(0);
  const aiProviderRef = useRef<AiProviderId>("none");
  const aiModelRef = useRef("");
  const batchRunRef = useRef<BatchRun | undefined>(undefined);
  const retryingRunsRef = useRef(new Set<string>());
  const terminalRunsRef = useRef(new Set<string>());
  const snapshotHandlerRef = useRef<(snapshot: RunnerSnapshot) => void>(() => {
    // Handler-ul este înlocuit la fiecare render.
  });
  const imapRequestRef = useRef(false);

  const setBatchItems = (
    update: BatchItem[] | ((current: BatchItem[]) => BatchItem[]),
  ): void => {
    setItems((current) => {
      const next = typeof update === "function" ? update(current) : update;
      itemsRef.current = next;
      return next;
    });
  };

  const eligibleTests = useMemo(() => tests.filter(runnable), [tests]);
  const excludedTests = useMemo(
    () => tests.filter((test) => !runnable(test)),
    [tests],
  );
  const batchNeedsAi = useMemo(
    () =>
      eligibleTests.some(
        (test) =>
          testFlowRequiresAi(test) ||
          normalizeTestPostRunChecks(test.postRunChecks).aiPrompt.trim()
            .length > 0,
      ),
    [eligibleTests],
  );
  const currentItem = items[currentIndexRef.current];
  const insertedRows = useMemo(
    () =>
      items.reduce(
        (total, item) =>
          total +
          (item.snapshot?.mysql?.diffs.reduce(
            (diffTotal, diff) =>
              diffTotal +
              diff.tables.reduce(
                (tableTotal, table) => tableTotal + table.inserted.length,
                0,
              ),
            0,
          ) ?? 0),
        0,
      ),
    [items],
  );

  useEffect(() => {
    if (!open) return;
    let active = true;
    setPhase("loading");
    setError(undefined);
    setAiError(undefined);
    setAiModels([]);
    setAiProvider("none");
    setAiModel("");
    setCleanupMessages([]);
    setClearBeforeEachTest(suite?.settings.clearSessionBeforeEach ?? false);
    setContinueOnFailure(suite?.settings.continueOnFailure ?? true);
    setMaxStepRetries(suite?.settings.maxStepRetries ?? 0);
    currentIndexRef.current = -1;
    stopRequestedRef.current = false;
    terminalRunsRef.current.clear();
    retryingRunsRef.current.clear();
    batchRunRef.current = undefined;

    Promise.all([
      Promise.all(
        eligibleTests.map(
          async (test) =>
            [test.id, await api.listDatasets(project.id, test.id)] as const,
        ),
      ),
      api.getAiSettings().catch(() => undefined),
    ])
      .then(([datasetEntries, settings]) => {
        if (!active) return;
        const loadedDatasets = Object.fromEntries(datasetEntries);
        setDatasets(loadedDatasets);
        setAiSettings(settings);
        const provider = settings?.provider ?? "none";
        setAiProvider(provider);
        setAiModel(settings === undefined ? "" : modelFromSettings(settings));
        setBatchItems(
          eligibleTests.map((test) => ({
            test,
            datasetId:
              suite?.items.find(({ testId }) => testId === test.id)
                ?.datasetId ??
              preferredDatasetId(loadedDatasets[test.id] ?? []),
            status: "queued",
            retryCount: 0,
          })),
        );
        setPhase("configure");
      })
      .catch((reason) => {
        if (!active) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Configurația testelor nu a putut fi încărcată.",
        );
        setBatchItems([]);
        setPhase("configure");
      });

    return () => {
      active = false;
    };
  }, [api, eligibleTests, open, project.id, suite]);

  useEffect(() => {
    if (!open || !batchNeedsAi || aiProvider === "none") return;
    let active = true;
    setAiBusy(true);
    setAiError(undefined);
    void api
      .listAiModels(aiProvider)
      .then((models) => {
        if (!active) return;
        setAiModels(models);
        setAiModel((current) =>
          models.some(({ id }) => id === current)
            ? current
            : (models[0]?.id ?? current),
        );
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setAiError(
          reason instanceof Error
            ? reason.message
            : "Modelele AI nu au putut fi încărcate.",
        );
      })
      .finally(() => {
        if (active) setAiBusy(false);
      });
    return () => {
      active = false;
    };
  }, [aiProvider, api, batchNeedsAi, open]);

  const finishBatch = (): void => {
    currentIndexRef.current = -1;
    setPhase("finalize");
    const batch = batchRunRef.current;
    if (batch !== undefined && api.completeBatchRun !== undefined) {
      const status = batchStatusFromItems();
      void api.completeBatchRun(batch.id, status).then((updated) => {
        batchRunRef.current = updated;
      });
    }
    onFinished();
  };

  const batchStatusFromItems = (): "passed" | "failed" | "stopped" => {
    const statuses = itemsRef.current.map(({ status }) => status);
    return statuses.includes("failed")
      ? "failed"
      : statuses.includes("stopped") || statuses.includes("skipped")
        ? "stopped"
        : "passed";
  };

  const persistItem = (item: BatchItem): void => {
    const batch = batchRunRef.current;
    if (
      batch === undefined ||
      item.batchItemId === undefined ||
      api.updateBatchRunItem === undefined
    ) {
      return;
    }
    void api
      .updateBatchRunItem(batch.id, {
        itemId: item.batchItemId,
        status: item.status,
        retryCount: item.retryCount,
        ...(item.snapshot?.run?.id === undefined
          ? {}
          : { runId: item.snapshot.run.id }),
        ...(item.error === undefined ? {} : { error: item.error }),
      })
      .then((updated) => {
        batchRunRef.current = updated;
      });
  };

  const skipQueued = (): void => {
    setBatchItems((current) =>
      current.map((item) => {
        if (item.status !== "queued") return item;
        const skipped = { ...item, status: "skipped" as const };
        persistItem(skipped);
        return skipped;
      }),
    );
  };

  const startItem = async (index: number): Promise<void> => {
    if (stopRequestedRef.current || index >= itemsRef.current.length) {
      if (stopRequestedRef.current) skipQueued();
      finishBatch();
      return;
    }

    currentIndexRef.current = index;
    const item = itemsRef.current[index];
    if (item === undefined) {
      finishBatch();
      return;
    }
    setBatchItems((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? (() => {
              const next: BatchItem = { ...candidate, status: "running" };
              delete next.error;
              return next;
            })()
          : candidate,
      ),
    );
    persistItem({ ...item, status: "running" });

    const checks = normalizeTestPostRunChecks(item.test.postRunChecks);
    const provider = aiProviderRef.current;
    const model = aiModelRef.current;
    const input: StartRunInput = {
      projectId: project.id,
      testId: item.test.id,
      mode: "automatic",
      missingVariablePolicy: "fail",
      ...(item.datasetId.length === 0 ? {} : { datasetId: item.datasetId }),
      ...(clearBeforeEachTestRef.current
        ? { clearSessionBeforeRun: true }
        : {}),
      postRun: {
        mysql: checks.mysql.enabled && checks.mysql.tableNames.length > 0,
        imap: checks.imap.enabled && checks.imap.accountIds.length > 0,
        imapAccountIds: checks.imap.accountIds,
        ai: checks.aiPrompt.trim().length > 0 && provider !== "none",
        provider,
        model,
      },
      ...(provider === "none" ? {} : { aiProvider: provider, aiModel: model }),
    };

    try {
      const snapshot = await api.startRun(input);
      persistItem({ ...itemsRef.current[index]!, snapshot, status: "running" });
      snapshotHandlerRef.current(snapshot);
      if (
        stopRequestedRef.current &&
        snapshot.run !== undefined &&
        snapshot.canStop
      ) {
        snapshotHandlerRef.current(await api.stopRun(snapshot.run.id));
      }
    } catch (reason) {
      if (itemsRef.current[index]?.status !== "running") return;
      const message =
        reason instanceof Error
          ? reason.message
          : "Testul nu a putut fi pornit.";
      setBatchItems((current) =>
        current.map((candidate, candidateIndex) =>
          candidateIndex === index
            ? { ...candidate, status: "failed", error: message }
            : candidate,
        ),
      );
      persistItem({
        ...itemsRef.current[index],
        status: "failed",
        error: message,
      });
      if (stopRequestedRef.current || !continueOnFailureRef.current) {
        skipQueued();
        finishBatch();
      } else {
        void startItem(index + 1);
      }
    }
  };

  const handleSnapshot = (snapshot: RunnerSnapshot): void => {
    const index = currentIndexRef.current;
    const item = itemsRef.current[index];
    if (item === undefined || snapshot.run?.testId !== item.test.id) return;

    setBatchItems((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index ? { ...candidate, snapshot } : candidate,
      ),
    );
    if (!terminalStates.has(snapshot.state) || snapshot.run === undefined)
      return;
    if (
      snapshot.state === "paused_on_error" &&
      snapshot.canRetry &&
      item.retryCount < maxStepRetriesRef.current
    ) {
      if (retryingRunsRef.current.has(snapshot.run.id)) return;
      retryingRunsRef.current.add(snapshot.run.id);
      const retryingItem: BatchItem = {
        ...item,
        snapshot,
        status: "running",
        retryCount: item.retryCount + 1,
      };
      setBatchItems((current) =>
        current.map((candidate, candidateIndex) =>
          candidateIndex === index ? retryingItem : candidate,
        ),
      );
      persistItem(retryingItem);
      const runId = snapshot.run.id;
      void api
        .retryRunStep(runId)
        .then((next) => {
          retryingRunsRef.current.delete(runId);
          snapshotHandlerRef.current(next);
        })
        .catch((reason) => {
          retryingRunsRef.current.delete(runId);
          setError(
            reason instanceof Error
              ? reason.message
              : "Retry-ul automat nu a putut fi executat.",
          );
        });
      return;
    }
    if (terminalRunsRef.current.has(snapshot.run.id)) return;
    terminalRunsRef.current.add(snapshot.run.id);

    const passed = snapshot.state === "completed";
    const flaky = passed && item.retryCount > 0;
    const stopped = snapshot.state === "stopped";
    const finalStatus: BatchItemStatus = flaky
      ? "flaky"
      : passed
        ? "passed"
        : stopped
          ? "stopped"
          : "failed";
    setBatchItems((current) =>
      current.map((candidate, candidateIndex) =>
        candidateIndex === index
          ? {
              ...candidate,
              snapshot,
              status: finalStatus,
              ...(passed
                ? {}
                : {
                    error:
                      snapshot.error?.message ??
                      snapshot.message ??
                      "Testul nu s-a finalizat cu succes.",
                  }),
            }
          : candidate,
      ),
    );
    persistItem({
      ...item,
      snapshot,
      status: finalStatus,
      ...(passed
        ? {}
        : {
            error:
              snapshot.error?.message ??
              snapshot.message ??
              "Testul nu s-a finalizat cu succes.",
          }),
    });

    if (
      stopRequestedRef.current ||
      (!passed && !continueOnFailureRef.current)
    ) {
      skipQueued();
      finishBatch();
    } else {
      void startItem(index + 1);
    }
  };
  snapshotHandlerRef.current = handleSnapshot;

  useEffect(() => {
    if (!open) return;
    return api.onRunnerStatusChange((snapshot) => {
      snapshotHandlerRef.current(snapshot);
    });
  }, [api, open]);

  useEffect(() => {
    const snapshot = currentItem?.snapshot;
    if (
      !open ||
      phase !== "running" ||
      snapshot?.state !== "waiting_for_imap_check" ||
      snapshot.run === undefined
    ) {
      return;
    }
    let active = true;
    const poll = async (): Promise<void> => {
      if (imapRequestRef.current) return;
      imapRequestRef.current = true;
      setImapBusy(true);
      try {
        const next = await api.pollImapCheck(snapshot.run!.id);
        if (active) snapshotHandlerRef.current(next);
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Verificarea IMAP nu a putut fi actualizată.",
          );
        }
      } finally {
        imapRequestRef.current = false;
        if (active) setImapBusy(false);
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, currentItem?.snapshot, open, phase]);

  const startBatch = async (): Promise<void> => {
    setError(undefined);
    if (itemsRef.current.length === 0) return;
    if (
      batchNeedsAi &&
      (aiProvider === "none" || aiModel.trim().length === 0)
    ) {
      setError(
        "Selectează providerul și modelul AI înainte de a porni testele.",
      );
      return;
    }
    try {
      const browser = await api.getBrowserStatus();
      if (browser.state !== "running" || browser.projectId !== project.id) {
        throw new Error(
          "Pornește browserul acestui proiect înainte de Run all tests.",
        );
      }
      stopRequestedRef.current = false;
      continueOnFailureRef.current = continueOnFailure;
      clearBeforeEachTestRef.current = clearBeforeEachTest;
      maxStepRetriesRef.current = maxStepRetries;
      aiProviderRef.current = aiProvider;
      aiModelRef.current = aiModel.trim();
      terminalRunsRef.current.clear();
      if (api.createBatchRun !== undefined) {
        const created = await api.createBatchRun({
          projectId: project.id,
          ...(suite === undefined ? {} : { suiteId: suite.id }),
          name:
            suite?.name ?? `Run all · ${new Date().toLocaleString("ro-RO")}`,
          settings: {
            clearSessionBeforeEach: clearBeforeEachTest,
            continueOnFailure,
            maxStepRetries,
          },
          items: itemsRef.current.map((item) => ({
            testId: item.test.id,
            testName: item.test.name,
            ...(item.datasetId.length === 0
              ? {}
              : { datasetId: item.datasetId }),
          })),
        });
        batchRunRef.current = created;
        setBatchItems((current) =>
          current.map((item, index) => ({
            ...item,
            ...(created.items[index]?.id === undefined
              ? {}
              : { batchItemId: created.items[index].id }),
          })),
        );
      }
      setPhase("running");
      await startItem(0);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Batch-ul nu a putut fi pornit.",
      );
    }
  };

  const stopBatch = async (): Promise<void> => {
    stopRequestedRef.current = true;
    const snapshot = itemsRef.current[currentIndexRef.current]?.snapshot;
    if (snapshot?.run !== undefined && snapshot.canStop) {
      try {
        snapshotHandlerRef.current(await api.stopRun(snapshot.run.id));
      } catch (reason) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Batch-ul nu a putut fi oprit.",
        );
        skipQueued();
        finishBatch();
      }
    } else {
      skipQueued();
      finishBatch();
    }
  };

  const finishWithoutWipe = (): void => {
    setCleanupMessages([
      "Datele browserului și datele MySQL au fost păstrate.",
    ]);
    setPhase("completed");
    const batch = batchRunRef.current;
    if (batch !== undefined && api.completeBatchRun !== undefined) {
      void api.completeBatchRun(batch.id, batchStatusFromItems(), "preserved");
    }
  };

  const runFullWipe = async (): Promise<void> => {
    setPhase("cleaning");
    setError(undefined);
    const messages: string[] = [];
    const seenRows = new Set<string>();

    for (
      let itemIndex = itemsRef.current.length - 1;
      itemIndex >= 0;
      itemIndex -= 1
    ) {
      const item = itemsRef.current[itemIndex];
      const initialSnapshot = item?.snapshot;
      if (
        item === undefined ||
        initialSnapshot?.run === undefined ||
        initialSnapshot.mysql === undefined
      ) {
        continue;
      }
      let snapshot: RunnerSnapshot = initialSnapshot;
      const runId = initialSnapshot.run.id;
      const diffs = [...initialSnapshot.mysql.diffs].reverse();
      for (const diff of diffs) {
        const rows = diff.tables.flatMap((table) =>
          table.inserted
            .map(({ identity }) => ({ tableName: table.tableName, identity }))
            .filter((selection) => {
              const key = selectionKey(selection);
              if (seenRows.has(key)) return false;
              seenRows.add(key);
              return true;
            }),
        );
        if (rows.length === 0) continue;
        try {
          snapshot = await api.previewMySqlCleanup(runId, diff.id, rows);
          const preview = snapshot.mysql?.cleanupPreview;
          if (preview === undefined) {
            throw new Error("Preview-ul MySQL nu a fost creat.");
          }
          snapshot = await api.confirmMySqlCleanup(runId, preview.id);
          messages.push(
            `${item.test.name}: au fost șterse ${rows.length} rânduri MySQL inserate.`,
          );
          setBatchItems((current) =>
            current.map((candidate, index) =>
              index === itemIndex ? { ...candidate, snapshot } : candidate,
            ),
          );
        } catch (reason) {
          messages.push(
            `${item.test.name}: cleanup MySQL eșuat — ${
              reason instanceof Error ? reason.message : "eroare necunoscută"
            }.`,
          );
        }
      }
    }

    const browserItems = [...itemsRef.current]
      .reverse()
      .filter((item) => item.snapshot?.run !== undefined);
    let browserWipeCompleted = false;
    let browserWipeError: string | undefined;
    for (const browserItem of browserItems) {
      const runId = browserItem.snapshot?.run?.id;
      if (runId === undefined) continue;
      try {
        const cleaned = await api.manualWipeRunData(runId, [
          ...MANUAL_WIPE_RESOURCES,
        ]);
        messages.push(
          cleaned.cleanup?.status === "completed"
            ? "Wipe-ul complet al datelor browserului a fost finalizat."
            : "Wipe-ul datelor browserului s-a încheiat cu erori.",
        );
        browserWipeCompleted = true;
        break;
      } catch (reason) {
        browserWipeError =
          reason instanceof Error ? reason.message : "eroare necunoscută";
      }
    }
    if (!browserWipeCompleted && browserItems.length > 0) {
      messages.push(`Wipe browser eșuat — ${browserWipeError}.`);
    }

    if (messages.length === 0) {
      messages.push("Nu au fost găsite date generate care să poată fi șterse.");
    }
    setCleanupMessages(messages);
    setPhase("completed");
    const batch = batchRunRef.current;
    if (batch !== undefined && api.completeBatchRun !== undefined) {
      void api.completeBatchRun(
        batch.id,
        batchStatusFromItems(),
        messages.some((message) => message.includes("eșuat"))
          ? "failed"
          : "completed",
      );
    }
  };

  const closeAllowed = phase !== "running" && phase !== "cleaning";
  const passedCount = items.filter(
    ({ status }) => status === "passed" || status === "flaky",
  ).length;
  const failedCount = items.filter(({ status }) => status === "failed").length;
  const finishedCount = items.filter(({ status }) =>
    ["passed", "flaky", "failed", "stopped", "skipped"].includes(status),
  ).length;

  return (
    <Modal
      open={open}
      title="Rulează toate testele"
      size="wide"
      onClose={() => {
        if (closeAllowed) onClose();
      }}
    >
      {phase === "loading" ? (
        <p role="status">Se încarcă testele și dataset-urile…</p>
      ) : null}

      {phase === "configure" ? (
        <>
          <p>
            Testele pregătite vor rula strict unul după altul. Checks-urile
            MySQL, IMAP și AI salvate în fiecare test sunt respectate.
          </p>
          {excludedTests.length > 0 ? (
            <p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
              {excludedTests.length} teste nepregătite sau invalide vor fi
              omise: {excludedTests.map(({ name }) => name).join(", ")}.
            </p>
          ) : null}
          <div className="mt-4 grid gap-3">
            {items.map((item, index) => (
              <article
                key={item.test.id}
                className="grid gap-3 rounded-xl border border-app-border bg-app-canvas p-4 md:grid-cols-[1fr_18rem] md:items-center"
              >
                <div>
                  <strong className="text-app-ink">
                    {index + 1}. {item.test.name}
                  </strong>
                  <p className="mt-1 break-all text-xs">
                    {item.test.normalizedStartUrl}
                  </p>
                </div>
                <label className="grid gap-1 text-xs font-semibold text-app-ink">
                  Dataset
                  <select
                    className="min-h-10 rounded-lg border border-app-border bg-white px-3 text-sm"
                    value={item.datasetId}
                    onChange={(event) => {
                      const datasetId = event.target.value;
                      setBatchItems((current) =>
                        current.map((candidate, candidateIndex) =>
                          candidateIndex === index
                            ? { ...candidate, datasetId }
                            : candidate,
                        ),
                      );
                    }}
                  >
                    <option value="">Fără dataset</option>
                    {(datasets[item.test.id] ?? []).map((dataset) => (
                      <option key={dataset.id} value={dataset.id}>
                        {dataset.name}
                      </option>
                    ))}
                  </select>
                </label>
              </article>
            ))}
          </div>
          <section className="mt-4 grid gap-3 rounded-xl border border-app-border p-4">
            <label className="flex items-start gap-2">
              <input
                className="mt-1"
                type="checkbox"
                checked={clearBeforeEachTest}
                onChange={(event) =>
                  setClearBeforeEachTest(event.target.checked)
                }
              />
              <span>
                <strong className="block text-app-ink">
                  Clear session înainte de fiecare test
                </strong>
                <span className="text-xs">
                  Șterge toate cookie-urile contextului browserului, indiferent
                  de domeniu, plus storage-ul originii testului înainte de a
                  porni fiecare element din coadă.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input
                className="mt-1"
                type="checkbox"
                checked={continueOnFailure}
                onChange={(event) => setContinueOnFailure(event.target.checked)}
              />
              <span>
                <strong className="block text-app-ink">
                  Continuă cu următorul test dacă unul eșuează
                </strong>
              </span>
            </label>
            <div className="grid gap-1 text-sm font-semibold text-app-ink">
              <label htmlFor="run-all-max-step-retries">
                Retry-uri automate pentru un pas eșuat
              </label>
              <select
                id="run-all-max-step-retries"
                className="min-h-10 max-w-40 rounded-lg border border-app-border bg-white px-3"
                value={maxStepRetries}
                onChange={(event) =>
                  setMaxStepRetries(Number(event.target.value))
                }
              >
                {[0, 1, 2, 3, 4, 5].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
              <span className="text-xs font-normal text-app-muted">
                Dacă testul trece după retry, rezultatul este marcat Flaky.
              </span>
            </div>
          </section>
          {batchNeedsAi ? (
            <section className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
              <h3 className="font-semibold text-violet-950">
                Model AI pentru această serie
              </h3>
              <p className="mt-1 text-xs leading-5 text-violet-900">
                Cel puțin un test conține un pas AI, un check vizual/adaptiv sau
                o evaluare AI post-run. Alegerea se aplică tuturor testelor din
                această rulare în serie.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1.5 text-sm font-semibold text-violet-950">
                  Provider AI pentru această serie
                  <select
                    className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm"
                    value={aiProvider}
                    onChange={(event) => {
                      const provider = event.target.value as AiProviderId;
                      setAiProvider(provider);
                      setAiModels([]);
                      setAiModel(
                        aiSettings === undefined
                          ? ""
                          : modelFromSettings(aiSettings, provider),
                      );
                      setAiError(undefined);
                    }}
                  >
                    <option value="none">Selectează providerul</option>
                    <option value="gemini">Gemini</option>
                    <option value="openai">OpenAI</option>
                    <option value="lm_studio">LM Studio</option>
                    <option value="ollama">Ollama</option>
                  </select>
                </label>
                <label className="grid gap-1.5 text-sm font-semibold text-violet-950">
                  Model AI pentru această serie
                  {aiModels.length > 0 ? (
                    <select
                      className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm"
                      value={aiModel}
                      onChange={(event) => setAiModel(event.target.value)}
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
                      className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 text-sm"
                      value={aiModel}
                      placeholder="Selectează sau introdu modelul"
                      disabled={aiProvider === "none"}
                      onChange={(event) => setAiModel(event.target.value)}
                    />
                  )}
                </label>
              </div>
              <AiModelPricingPanel
                api={api}
                provider={aiProvider}
                model={aiModel}
                className="mt-3"
              />
              {aiBusy ? (
                <p className="mt-2 text-xs text-violet-900">
                  Se încarcă modelele…
                </p>
              ) : null}
              {aiProvider === "none" || aiModel.trim().length === 0 ? (
                <p className="mt-2 text-xs font-semibold text-red-700">
                  Selectează providerul și modelul pentru a putea porni seria.
                </p>
              ) : null}
              {aiError ? (
                <p
                  className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
                  role="alert"
                >
                  {aiError}
                </p>
              ) : null}
            </section>
          ) : null}
          <div className="mt-5 flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={onClose}>
              Anulează
            </Button>
            <Button
              disabled={
                items.length === 0 ||
                (batchNeedsAi &&
                  (aiProvider === "none" || aiModel.trim().length === 0))
              }
              onClick={() => void startBatch()}
            >
              Pornește {items.length} teste
            </Button>
          </div>
        </>
      ) : null}

      {phase === "running" ? (
        <>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 text-blue-950">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>
                Progres: {finishedCount}/{items.length}
              </strong>
              <span>
                {currentItem?.snapshot?.message ?? "Se pregătește testul…"}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
              <div
                className="h-full bg-blue-600 transition-[width]"
                style={{
                  width: `${items.length === 0 ? 0 : (finishedCount / items.length) * 100}%`,
                }}
              />
            </div>
          </div>
          <div className="mt-4 grid gap-2">
            {items.map((item, index) => (
              <article
                key={item.test.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-app-border p-3"
              >
                <span>
                  <strong className="text-app-ink">
                    {index + 1}. {item.test.name}
                  </strong>
                  {item.error ? (
                    <span className="mt-1 block text-xs text-red-700">
                      {item.error}
                    </span>
                  ) : null}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[item.status]}`}
                >
                  {statusLabels[item.status]}
                </span>
              </article>
            ))}
          </div>
          {currentItem?.snapshot?.state === "waiting_for_imap_check" ? (
            <section className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4 text-orange-950">
              <strong>Se așteaptă verificarea IMAP</strong>
              <p className="mt-1">{currentItem.snapshot.imap?.message}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={imapBusy || currentItem.snapshot.run === undefined}
                  onClick={() => {
                    const runId = currentItem.snapshot?.run?.id;
                    if (runId !== undefined) {
                      void api
                        .abandonImapCheck(runId)
                        .then((next) => snapshotHandlerRef.current(next));
                    }
                  }}
                >
                  Abandonează check-ul și continuă
                </Button>
                <Button
                  variant="danger"
                  disabled={imapBusy || currentItem.snapshot.run === undefined}
                  onClick={() => {
                    const runId = currentItem.snapshot?.run?.id;
                    if (runId !== undefined) {
                      void api
                        .stopRun(runId)
                        .then((next) => snapshotHandlerRef.current(next));
                    }
                  }}
                >
                  Marchează check failed
                </Button>
              </div>
            </section>
          ) : null}
          {currentItem?.snapshot !== undefined &&
          [
            "waiting_for_missing_data",
            "waiting_for_fallback_decision",
          ].includes(currentItem.snapshot.state) ? (
            <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
              <strong>Testul are nevoie de intervenție manuală</strong>
              <p className="mt-1">
                Run all nu poate completa automat datele lipsă sau o decizie de
                fallback. Poți opri doar testul curent și continua coada.
              </p>
              <Button
                className="mt-3"
                variant="secondary"
                disabled={currentItem.snapshot.run === undefined}
                onClick={() => {
                  const runId = currentItem.snapshot?.run?.id;
                  if (runId !== undefined) {
                    void api
                      .stopRun(runId)
                      .then((next) => snapshotHandlerRef.current(next));
                  }
                }}
              >
                Oprește testul curent și continuă
              </Button>
            </section>
          ) : null}
          <div className="mt-5 flex justify-end">
            <Button variant="danger" onClick={() => void stopBatch()}>
              Oprește toate testele
            </Button>
          </div>
        </>
      ) : null}

      {phase === "finalize" ? (
        <>
          <section className="rounded-xl border border-app-border bg-app-canvas p-4">
            <h3 className="font-semibold text-app-ink">Batch finalizat</h3>
            <p className="mt-1">
              {passedCount} passed · {failedCount} failed ·{" "}
              {items.length - passedCount - failedCount} oprite sau omise
            </p>
          </section>
          <div className="mt-4 grid gap-2">
            {items.map((item) => (
              <div
                key={item.test.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-app-border p-3"
              >
                <span className="font-semibold text-app-ink">
                  {item.test.name}
                </span>
                <span
                  className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClasses[item.status]}`}
                >
                  {statusLabels[item.status]}
                </span>
              </div>
            ))}
          </div>
          <section className="mt-5 rounded-xl border border-orange-300 bg-orange-50 p-4 text-orange-950">
            <h3 className="font-semibold">Curățare finală opțională</h3>
            <p className="mt-1">
              Wipe complet șterge cookies, storage, IndexedDB, cache și service
              workers, plus toate rândurile MySQL inserate detectate (
              {insertedRows}). Nu s-a șters nimic automat între teste.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" onClick={finishWithoutWipe}>
                Păstrează toate datele
              </Button>
              <Button variant="danger" onClick={() => void runFullWipe()}>
                Wipe complet
              </Button>
            </div>
          </section>
        </>
      ) : null}

      {phase === "cleaning" ? (
        <p role="status">Se execută wipe-ul final confirmat…</p>
      ) : null}

      {phase === "completed" ? (
        <>
          <h3 className="font-semibold text-app-ink">Finalizare încheiată</h3>
          <ul className="mt-3 grid gap-2">
            {cleanupMessages.map((message, index) => (
              <li
                key={`${index}-${message}`}
                className="rounded-lg border border-app-border bg-app-canvas p-3"
              >
                {message}
              </li>
            ))}
          </ul>
          <div className="mt-5 flex justify-end">
            <Button onClick={onClose}>Închide</Button>
          </div>
        </>
      ) : null}

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
    </Modal>
  );
};
