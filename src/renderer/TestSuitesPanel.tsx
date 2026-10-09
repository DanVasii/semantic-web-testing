import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import type { TestDataset } from "../shared/test-model.js";
import type {
  BatchRun,
  FlakyTestStatistic,
  TestSuite,
  TestSuiteItem,
} from "../shared/test-suites.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

export interface TestSuitesPanelProps {
  api: SemanticAppApi;
  project: Project;
  tests: TestDefinition[];
  onRunSuite: (suite: TestSuite, tests: TestDefinition[]) => void;
  onRunFailed: (tests: TestDefinition[]) => void;
}

const defaultSettings = {
  clearSessionBeforeEach: true,
  continueOnFailure: true,
  maxStepRetries: 1,
};

export const TestSuitesPanel = ({
  api,
  onRunFailed,
  onRunSuite,
  project,
  tests,
}: TestSuitesPanelProps) => {
  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [batches, setBatches] = useState<BatchRun[]>([]);
  const [flaky, setFlaky] = useState<FlakyTestStatistic[]>([]);
  const [datasets, setDatasets] = useState<Record<string, TestDataset[]>>({});
  const [editing, setEditing] = useState<TestSuite | "new">();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [items, setItems] = useState<TestSuiteItem[]>([]);
  const [settings, setSettings] = useState(defaultSettings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const available =
    api.listTestSuites !== undefined && api.saveTestSuite !== undefined;
  const load = async (): Promise<void> => {
    if (!available) return;
    const [loadedSuites, loadedBatches, loadedFlaky, datasetEntries] =
      await Promise.all([
        api.listTestSuites!(project.id),
        api.listBatchRuns?.(project.id) ?? Promise.resolve([]),
        api.listFlakyTestStatistics?.(project.id) ?? Promise.resolve([]),
        Promise.all(
          tests.map(
            async (test) =>
              [test.id, await api.listDatasets(project.id, test.id)] as const,
          ),
        ),
      ]);
    setSuites(loadedSuites);
    setBatches(loadedBatches);
    setFlaky(loadedFlaky);
    setDatasets(Object.fromEntries(datasetEntries));
  };

  useEffect(() => {
    void load().catch(() => setError("Suitele nu au putut fi încărcate."));
  }, [project.id, tests]);

  const testsById = useMemo(
    () => new Map(tests.map((test) => [test.id, test])),
    [tests],
  );
  const orderedEditorTests = useMemo(() => {
    const selected = items
      .map(({ testId }) => testsById.get(testId))
      .filter((test): test is TestDefinition => test !== undefined);
    const selectedIds = new Set(items.map(({ testId }) => testId));
    return [...selected, ...tests.filter(({ id }) => !selectedIds.has(id))];
  }, [items, tests, testsById]);
  const openEditor = (suite?: TestSuite): void => {
    setEditing(suite ?? "new");
    setName(suite?.name ?? "");
    setDescription(suite?.description ?? "");
    setItems(suite?.items ?? []);
    setSettings(suite?.settings ?? defaultSettings);
    setError(undefined);
  };

  const save = async (): Promise<void> => {
    if (api.saveTestSuite === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await api.saveTestSuite(
        project.id,
        editing === "new" ? undefined : editing?.id,
        { name, description, items, settings },
      );
      setEditing(undefined);
      await load();
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Suita nu a fost salvată.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (!available) return null;

  return (
    <section className="mt-5 rounded-xl border border-violet-200 bg-violet-50/60 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h4 className="font-semibold text-violet-950">Test Suites</h4>
          <p className="mt-1 text-xs text-violet-900">
            Salvează ordinea, dataseturile, clear session și retry-urile.
          </p>
        </div>
        <Button variant="secondary" onClick={() => openEditor()}>
          + Suită nouă
        </Button>
      </div>

      {error ? <p className="mt-3 text-sm text-red-700">{error}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {suites.map((suite) => {
          const suiteTests = suite.items
            .map(({ testId }) => testsById.get(testId))
            .filter((test): test is TestDefinition => test !== undefined);
          return (
            <article
              key={suite.id}
              className="rounded-lg border border-violet-200 bg-white p-3"
            >
              <strong className="text-app-ink">{suite.name}</strong>
              <p className="text-xs">
                {suiteTests.length} teste · {suite.settings.maxStepRetries}{" "}
                retry
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button onClick={() => onRunSuite(suite, suiteTests)}>
                  Rulează
                </Button>
                <Button variant="secondary" onClick={() => openEditor(suite)}>
                  Editează
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (api.deleteTestSuite === undefined) return;
                    void api
                      .deleteTestSuite(project.id, suite.id)
                      .then(() => load());
                  }}
                >
                  Șterge
                </Button>
              </div>
            </article>
          );
        })}
      </div>

      {batches.length > 0 ? (
        <details className="mt-4 rounded-lg border border-violet-200 bg-white p-3">
          <summary className="cursor-pointer font-semibold text-app-ink">
            Istoric Run all ({batches.length})
          </summary>
          <div className="mt-3 grid gap-2">
            {batches.slice(0, 10).map((batch) => {
              const failedTests = batch.items
                .filter(({ status }) => status === "failed")
                .map(({ testId }) => testsById.get(testId))
                .filter((test): test is TestDefinition => test !== undefined);
              return (
                <div
                  key={batch.id}
                  className="rounded border border-app-border p-3 text-xs"
                >
                  <strong>{batch.name}</strong> · {batch.status} ·{" "}
                  {
                    batch.items.filter(({ status }) => status === "flaky")
                      .length
                  }{" "}
                  flaky
                  {failedTests.length > 0 ? (
                    <Button
                      className="mt-2"
                      variant="secondary"
                      onClick={() => onRunFailed(failedTests)}
                    >
                      Rulează din nou testele eșuate
                    </Button>
                  ) : null}
                </div>
              );
            })}
          </div>
        </details>
      ) : null}

      {flaky.some(({ flakyRuns, failedRuns }) => flakyRuns + failedRuns > 0) ? (
        <details className="mt-3 rounded-lg border border-violet-200 bg-white p-3">
          <summary className="cursor-pointer font-semibold text-app-ink">
            Stabilitate teste
          </summary>
          <ul className="mt-2 grid gap-1 text-xs">
            {flaky.map((stat) => (
              <li key={stat.testId}>
                {stat.testName}: {Math.round(stat.flakyRate * 100)}% flaky ·{" "}
                {stat.failedRuns} failed din {stat.totalRuns}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <Modal
        open={editing !== undefined}
        title={editing === "new" ? "Suită nouă" : "Editează suita"}
        size="wide"
        onClose={() => !busy && setEditing(undefined)}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="grid gap-1 font-semibold text-app-ink">
            Nume
            <input
              className="min-h-10 rounded-lg border border-app-border px-3"
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="grid gap-1 font-semibold text-app-ink">
            Descriere
            <input
              className="min-h-10 rounded-lg border border-app-border px-3"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </div>
        <div className="mt-4 grid gap-2">
          {orderedEditorTests.map((test) => {
            const position = items.findIndex(
              ({ testId }) => testId === test.id,
            );
            const selected = position >= 0;
            const selectedItem = items[position];
            return (
              <div
                key={test.id}
                className="grid gap-2 rounded-lg border border-app-border p-3 md:grid-cols-[1fr_15rem_auto] md:items-center"
              >
                <label className="flex items-center gap-2 font-semibold text-app-ink">
                  <input
                    type="checkbox"
                    checked={selected}
                    onChange={(event) => {
                      if (event.target.checked) {
                        const testDatasets = datasets[test.id] ?? [];
                        const defaultDatasetId = testDatasets[0]?.id;
                        setItems((current) => [
                          ...current,
                          {
                            testId: test.id,
                            ...(defaultDatasetId
                              ? { datasetId: defaultDatasetId }
                              : {}),
                          },
                        ]);
                      } else {
                        setItems((current) =>
                          current.filter(({ testId }) => testId !== test.id),
                        );
                      }
                    }}
                  />
                  {selected ? `${position + 1}. ` : ""}
                  {test.name}
                </label>
                <select
                  className="min-h-9 rounded border border-app-border px-2"
                  disabled={!selected}
                  value={selectedItem?.datasetId ?? ""}
                  onChange={(event) =>
                    setItems((current) =>
                      current.map((item) =>
                        item.testId === test.id
                          ? {
                              testId: item.testId,
                              ...(event.target.value
                                ? { datasetId: event.target.value }
                                : {}),
                            }
                          : item,
                      ),
                    )
                  }
                >
                  <option value="">Fără dataset</option>
                  {(datasets[test.id] ?? []).map((dataset) => (
                    <option key={dataset.id} value={dataset.id}>
                      {dataset.name}
                    </option>
                  ))}
                </select>
                <span className="flex gap-1">
                  <button
                    type="button"
                    disabled={!selected || position === 0}
                    onClick={() =>
                      setItems((current) => {
                        const next = [...current];
                        [next[position - 1], next[position]] = [
                          next[position]!,
                          next[position - 1]!,
                        ];
                        return next;
                      })
                    }
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={!selected || position === items.length - 1}
                    onClick={() =>
                      setItems((current) => {
                        const next = [...current];
                        [next[position], next[position + 1]] = [
                          next[position + 1]!,
                          next[position]!,
                        ];
                        return next;
                      })
                    }
                  >
                    ↓
                  </button>
                </span>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label>
            <input
              type="checkbox"
              checked={settings.clearSessionBeforeEach}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  clearSessionBeforeEach: event.target.checked,
                }))
              }
            />{" "}
            Clear session înainte de fiecare
          </label>
          <label>
            <input
              type="checkbox"
              checked={settings.continueOnFailure}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  continueOnFailure: event.target.checked,
                }))
              }
            />{" "}
            Continuă după eșec
          </label>
          <label>
            Retry{" "}
            <select
              value={settings.maxStepRetries}
              onChange={(event) =>
                setSettings((current) => ({
                  ...current,
                  maxStepRetries: Number(event.target.value),
                }))
              }
            >
              {[0, 1, 2, 3, 4, 5].map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setEditing(undefined)}>
            Anulează
          </Button>
          <Button
            disabled={busy || items.length === 0 || name.trim().length === 0}
            onClick={() => void save()}
          >
            {busy ? "Se salvează…" : "Salvează suita"}
          </Button>
        </div>
      </Modal>
    </section>
  );
};
