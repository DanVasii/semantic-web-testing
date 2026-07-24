import { useCallback, useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project, TestDefinition } from "../shared/persistence.js";
import { getTestPrimaryAction, type TestInput } from "../shared/tests.js";
import { Button } from "./components/Button.js";
import { TestFormModal } from "./TestFormModal.js";

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
  const [error, setError] = useState<string>();

  const loadTests = useCallback(async () => {
    setIsLoading(true);
    setError(undefined);
    try {
      setTests(await api.listTests(project.id));
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
            Fiecare test începe cu o înregistrare manuală și are propriul URL de
            start.
          </p>
        </div>
        <Button
          onClick={() => {
            setIsFormOpen(true);
          }}
        >
          + Test nou
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
        <p className="mt-5 text-sm text-app-muted" role="status">
          Se încarcă testele...
        </p>
      ) : tests.length === 0 ? (
        <div className="mt-5 rounded-xl border border-dashed border-app-border bg-app-canvas p-6 text-center">
          <p className="font-medium">Proiectul nu are încă teste</p>
          <p className="mt-1 text-sm text-app-muted">
            Creează testul, configurează URL-ul de start și apoi înregistrează
            flow-ul manual.
          </p>
        </div>
      ) : (
        <div className="mt-5 grid gap-3">
          {tests.map((test) => (
            <button
              key={test.id}
              type="button"
              className="rounded-xl border border-app-border bg-app-canvas p-4 text-left transition hover:border-brand-500 focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
              onClick={() => {
                onOpenTest(test);
              }}
            >
              <span className="flex flex-wrap items-start justify-between gap-3">
                <span>
                  <span className="block font-semibold text-app-ink">
                    {test.name}
                  </span>
                  <span className="mt-1 block break-all text-xs text-app-muted">
                    {test.normalizedStartUrl}
                  </span>
                </span>
                <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-800">
                  {workflowLabels[test.workflowState]}
                </span>
              </span>
              <span className="mt-3 block text-sm font-medium text-brand-700">
                {getTestPrimaryAction(test)} →
              </span>
            </button>
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
  const [editError, setEditError] = useState<string>();
  const activeStage = stageIndex(test.workflowState);
  const primaryAction = getTestPrimaryAction(test);
  const analysisSignal =
    test.workflowState === "analyzing_flow"
      ? "analyzing"
      : test.workflowState === "recorded"
        ? "blocked"
        : "ready";
  const actionHelp = useMemo(() => {
    if (test.workflowState === "not_recorded") {
      return "Recorderul va deschide URL-ul de start și va captura flow-ul manual.";
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

      <div className="mt-5 rounded-2xl border border-app-border bg-app-surface p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
              Detalii test
            </p>
            <h2 className="mt-2 text-3xl font-semibold">{test.name}</h2>
            {test.description ? (
              <p className="mt-2 max-w-2xl text-sm leading-6 text-app-muted">
                {test.description}
              </p>
            ) : null}
          </div>
          <div className="flex flex-col items-end gap-2 text-right">
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                onClick={() => {
                  setEditError(undefined);
                  setIsEditing(true);
                }}
              >
                Editează testul
              </Button>
              <Button disabled title={actionHelp}>
                {primaryAction}
              </Button>
            </div>
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

        <dl className="mt-6 grid gap-3 rounded-xl border border-app-border bg-app-canvas p-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-app-muted">URL de start</dt>
            <dd className="mt-1 break-all text-sm font-medium">
              {test.normalizedStartUrl}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-app-muted">Stare</dt>
            <dd className="mt-1 text-sm font-medium">
              {workflowLabels[test.workflowState]}
            </dd>
          </div>
        </dl>

        <div className="mt-6">
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

        <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold">Semafor analiză înregistrare</h3>
              <p className="mt-1 text-sm text-app-muted">
                După fiecare acțiune stabilă, inputul este blocat foarte scurt
                până când captura paginii este salvată.
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
                  ? "Input blocat · se analizează"
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

        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <section className="rounded-xl border border-app-border p-4">
            <h3 className="font-semibold">Context semantic oferit de tine</h3>
            <p className="mt-2 text-sm leading-6 text-app-muted">
              În configurare, înregistrare sau review vei putea selecta produse,
              carduri, rânduri repetitive și inputuri care primesc date.
              Selecțiile și descrierile tale vor ghida interpretarea locală și
              AI.
            </p>
          </section>
          <section className="rounded-xl border border-app-border p-4">
            <h3 className="font-semibold">Pagini relevante testului</h3>
            <p className="mt-2 text-sm leading-6 text-app-muted">
              Vor apărea numai paginile întâlnite în această înregistrare.
              Analizele celorlalte teste din proiect nu vor fi trimise către AI.
            </p>
          </section>
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
    </section>
  );
};
