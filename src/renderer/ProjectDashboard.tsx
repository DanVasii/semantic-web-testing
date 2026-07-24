import { useCallback, useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  BasicAuthCredentials,
  BrowserManagerStatus,
} from "../shared/browser-manager.js";
import type { ProjectInput, ProjectOverview } from "../shared/projects.js";
import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Toast, type ToastVariant } from "./components/Toast.js";
import { BrowserSelector } from "./BrowserSelector.js";
import { BasicAuthDialog } from "./BasicAuthDialog.js";
import { ProjectFormModal } from "./ProjectFormModal.js";

const LAST_PROJECT_STORAGE_KEY = "semantic-app:last-project-id";

interface Notification {
  variant: ToastVariant;
  title: string;
  message: string;
}

export interface ProjectDashboardProps {
  api?: SemanticAppApi;
}

const formatDate = (value?: string): string => {
  if (!value) {
    return "Nicio rulare";
  }

  return new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
};

export const ProjectDashboard = ({
  api = window.semanticApp,
}: ProjectDashboardProps) => {
  const [projects, setProjects] = useState<ProjectOverview[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>();
  const [editingProject, setEditingProject] = useState<ProjectOverview>();
  const [deletingProject, setDeletingProject] = useState<ProjectOverview>();
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isSubmittingBasicAuth, setIsSubmittingBasicAuth] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [notification, setNotification] = useState<Notification>();
  const [browserStatus, setBrowserStatus] = useState<BrowserManagerStatus>({
    state: "idle",
  });

  const loadProjects = useCallback(async () => {
    setIsLoading(true);
    setLoadError(false);

    try {
      const loadedProjects = await api.listProjects();
      setProjects(loadedProjects);
      const lastProjectId = localStorage.getItem(LAST_PROJECT_STORAGE_KEY);

      if (
        lastProjectId &&
        loadedProjects.some(({ project }) => project.id === lastProjectId)
      ) {
        setSelectedProjectId(lastProjectId);
      } else if (lastProjectId) {
        localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }
    } catch {
      setLoadError(true);
    } finally {
      setIsLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    let isActive = true;
    const unsubscribe = api.onBrowserStatusChange((status) => {
      if (isActive) {
        setBrowserStatus(status);
      }
    });

    void api
      .getBrowserStatus()
      .then((status) => {
        if (isActive) {
          setBrowserStatus(status);
        }
      })
      .catch(() => undefined);

    return () => {
      isActive = false;
      unsubscribe();
    };
  }, [api]);

  const selectedProject = useMemo(
    () => projects.find(({ project }) => project.id === selectedProjectId),
    [projects, selectedProjectId],
  );

  const updateProjectOverview = useCallback((updated: ProjectOverview) => {
    setProjects((current) =>
      current.map((item) =>
        item.project.id === updated.project.id ? updated : item,
      ),
    );
  }, []);

  const submitBasicAuth = async (
    credentials: BasicAuthCredentials,
  ): Promise<void> => {
    setIsSubmittingBasicAuth(true);

    try {
      const result = await api.submitBasicAuth(credentials);
      if (result.state === "opened") {
        setNotification({
          variant: "success",
          title: "Autentificare reușită",
          message: "Navigarea proiectului a continuat.",
        });
      }
    } catch {
      setNotification({
        variant: "error",
        title: "Autentificarea nu a continuat",
        message: "Încearcă din nou fără a închide browserul.",
      });
    } finally {
      setIsSubmittingBasicAuth(false);
    }
  };

  const cancelBasicAuth = async (): Promise<void> => {
    if (isSubmittingBasicAuth) {
      return;
    }

    try {
      await api.cancelBasicAuth();
    } catch {
      setNotification({
        variant: "error",
        title: "Dialogul nu a putut fi închis",
        message: "Închide browserul și încearcă din nou.",
      });
    }
  };

  const openProject = (projectId: string): void => {
    setSelectedProjectId(projectId);
    localStorage.setItem(LAST_PROJECT_STORAGE_KEY, projectId);
  };

  const saveProject = async (input: ProjectInput): Promise<void> => {
    setIsSaving(true);

    try {
      if (editingProject) {
        const updated = await api.updateProject(
          editingProject.project.id,
          input,
        );
        setProjects((current) =>
          current.map((item) =>
            item.project.id === updated.project.id ? updated : item,
          ),
        );
        setNotification({
          variant: "success",
          title: "Proiect actualizat",
          message: "Modificările au fost salvate local.",
        });
      } else {
        const created = await api.createProject(input);
        setProjects((current) => [...current, created]);
        openProject(created.project.id);
        setNotification({
          variant: "success",
          title: "Proiect creat",
          message: `${created.project.name} este pregătit pentru configurare.`,
        });
      }

      setIsFormOpen(false);
      setEditingProject(undefined);
    } catch {
      setNotification({
        variant: "error",
        title: "Proiectul nu a fost salvat",
        message: "Verifică datele și încearcă din nou.",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const deleteProject = async (): Promise<void> => {
    if (!deletingProject) {
      return;
    }

    setIsDeleting(true);

    try {
      const projectId = deletingProject.project.id;
      const wasDeleted = await api.deleteProject(projectId);

      if (!wasDeleted) {
        throw new Error("Project was not deleted.");
      }

      setProjects((current) =>
        current.filter(({ project }) => project.id !== projectId),
      );

      if (selectedProjectId === projectId) {
        setSelectedProjectId(undefined);
        localStorage.removeItem(LAST_PROJECT_STORAGE_KEY);
      }

      setNotification({
        variant: "success",
        title: "Proiect șters",
        message: `${deletingProject.project.name} și datele asociate au fost șterse.`,
      });
      setDeletingProject(undefined);
    } catch {
      setNotification({
        variant: "error",
        title: "Proiectul nu a fost șters",
        message: "Încearcă din nou după câteva momente.",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="mt-8" aria-labelledby="projects-title">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-[0.14em] text-brand-700 uppercase">
            Workspace local
          </p>
          <h2
            id="projects-title"
            className="mt-2 text-3xl font-semibold tracking-tight"
          >
            Proiecte
          </h2>
          <p className="mt-2 text-sm text-app-muted">
            Configurează aplicațiile pe care vrei să le testezi semantic.
          </p>
        </div>
        <Button
          onClick={() => {
            setEditingProject(undefined);
            setIsFormOpen(true);
          }}
        >
          + Proiect nou
        </Button>
      </div>

      {notification ? (
        <div className="mt-6">
          <Toast
            {...notification}
            onDismiss={() => {
              setNotification(undefined);
            }}
          />
        </div>
      ) : null}

      {loadError ? (
        <div
          role="alert"
          className="mt-6 rounded-2xl border border-red-200 bg-red-50 p-6"
        >
          <h3 className="font-semibold text-red-900">
            Proiectele nu au putut fi încărcate
          </h3>
          <p className="mt-1 text-sm text-red-800">
            Baza locală nu este disponibilă momentan.
          </p>
          <Button
            className="mt-4"
            variant="secondary"
            onClick={() => {
              void loadProjects();
            }}
          >
            Reîncearcă
          </Button>
        </div>
      ) : isLoading ? (
        <div
          role="status"
          className="mt-6 rounded-2xl border border-app-border bg-app-surface p-8 text-center text-sm text-app-muted"
        >
          Se încarcă proiectele...
        </div>
      ) : projects.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-app-border bg-app-surface px-6 py-14 text-center">
          <div className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-brand-100 text-xl text-brand-700">
            ◇
          </div>
          <h3 className="mt-4 text-lg font-semibold">Creează primul proiect</h3>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-app-muted">
            Adaugă numele și URL-ul aplicației. Configurarea browserului și
            analiza paginilor vor fi disponibile în proiect.
          </p>
          <Button
            className="mt-6"
            onClick={() => {
              setEditingProject(undefined);
              setIsFormOpen(true);
            }}
          >
            Creează proiect
          </Button>
        </div>
      ) : (
        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.2fr)]">
          <div className="grid content-start gap-3">
            {projects.map((overview) => {
              const isSelected =
                overview.project.id === selectedProject?.project.id;

              return (
                <article
                  key={overview.project.id}
                  className={`rounded-xl border bg-app-surface p-4 shadow-sm transition ${
                    isSelected
                      ? "border-brand-500 ring-2 ring-brand-100"
                      : "border-app-border hover:border-brand-500"
                  }`}
                >
                  <button
                    type="button"
                    className="block w-full text-left focus-visible:rounded-md focus-visible:ring-2 focus-visible:ring-brand-500 focus-visible:outline-none"
                    onClick={() => {
                      openProject(overview.project.id);
                    }}
                  >
                    <span className="text-base font-semibold text-app-ink">
                      {overview.project.name}
                    </span>
                    <span className="mt-1 block truncate text-sm text-app-muted">
                      {overview.project.normalizedBaseUrl}
                    </span>
                    <span className="mt-3 flex gap-3 text-xs text-app-muted">
                      <span>{overview.statistics.pageCount} pagini</span>
                      <span>{overview.statistics.testCount} teste</span>
                      <span>{overview.statistics.runCount} rulări</span>
                    </span>
                  </button>
                  <div className="mt-4 flex gap-2 border-t border-app-border pt-3">
                    <Button
                      className="min-h-8 px-3 py-1"
                      onClick={() => {
                        openProject(overview.project.id);
                      }}
                    >
                      Deschide
                    </Button>
                    <Button
                      className="min-h-8 px-3 py-1"
                      variant="secondary"
                      onClick={() => {
                        setEditingProject(overview);
                        setIsFormOpen(true);
                      }}
                    >
                      Editează
                    </Button>
                    <Button
                      className="min-h-8 px-3 py-1"
                      variant="secondary"
                      aria-label={`Șterge proiectul ${overview.project.name}`}
                      onClick={() => {
                        setDeletingProject(overview);
                      }}
                    >
                      Șterge
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>

          {selectedProject ? (
            <ProjectOverviewPanel
              api={api}
              browserStatus={browserStatus}
              onProjectUpdated={updateProjectOverview}
              overview={selectedProject}
            />
          ) : (
            <div className="grid min-h-72 place-items-center rounded-2xl border border-app-border bg-app-surface p-8 text-center shadow-sm">
              <div>
                <p className="text-lg font-semibold">Selectează un proiect</p>
                <p className="mt-2 text-sm text-app-muted">
                  Deschide un proiect pentru a vedea configurația și
                  statisticile sale.
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      <ProjectFormModal
        open={isFormOpen}
        {...(editingProject ? { project: editingProject.project } : {})}
        isSaving={isSaving}
        onClose={() => {
          if (!isSaving) {
            setIsFormOpen(false);
            setEditingProject(undefined);
          }
        }}
        onSave={saveProject}
      />

      <ConfirmDialog
        open={deletingProject !== undefined}
        title="Ștergi proiectul?"
        message={
          deletingProject
            ? `Proiectul „${deletingProject.project.name}” și toate paginile, testele și rulările sale vor fi șterse definitiv.`
            : ""
        }
        confirmLabel={isDeleting ? "Se șterge..." : "Șterge proiectul"}
        cancelLabel="Păstrează proiectul"
        confirmVariant="danger"
        onCancel={() => {
          if (!isDeleting) {
            setDeletingProject(undefined);
          }
        }}
        onConfirm={() => {
          if (!isDeleting) {
            void deleteProject();
          }
        }}
      />

      <BasicAuthDialog
        open={
          browserStatus.state === "waiting_for_basic_auth" &&
          browserStatus.basicAuthChallenge !== undefined
        }
        {...(browserStatus.basicAuthChallenge === undefined
          ? {}
          : { challenge: browserStatus.basicAuthChallenge })}
        isSubmitting={isSubmittingBasicAuth}
        onCancel={() => {
          void cancelBasicAuth();
        }}
        onSubmit={submitBasicAuth}
      />
    </section>
  );
};

const ProjectOverviewPanel = ({
  api,
  browserStatus,
  onProjectUpdated,
  overview,
}: {
  api: SemanticAppApi;
  browserStatus: BrowserManagerStatus;
  onProjectUpdated: (overview: ProjectOverview) => void;
  overview: ProjectOverview;
}) => {
  const { project, statistics } = overview;
  const cards = [
    { label: "Pagini analizate", value: statistics.pageCount },
    { label: "Teste", value: statistics.testCount },
    { label: "Rulări", value: statistics.runCount },
  ];

  return (
    <article className="rounded-2xl border border-app-border bg-app-surface p-6 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
            Proiect deschis
          </p>
          <h3 className="mt-2 text-2xl font-semibold">{project.name}</h3>
          <a
            className="mt-2 block break-all text-sm text-brand-700 underline decoration-brand-200 underline-offset-4"
            href={project.normalizedBaseUrl}
            target="_blank"
            rel="noreferrer"
          >
            {project.normalizedBaseUrl}
          </a>
        </div>
        <span className="inline-flex rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
          Local
        </span>
      </div>

      <div className="mt-6 grid grid-cols-3 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="rounded-xl border border-app-border bg-app-canvas p-4"
          >
            <p className="text-2xl font-semibold">{card.value}</p>
            <p className="mt-1 text-xs text-app-muted">{card.label}</p>
          </div>
        ))}
      </div>

      <dl className="mt-6 divide-y divide-app-border rounded-xl border border-app-border px-4">
        <OverviewRow
          label="Browser"
          value={project.browserConfig.browserType}
        />
        <OverviewRow
          label="Sesiune"
          value={project.browserConfig.sessionMode}
        />
        <OverviewRow
          label="Ultima rulare"
          value={formatDate(statistics.lastRunAt)}
        />
        <OverviewRow
          label="Status browser"
          value={formatBrowserStatus(browserStatus, project.id)}
        />
        <OverviewRow label="Conexiuni" value="Neconfigurate" />
      </dl>

      <BrowserSelector
        api={api}
        browserStatus={browserStatus}
        onProjectUpdated={onProjectUpdated}
        project={project}
      />
    </article>
  );
};

const formatBrowserStatus = (
  status: BrowserManagerStatus,
  projectId: string,
): string => {
  const isActive = [
    "starting",
    "running",
    "reconnecting",
    "waiting_for_basic_auth",
  ].includes(status.state);

  if (isActive && status.projectId !== projectId) {
    return "Activ în alt proiect";
  }

  switch (status.state) {
    case "starting":
      return "Se pornește";
    case "running":
      return status.browser ? `Pornit · ${status.browser}` : "Pornit";
    case "reconnecting":
      return "Se reconectează";
    case "waiting_for_basic_auth":
      return "Așteaptă autentificarea";
    case "closed":
      return "Închis";
    case "failed":
      return "Eroare";
    default:
      return "Nepornit";
  }
};

const OverviewRow = ({ label, value }: { label: string; value: string }) => (
  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4 py-3 text-sm">
    <dt className="text-app-muted">{label}</dt>
    <dd className="truncate text-right font-medium text-app-ink">{value}</dd>
  </div>
);
