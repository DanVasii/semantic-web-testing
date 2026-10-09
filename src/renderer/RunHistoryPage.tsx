import { useCallback, useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  Project,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { AiRunCost } from "../shared/runner.js";
import { AiRunCostDetails } from "./components/AiRunCostDetails.js";
import type {
  RunHistoryDetails,
  RunHistoryEntry,
  RunHistoryPurgeTarget,
  RunStorageUsage,
} from "../shared/run-history.js";
import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Modal } from "./components/Modal.js";
import { Select } from "./components/Select.js";

export interface RunHistoryPageProps {
  api: SemanticAppApi;
  project: Project;
  onBack: () => void;
}

type Confirmation =
  | { kind: "selected"; runIds: string[] }
  | { kind: "all" }
  | { kind: "purge"; target: RunHistoryPurgeTarget };

const statuses: TestRun["status"][] = [
  "running",
  "passed",
  "passed_with_warnings",
  "failed",
  "stopped",
];
const statusLabels: Record<TestRun["status"], string> = {
  running: "În curs",
  passed: "Passed",
  passed_with_warnings: "Passed cu warnings",
  failed: "Failed",
  stopped: "Oprit",
};

const formatDate = (value: string): string =>
  new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(value));

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const json = (value: unknown): string => JSON.stringify(value, null, 2);

const aiCostFrom = (value: unknown): AiRunCost | undefined => {
  if (typeof value !== "object" || value === null || !("aiCost" in value)) {
    return undefined;
  }
  const cost = value.aiCost;
  if (
    typeof cost !== "object" ||
    cost === null ||
    !("requestCount" in cost) ||
    typeof cost.requestCount !== "number" ||
    !("inputTokens" in cost) ||
    typeof cost.inputTokens !== "number" ||
    !("outputTokens" in cost) ||
    typeof cost.outputTokens !== "number" ||
    !("totalTokens" in cost) ||
    typeof cost.totalTokens !== "number" ||
    !("estimatedUsd" in cost) ||
    typeof cost.estimatedUsd !== "number" ||
    !("unpricedRequests" in cost) ||
    typeof cost.unpricedRequests !== "number" ||
    !("localOnly" in cost) ||
    typeof cost.localOnly !== "boolean"
  ) {
    return undefined;
  }
  return {
    requestCount: cost.requestCount,
    inputTokens: cost.inputTokens,
    outputTokens: cost.outputTokens,
    totalTokens: cost.totalTokens,
    estimatedUsd: cost.estimatedUsd,
    unpricedRequests: cost.unpricedRequests,
    localOnly: cost.localOnly,
    ...("requests" in cost && Array.isArray(cost.requests)
      ? {
          requests: cost.requests as NonNullable<AiRunCost["requests"]>,
        }
      : {}),
  };
};

