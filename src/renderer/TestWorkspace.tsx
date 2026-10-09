import { useCallback, useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import { getTestPrimaryAction, type TestInput } from "../shared/tests.js";
import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Dropdown } from "./components/Dropdown.js";
import { Tabs } from "./components/Tabs.js";
import { DatasetsPanel } from "./DatasetsPanel.js";
import { TestFormModal } from "./TestFormModal.js";
import { RunnerPanel } from "./RunnerPanel.js";
import { TestStagesEditor } from "./TestStagesEditor.js";
import { RecorderPanel } from "./RecorderPanel.js";
import { TestImportModal } from "./TestImportModal.js";
import { ExportPanel } from "./ExportPanel.js";
import { AiSimilarTestModal } from "./AiSimilarTestModal.js";
import { ProjectRunAllModal } from "./ProjectRunAllModal.js";
import { TestSuitesPanel } from "./TestSuitesPanel.js";
import type { TestSuite } from "../shared/test-suites.js";

export interface ProjectTestsPanelProps {
  api: SemanticAppApi;
  project: Project;
  onOpenTest: (test: TestDefinition) => void;
  onTestsChanged: () => void;
}

const workflowLabels: Record<TestDefinition["workflowState"], string> = {
  not_recorded: "Neînregistrat",
  recording: "Înregistrare în curs",
  recorded: "Flow înregistrat",
  analyzing_flow: "Se analizează flow-ul",
  flow_analyzed: "Flow analizat",
  ready: "Pregătit de rulare",
};

export const ProjectTestsPanel = ({
  api,
  onOpenTest,
  onTestsChanged,
  project,
}: ProjectTestsPanelProps) => {
  const [tests, setTests] = useState<TestDefinition[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [aiSourceTest, setAiSourceTest] = useState<TestDefinition>();
  const [runAllSelection, setRunAllSelection] = useState<{
    tests: TestDefinition[];
    suite?: TestSuite;
  }>();
  const [selectedTestIds, setSelectedTestIds] = useState<Set<string>>(
    new Set(),
  );
  const [deleteSelectionOpen, setDeleteSelectionOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [error, setError] = useState<string>();

  const loadTests = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      const loaded = await api.listTests(project.id);
      setTests(loaded);
      const loadedIds = new Set(loaded.map(({ id }) => id));
      setSelectedTestIds(
        (current) => new Set([...current].filter((id) => loadedIds.has(id))),
      );
    } catch {
      setError("Testele proiectului nu au putut fi încărcate.");
    } finally {
      setIsLoading(false);
    }
  }, [api, project.id]);

  useEffect(() => {
    void loadTests();
  }, [loadTests]);

  const createTest = async (input: TestInput): Promise<void> => {
    setIsSaving(true);
    try {
      const created = await api.createTest(project.id, input);
      setTests((current) => [...current, created]);
      setIsFormOpen(false);
      onTestsChanged();
      onOpenTest(created);
    } catch {
      setError("Testul nu a putut fi creat. Verifică URL-ul de start.");
    } finally {
      setIsSaving(false);
    }
  };

  const deleteSelectedTests = async (): Promise<void> => {
    if (isDeletingSelected || selectedTestIds.size === 0) return;
    const ids = tests
      .map(({ id }) => id)
      .filter((id) => selectedTestIds.has(id));
    setIsDeletingSelected(true);
    setError(undefined);
    try {
      const results = await Promise.allSettled(
        ids.map((testId) => api.deleteTest(project.id, testId)),
      );
      const deletedIds = new Set(
        ids.filter(
          (_id, index) =>
            results[index]?.status === "fulfilled" && results[index].value,
        ),
      );
      const failedCount = ids.length - deletedIds.size;
      if (deletedIds.size > 0) {
        setTests((current) => current.filter(({ id }) => !deletedIds.has(id)));
        setSelectedTestIds(
          (current) =>
            new Set([...current].filter((id) => !deletedIds.has(id))),
        );
        onTestsChanged();
      }
      setDeleteSelectionOpen(false);
      if (failedCount > 0) {
        setError(
          `${failedCount} ${failedCount === 1 ? "test nu a putut" : "teste nu au putut"} fi șterse. Selecția a fost păstrată pentru reîncercare.`,
        );
      }
    } finally {
      setIsDeletingSelected(false);
    }
  };

  const allTestsSelected =
    tests.length > 0 && tests.every(({ id }) => selectedTestIds.has(id));

  return (
    <section
      className="mt-6 rounded-2xl border border-app-border bg-app-surface p-6 shadow-sm"
      aria-labelledby={`project-tests-${project.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
            Recording-first
          </p>
          <h3
            id={`project-tests-${project.id}`}
            className="mt-1 text-xl font-semibold"
          >
            Testele proiectului
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Fiecare test începe cu o înregistrare manuală; pagina inițială este
            salvată automat în flow.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={tests.length === 0}
            onClick={() => setRunAllSelection({ tests })}
          >
            Rulează toate testele
          </Button>
          <TestImportModal
            api={api}
            projectId={project.id}
            onImported={(test) => {
              setTests((current) => [...current, test]);
              onTestsChanged();
              onOpenTest(test);
            }}
          />
          <Button
            onClick={() => {
              setIsFormOpen(true);
            }}
          >
            + Test nou
          </Button>
        </div>
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
        <p className="mt-5 text-sm text-app-muted" role="status">
          Se încarcă testele...
        </p>
      ) : tests.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-app-border bg-app-canvas p-6 text-center">
          <p className="font-medium">Proiectul nu are încă teste</p>
          <p className="mt-1 text-sm text-app-muted">
            Creează testul și apoi înregistrează flow-ul manual.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-app-border bg-white p-3">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-app-ink">
              <input
                type="checkbox"
                aria-label="Selectează toate testele"
                checked={allTestsSelected}
                onChange={(event) =>
                  setSelectedTestIds(
                    event.target.checked
                      ? new Set(tests.map(({ id }) => id))
                      : new Set(),
                  )
                }
              />
              Selectează toate
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-app-muted">
                {selectedTestIds.size} selectate
              </span>
              {selectedTestIds.size > 0 ? (
                <Button
                  variant="secondary"
                  disabled={isDeletingSelected}
                  onClick={() => setSelectedTestIds(new Set())}
                >
                  Golește selecția
                </Button>
              ) : null}
              <Button
                variant="danger"
                disabled={selectedTestIds.size === 0 || isDeletingSelected}
                onClick={() => setDeleteSelectionOpen(true)}
              >
                Șterge selectate ({selectedTestIds.size})
              </Button>
            </div>
          </div>
          {tests.map((test) => (
            <article
              key={test.id}
              className={`rounded-xl border bg-app-canvas p-4 transition hover:border-brand-500 ${
                selectedTestIds.has(test.id)
                  ? "border-red-300 ring-2 ring-red-100"
                  : "border-app-border"
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <input
                    className="mt-1"
                    type="checkbox"
                    aria-label={`Selectează testul ${test.name}`}
                    checked={selectedTestIds.has(test.id)}
                    onChange={(event) =>
                      setSelectedTestIds((current) => {
                        const next = new Set(current);
                        if (event.target.checked) next.add(test.id);
                        else next.delete(test.id);
                        return next;
                      })
                    }
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2 font-semibold text-app-ink">
                      {test.name}
                      {test.aiGeneration ? (
                        <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                          AI generated test
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-1 block break-all text-xs text-app-muted">
                      {test.normalizedStartUrl}
                    </span>
                  </span>
                </div>
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                  {workflowLabels[test.workflowState]}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button variant="secondary" onClick={() => onOpenTest(test)}>
                  {getTestPrimaryAction(test)} →
                </Button>
                <Button
                  variant="secondary"
                  disabled={test.flowItems.length === 0}
                  onClick={() => setAiSourceTest(test)}
                >
                  Generează similar cu AI
                </Button>
              </div>
            </article>
          ))}
        </div>
      )}

      <TestFormModal
        isSaving={isSaving}
        open={isFormOpen}
        project={project}
        onClose={() => {
          if (!isSaving) {
            setIsFormOpen(false);
          }
        }}
        onSave={(input) => {
          void createTest(input);
        }}
      />
      <ConfirmDialog
        open={deleteSelectionOpen}
        title="Ștergi testele selectate?"
        message={`${selectedTestIds.size} ${selectedTestIds.size === 1 ? "test va fi șters" : "teste vor fi șterse"} definitiv, împreună cu dataseturile, versiunile și rulările asociate.`}
        confirmLabel={
          isDeletingSelected
            ? "Se șterg..."
            : `Șterge ${selectedTestIds.size} ${selectedTestIds.size === 1 ? "test" : "teste"}`
        }
        confirmVariant="danger"
        onCancel={() => {
          if (!isDeletingSelected) setDeleteSelectionOpen(false);
        }}
        onConfirm={() => void deleteSelectedTests()}
      />
      {aiSourceTest ? (
        <AiSimilarTestModal
          api={api}
          open
          projectId={project.id}
          sourceTest={aiSourceTest}
          onClose={() => setAiSourceTest(undefined)}
          onCreated={(created) => {
            setTests((current) => [...current, created]);
            onTestsChanged();
          }}
        />
      ) : null}
      <ProjectRunAllModal
        api={api}
        open={runAllSelection !== undefined}
        project={project}
        tests={runAllSelection?.tests ?? []}
        {...(runAllSelection?.suite === undefined
          ? {}
          : { suite: runAllSelection.suite })}
        onClose={() => setRunAllSelection(undefined)}
        onFinished={() => {
          onTestsChanged();
        }}
      />
      <TestSuitesPanel
        api={api}
        project={project}
        tests={tests}
        onRunSuite={(suite, suiteTests) =>
          setRunAllSelection({ tests: suiteTests, suite })
        }
        onRunFailed={(failedTests) =>
          setRunAllSelection({ tests: failedTests })
        }
      />
    </section>
  );
};