export const RunHistoryPage = ({
  api,
  project,
  onBack,
}: RunHistoryPageProps) => {
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [entries, setEntries] = useState<RunHistoryEntry[]>([]);
  const [storage, setStorage] = useState<RunStorageUsage>();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testFilter, setTestFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [details, setDetails] = useState<RunHistoryDetails>();
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [isLoading, setIsLoading] = useState(true);
  const [isMutating, setIsMutating] = useState(false);
  const [error, setError] = useState<string>();

  const load = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const [loadedTests, loadedEntries, loadedStorage] = await Promise.all([
        api.listTests(project.id),
        api.listProjectRunHistory(project.id, {
          ...(testFilter.length === 0 ? {} : { testId: testFilter }),
          ...(statusFilter.length === 0
            ? {}
            : { statuses: [statusFilter as TestRun["status"]] }),
        }),
        api.getRunStorageUsage(project.id),
      ]);
      setTests(loadedTests);
      setEntries(loadedEntries);
      setStorage(loadedStorage);
      setSelected((current) => {
        const visibleIds = new Set(loadedEntries.map(({ run }) => run.id));
        return new Set([...current].filter((id) => visibleIds.has(id)));
      });
    } catch {
      setError("Istoricul rulărilor nu a putut fi încărcat.");
    } finally {
      setIsLoading(false);
    }
  }, [api, project.id, statusFilter, testFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const openDetails = async (runId: string): Promise<void> => {
    setError(undefined);
    try {
      setDetails(await api.getRunHistoryDetails(project.id, runId));
    } catch {
      setError("Detaliile rulării nu au putut fi încărcate.");
    }
  };

  const mutate = async (): Promise<void> => {
    if (confirmation === undefined) return;
    setIsMutating(true);
    setError(undefined);
    try {
      const result =
        confirmation.kind === "selected"
          ? await api.deleteRunHistory(project.id, confirmation.runIds)
          : confirmation.kind === "all"
            ? await api.deleteAllRunHistory(project.id)
            : await api.purgeRunHistoryData(project.id, confirmation.target);
      setStorage(result.storage);
      setSelected(new Set());
      setDetails(undefined);
      setConfirmation(undefined);
      await load();
    } catch {
      setError("Operația de mentenanță nu a putut fi finalizată.");
    } finally {
      setIsMutating(false);
    }
  };

  const allVisibleSelected =
    entries.length > 0 && entries.every(({ run }) => selected.has(run.id));
  const selectedIds = useMemo(() => [...selected], [selected]);

  return (
    <section className="mt-8" aria-labelledby="run-history-title">
      <nav aria-label="Navigare istoric" className="text-sm">
        <button
          type="button"
          className="text-brand-700 hover:underline"
          onClick={onBack}
        >
          ← Înapoi la proiect
        </button>
      </nav>
      <div className="mt-5 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-brand-700 uppercase">
            {project.name}
          </p>
          <h2 id="run-history-title" className="mt-2 text-3xl font-semibold">
            Istoric rulări
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            Toate testele, rezultatele post-run și datele de diagnostic.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()}>
          Reîncarcă
        </Button>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Rulări", String(storage?.runCount ?? 0)],
          ["Total", formatBytes(storage?.totalBytes ?? 0)],
          ["Snapshots", formatBytes(storage?.snapshotsBytes ?? 0)],
          ["Logs", formatBytes(storage?.logsBytes ?? 0)],
        ].map(([label, value]) => (
          <div
            key={label}
            className="rounded-xl border border-app-border bg-app-surface p-4"
          >
            <p className="text-xl font-semibold">{value}</p>
            <p className="mt-1 text-xs text-app-muted">{label}</p>
          </div>
        ))}
      </div>

      <div className="mt-5 grid gap-3 rounded-xl border border-app-border bg-app-surface p-4 lg:grid-cols-[1fr_1fr_auto]">
        <Select
          label="Filtru test"
          value={testFilter}
          options={[
            { value: "", label: "Toate testele" },
            ...tests.map((test) => ({ value: test.id, label: test.name })),
          ]}
          onChange={(event) => setTestFilter(event.target.value)}
        />
        <Select
          label="Filtru status"
          value={statusFilter}
          options={[
            { value: "", label: "Toate statusurile" },
            ...statuses.map((status) => ({
              value: status,
              label: statusLabels[status],
            })),
          ]}
          onChange={(event) => setStatusFilter(event.target.value)}
        />
        <div className="flex items-end gap-2">
          <Button
            variant="secondary"
            disabled={selectedIds.length === 0}
            onClick={() =>
              setConfirmation({ kind: "selected", runIds: selectedIds })
            }
          >
            Șterge selectate
          </Button>
          <Button
            variant="danger"
            disabled={entries.length === 0}
            onClick={() => setConfirmation({ kind: "all" })}
          >
            Șterge toate
          </Button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={(storage?.snapshotsBytes ?? 0) === 0}
          onClick={() =>
            setConfirmation({ kind: "purge", target: "snapshots" })
          }
        >
          Șterge doar snapshots
        </Button>
        <Button
          variant="secondary"
          disabled={(storage?.logsBytes ?? 0) <= 2}
          onClick={() => setConfirmation({ kind: "purge", target: "logs" })}
        >
          Șterge doar logs
        </Button>
      </div>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <p className="mt-6 text-sm text-app-muted" role="status">
          Se încarcă istoricul...
        </p>
      ) : entries.length === 0 ? (
        <p className="mt-6 rounded-xl border border-dashed border-app-border bg-app-surface p-6 text-center text-sm text-app-muted">
          Nu există rulări pentru filtrele selectate.
        </p>
      ) : (
        <div className="mt-5 overflow-x-auto rounded-xl border border-app-border bg-app-surface">
          <table className="min-w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs text-app-muted">
              <tr>
                <th className="p-3">
                  <input
                    type="checkbox"
                    aria-label="Selectează toate rulările vizibile"
                    checked={allVisibleSelected}
                    onChange={(event) =>
                      setSelected(
                        event.target.checked
                          ? new Set(entries.map(({ run }) => run.id))
                          : new Set(),
                      )
                    }
                  />
                </th>
                <th className="p-3">Test</th>
                <th className="p-3">Pornit</th>
                <th className="p-3">Status</th>
                <th className="p-3">Pași</th>
                <th className="p-3">Dataset</th>
                <th className="p-3">Acțiuni</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-app-border">
              {entries.map((entry) => (
                <tr key={entry.run.id}>
                  <td className="p-3">
                    <input
                      type="checkbox"
                      aria-label={`Selectează rularea ${entry.run.id}`}
                      checked={selected.has(entry.run.id)}
                      onChange={(event) =>
                        setSelected((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(entry.run.id);
                          else next.delete(entry.run.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  <td className="p-3 font-medium">{entry.testName}</td>
                  <td className="p-3 text-xs">
                    {formatDate(entry.run.startedAt)}
                  </td>
                  <td className="p-3">{statusLabels[entry.run.status]}</td>
                  <td className="p-3">
                    {entry.stepCount}
                    {entry.fallbackStepCount > 0
                      ? ` · ${entry.fallbackStepCount} fallback`
                      : ""}
                  </td>
                  <td className="p-3">{entry.datasetName ?? "Fără dataset"}</td>
                  <td className="p-3">
                    <Button
                      className="min-h-8 px-3 py-1"
                      variant="secondary"
                      onClick={() => void openDetails(entry.run.id)}
                    >
                      Detalii
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={details !== undefined}
        title={
          details ? `Rulare · ${details.entry.testName}` : "Detalii rulare"
        }
        onClose={() => setDetails(undefined)}
      >
        {details ? <RunDetails details={details} /> : null}
      </Modal>

      <ConfirmDialog
        open={confirmation !== undefined}
        title="Confirmă operația"
        message={
          confirmation?.kind === "selected"
            ? `Ștergi definitiv ${confirmation.runIds.length} rulări selectate și datele lor?`
            : confirmation?.kind === "all"
              ? "Ștergi definitiv toate rulările proiectului și datele asociate?"
              : confirmation?.target === "snapshots"
                ? "Ștergi snapshot-urile MySQL și referințele de versiune, păstrând rulările și logs?"
                : "Ștergi numai logs-urile pașilor, păstrând rulările și snapshots?"
        }
        confirmLabel={isMutating ? "Se procesează..." : "Confirmă"}
        cancelLabel="Anulează"
        confirmVariant="danger"
        onCancel={() => {
          if (!isMutating) setConfirmation(undefined);
        }}
        onConfirm={() => {
          if (!isMutating) void mutate();
        }}
      />
    </section>
  );
};

const RunDetails = ({ details }: { details: RunHistoryDetails }) => {
  const aiCost = aiCostFrom(details.postRunResult);
  return (
    <div className="grid max-h-[70vh] gap-5 overflow-y-auto pr-1 text-sm">
      {aiCost ? <AiRunCostDetails cost={aiCost} /> : null}
      <section>
        <h4 className="font-semibold">Pași și fallback-uri</h4>
        {details.steps.length === 0 ? (
          <p className="mt-2 text-app-muted">Nu există rezultate de pas.</p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {details.steps.map((step) => (
              <li
                key={step.id}
                className="rounded-lg border border-app-border p-3"
              >
                <p className="font-medium">
                  {step.stepId} · {step.status}
                  {step.fallbackIndex === undefined
                    ? ""
                    : ` · fallback ${step.fallbackIndex + 1}`}
                </p>
                {step.logs.length > 0 ? (
                  <pre className="mt-2 overflow-x-auto whitespace-pre-wrap text-xs text-app-muted">
                    {json(step.logs)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <DetailsJson title="Dataset efectiv" value={details.dataset} />
      <DetailsJson title="MySQL diff" value={details.mysqlDiffs} />
      <DetailsJson title="Rezultat IMAP" value={details.imapResults} />
      <DetailsJson
        title="Rezultat post-run / AI"
        value={details.postRunResult}
      />
      <DetailsJson title="Eroare finală" value={details.error} />
      <section>
        <h4 className="font-semibold">Artefacte de diagnostic</h4>
        {(details.artifacts ?? []).length === 0 ? (
          <p className="mt-2 text-app-muted">
            Nu există artefacte pentru această rulare.
          </p>
        ) : (
          <ul className="mt-2 grid gap-2">
            {(details.artifacts ?? []).map((artifact) => (
              <li
                key={artifact.id}
                className="rounded-lg border border-app-border p-3"
              >
                <strong>{artifact.kind}</strong> ·{" "}
                {Math.ceil(artifact.sizeBytes / 1024)} KB
                <code className="mt-1 block break-all text-xs">
                  {artifact.filePath}
                </code>
                <button
                  type="button"
                  className="mt-2 text-xs font-semibold text-brand-700 hover:underline"
                  onClick={() =>
                    void navigator.clipboard.writeText(artifact.filePath)
                  }
                >
                  Copiază calea
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const DetailsJson = ({ title, value }: { title: string; value: unknown }) => (
  <section>
    <h4 className="font-semibold">{title}</h4>
    <pre className="mt-2 max-h-64 overflow-auto rounded-lg bg-slate-950 p-3 text-xs whitespace-pre-wrap text-slate-100">
      {value === undefined ? "N/A" : json(value)}
    </pre>
  </section>
);