export interface TestDetailPageProps {
  api: SemanticAppApi;
  project: Project;
  test: TestDefinition;
  onTestUpdated: (test: TestDefinition) => void;
  onBackToProject: () => void;
  onBackToProjects: () => void;
}

const flowStages = [
  { state: "not_recorded", label: "Înregistrează testul" },
  { state: "recorded", label: "Analiză live în timpul înregistrării" },
  { state: "flow_analyzed", label: "Revizuiește pașii" },
  { state: "ready", label: "Rulează testul" },
] as const;

const stageIndex = (state: TestDefinition["workflowState"]): number => {
  switch (state) {
    case "recording":
      return 0;
    case "recorded":
    case "analyzing_flow":
      return 1;
    case "flow_analyzed":
      return 2;
    case "ready":
      return 3;
    default:
      return 0;
  }
};

export const TestDetailPage = ({
  api,
  onBackToProject,
  onBackToProjects,
  onTestUpdated,
  project,
  test,
}: TestDetailPageProps) => {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isRevalidating, setIsRevalidating] = useState(false);
  const [editError, setEditError] = useState<string>();
  const activeStage = stageIndex(test.workflowState);
  const analysisSignal =
    test.workflowState === "analyzing_flow"
      ? "analyzing"
      : test.workflowState === "recorded"
        ? "blocked"
        : "ready";
  const actionHelp = useMemo(() => {
    if (test.workflowState === "not_recorded") {
      return "Recorderul va salva pagina curentă ca primul pas și va captura flow-ul manual.";
    }
    if (test.workflowState === "recorded") {
      return "Au rămas capturi nefinalizate; acestea trebuie reluate înainte de review.";
    }
    return "Acțiunea va deveni disponibilă în etapa funcțională corespunzătoare.";
  }, [test.workflowState]);
  const updateTest = async (input: TestInput): Promise<void> => {
    setIsSaving(true);
    setEditError(undefined);
    try {
      const updated = await api.updateTest(project.id, test.id, input);
      onTestUpdated(updated);
      setIsEditing(false);
    } catch {
      setEditError(
        "Testul nu a putut fi actualizat. Verifică URL-ul de start.",
      );
    } finally {
      setIsSaving(false);
    }
  };
  const revalidateTest = async (): Promise<void> => {
    setIsRevalidating(true);
    setEditError(undefined);
    try {
      onTestUpdated(await api.revalidateTest(project.id, test.id));
    } catch {
      setEditError("Testul nu a putut fi revalidat manual.");
    } finally {
      setIsRevalidating(false);
    }
  };
  const deleteTest = async (): Promise<void> => {
    setIsDeleting(true);
    setEditError(undefined);
    try {
      const wasDeleted = await api.deleteTest(project.id, test.id);
      if (!wasDeleted) throw new Error("Testul nu a fost șters.");
      setIsDeleteOpen(false);
      onBackToProject();
    } catch {
      setEditError("Testul nu a putut fi șters. Încearcă din nou.");
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="mt-8">
      <nav
        aria-label="Navigare proiect și test"
        className="flex flex-wrap items-center gap-2 text-sm"
      >
        <button
          type="button"
          className="text-brand-700 hover:underline"
          onClick={onBackToProjects}
        >
          Proiecte
        </button>
        <span className="text-app-muted">/</span>
        <button
          type="button"
          className="text-brand-700 hover:underline"
          onClick={onBackToProject}
        >
          {project.name}
        </button>
        <span className="text-app-muted">/</span>
        <span className="font-medium text-app-ink">{test.name}</span>
      </nav>

      <div className="mt-4 rounded-2xl border border-app-border bg-app-surface p-5 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
              Detalii test
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <h2 className="text-2xl font-semibold">{test.name}</h2>
              {test.aiGeneration ? (
                <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[11px] font-semibold text-violet-800">
                  AI generated test
                </span>
              ) : null}
            </div>
            {test.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
                {test.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <Dropdown
              align="right"
              compact
              label="Acțiuni test"
              items={[
                {
                  id: "edit-test",
                  label: "Editează detaliile",
                  onSelect: () => {
                    setEditError(undefined);
                    setIsEditing(true);
                  },
                },
                {
                  id: "delete-test",
                  label: "Șterge testul",
                  tone: "danger",
                  disabled: isDeleting,
                  onSelect: () => setIsDeleteOpen(true),
                },
              ]}
            />
            <p className="mt-2 max-w-xs text-xs text-app-muted">{actionHelp}</p>
          </div>
        </div>

        {editError ? (
          <p
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {editError}
          </p>
        ) : null}

        {test.status === "invalidated" ? (
          <div
            className="mt-5 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
            role="alert"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-semibold">
                  Test invalidat de o schimbare semantică
                </p>
                <p className="mt-1 text-sm">
                  Poți rula în continuare cu warning sau poți confirma manual că
                  locatorii sunt încă valizi.
                </p>
                {test.invalidation ? (
                  <p className="mt-2 text-xs">
                    Scor {Math.round(test.invalidation.score * 100)}% · prag{" "}
                    {Math.round(test.invalidation.threshold * 100)}%
                  </p>
                ) : null}
              </div>
              <Button
                variant="secondary"
                disabled={isRevalidating}
                onClick={() => {
                  void revalidateTest();
                }}
              >
                {isRevalidating ? "Se revalidează..." : "Revalidează manual"}
              </Button>
            </div>
          </div>
        ) : null}

        <dl className="mt-5 grid gap-3 rounded-xl border border-app-border bg-slate-50 p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-app-muted">Stare</dt>
            <dd className="mt-1 text-sm font-medium">
              {workflowLabels[test.workflowState]}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-app-muted">Tip test</dt>
            <dd className="mt-1 text-sm font-medium">
              {test.testMode === "dynamic_ai"
                ? "Dinamic · AI la cerere"
                : "Înregistrat · pași exacți"}
            </dd>
          </div>
        </dl>

        <div className="mt-5">
          <h3 className="font-semibold">Fluxul testului</h3>
          <ol className="mt-3 grid gap-3 md:grid-cols-4">
            {flowStages.map((stage, index) => (
              <li
                key={stage.state}
                className={`rounded-xl border p-4 ${
                  index === activeStage
                    ? "border-brand-500 bg-brand-50"
                    : index < activeStage
                      ? "border-emerald-200 bg-emerald-50"
                      : "border-app-border bg-app-canvas"
                }`}
              >
                <span className="text-xs font-semibold text-app-muted">
                  {index + 1}
                </span>
                <p className="mt-1 text-sm font-semibold">{stage.label}</p>
              </li>
            ))}
          </ol>
        </div>

        <section className="mt-5 rounded-xl border border-app-border bg-slate-50 p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Semafor analiză înregistrare</h3>
              <p className="mt-1 text-sm text-app-muted">
                Acțiunile sunt puse în coadă și analizate în fundal, fără să
                blocheze interacțiunea cu pagina.
              </p>
            </div>
            <div className="flex items-center gap-3 rounded-full border border-app-border bg-app-surface px-4 py-2">
              <span
                className={`h-3 w-3 rounded-full ${
                  analysisSignal === "ready"
                    ? "bg-emerald-500 ring-4 ring-emerald-100"
                    : "bg-emerald-200"
                }`}
                aria-label="Verde: poți continua"
              />
              <span
                className={`h-3 w-3 rounded-full ${
                  analysisSignal === "analyzing"
                    ? "bg-amber-500 ring-4 ring-amber-100"
                    : "bg-amber-200"
                }`}
                aria-label="Galben: analiza este în curs"
              />
              <span
                className={`h-3 w-3 rounded-full ${
                  analysisSignal === "blocked"
                    ? "bg-red-500 ring-4 ring-red-100"
                    : "bg-red-200"
                }`}
                aria-label="Roșu: analiza necesită intervenție"
              />
              <span className="text-xs font-semibold">
                {analysisSignal === "analyzing"
                  ? "Analiză în fundal · poți continua"
                  : analysisSignal === "blocked"
                    ? "Oprit · capturi incomplete"
                    : "Gata pentru interacțiune"}
              </span>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-app-muted">
            Tastarea este grupată până la blur/Enter sau următoarea acțiune, nu
            analizată caracter cu caracter. În Chrome extern, bara browserului
            nu poate fi dezactivată fizic; o navigare Back neașteptată
            invalidează captura și declanșează reluarea ei.
          </p>
        </section>

        <div className="mt-6">
          <Tabs
            label="Spațiul testului"
            tabs={[
              {
                id: "flow",
                label: "Flow",
                content: (
                  <>
                    <RecorderPanel
                      api={api}
                      project={project}
                      test={test}
                      onTestUpdated={onTestUpdated}
                    />
                    <TestStagesEditor
                      api={api}
                      projectId={project.id}
                      test={test}
                      onTestSaved={onTestUpdated}
                      section="flow"
                    />
                  </>
                ),
              },
              {
                id: "checks",
                label: "Checks",
                content: (
                  <TestStagesEditor
                    api={api}
                    projectId={project.id}
                    test={test}
                    onTestSaved={onTestUpdated}
                    section="checks"
                  />
                ),
              },
              {
                id: "datasets",
                label: "Date",
                content: (
                  <DatasetsPanel
                    api={api}
                    projectId={project.id}
                    testId={test.id}
                  />
                ),
              },
              {
                id: "run",
                label: "Rulare",
                content: (
                  <RunnerPanel api={api} project={project} test={test} />
                ),
              },
              {
                id: "export",
                label: "Export",
                content: (
                  <>
                    <ExportPanel
                      api={api}
                      projectId={project.id}
                      testId={test.id}
                    />
                    <details className="mt-4 rounded-xl border border-app-border bg-slate-50 p-3">
                      <summary className="cursor-pointer font-semibold text-app-ink">
                        Context și explicații
                      </summary>
                      <div className="mt-3 grid gap-3 lg:grid-cols-2">
                        <section className="rounded-lg bg-app-surface p-3">
                          <h3 className="font-semibold text-app-ink">
                            Context semantic oferit de tine
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-app-muted">
                            În configurare, înregistrare sau review vei putea
                            selecta produse, carduri, rânduri repetitive și
                            inputuri care primesc date. Selecțiile și
                            descrierile tale vor ghida interpretarea locală și
                            AI.
                          </p>
                        </section>
                        <section className="rounded-lg bg-app-surface p-3">
                          <h3 className="font-semibold text-app-ink">
                            Pagini relevante testului
                          </h3>
                          <p className="mt-2 text-sm leading-6 text-app-muted">
                            Vor apărea numai paginile întâlnite în această
                            înregistrare. Analizele celorlalte teste din proiect
                            nu vor fi trimise către AI.
                          </p>
                        </section>
                      </div>
                    </details>
                  </>
                ),
              },
            ]}
          />
        </div>
      </div>

      <TestFormModal
        isSaving={isSaving}
        open={isEditing}
        project={project}
        test={test}
        onClose={() => {
          if (!isSaving) {
            setIsEditing(false);
          }
        }}
        onSave={(input) => {
          void updateTest(input);
        }}
      />
      <ConfirmDialog
        open={isDeleteOpen}
        title="Ștergi testul?"
        message={`Testul „${test.name}” și toate dataseturile, versiunile și rulările asociate vor fi șterse definitiv.`}
        confirmLabel={isDeleting ? "Se șterge..." : "Șterge definitiv"}
        confirmVariant="danger"
        onCancel={() => {
          if (!isDeleting) setIsDeleteOpen(false);
        }}
        onConfirm={() => {
          if (!isDeleting) void deleteTest();
        }}
      />
    </section>
  );
};
