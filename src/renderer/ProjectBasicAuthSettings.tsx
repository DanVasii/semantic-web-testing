import { useEffect, useState, type FormEvent } from "react";

import type { ProjectBasicAuthSettings } from "../shared/browser-manager.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project } from "../shared/persistence.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";

export interface ProjectBasicAuthSettingsProps {
  api: SemanticAppApi;
  project: Project;
}

export const ProjectBasicAuthSettingsPanel = ({
  api,
  project,
}: ProjectBasicAuthSettingsProps) => {
  const [settings, setSettings] = useState<ProjectBasicAuthSettings>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    setError(undefined);
    setSuccessMessage(undefined);
    setPassword("");

    void api
      .getProjectBasicAuth(project.id)
      .then((loadedSettings) => {
        if (!active) return;
        setSettings(loadedSettings);
        setUsername(loadedSettings.username);
      })
      .catch(() => {
        if (active) {
          setError("Configurația HTTP Basic Auth nu a putut fi încărcată.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [api, project.id]);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const trimmedUsername = username.trim();
    if (
      trimmedUsername.length === 0 ||
      (!settings?.configured && password.length === 0)
    ) {
      return;
    }

    setIsSaving(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      const saved = await api.saveProjectBasicAuth(project.id, {
        username: trimmedUsername,
        ...(password.length === 0 ? {} : { password }),
      });
      setSettings(saved);
      setUsername(saved.username);
      setPassword("");
      setSuccessMessage(
        "Credentialele HTTP Basic Auth au fost salvate pentru proiect.",
      );
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Credentialele HTTP Basic Auth nu au putut fi salvate.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    setIsDeleting(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      await api.deleteProjectBasicAuth(project.id);
      const cleared: ProjectBasicAuthSettings = {
        projectId: project.id,
        origin: new URL(project.normalizedBaseUrl).origin,
        username: "",
        configured: false,
      };
      setSettings(cleared);
      setUsername("");
      setPassword("");
      setSuccessMessage(
        "Credentialele HTTP Basic Auth au fost șterse din proiect.",
      );
    } catch {
      setError("Credentialele HTTP Basic Auth nu au putut fi șterse.");
    } finally {
      setIsDeleting(false);
    }
  };

  const isBusy = isLoading || isSaving || isDeleting;
  const needsPassword = !settings?.configured;

  return (
    <section
      className="mt-5 rounded-xl border border-app-border bg-app-surface p-4"
      aria-labelledby={`basic-auth-title-${project.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id={`basic-auth-title-${project.id}`}
            className="font-semibold text-app-ink"
          >
            HTTP Basic Auth
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Salvat pe proiect și folosit automat la deschidere, înregistrare și
            rulare.
          </p>
        </div>
        <span
          className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
            settings?.configured
              ? "bg-emerald-100 text-emerald-800"
              : "bg-slate-100 text-app-muted"
          }`}
        >
          {settings?.configured ? "Configurat" : "Neconfigurat"}
        </span>
      </div>

      <p className="mt-3 break-all rounded-lg bg-app-canvas px-3 py-2 text-xs text-app-muted">
        Origine: {settings?.origin ?? new URL(project.normalizedBaseUrl).origin}
      </p>

      <form
        className="mt-4 grid gap-4"
        onSubmit={(event) => void submit(event)}
      >
        <div className="grid gap-4 md:grid-cols-2">
          <Input
            autoComplete="username"
            label="Username"
            value={username}
            disabled={isBusy}
            maxLength={512}
            onChange={(event) => {
              setUsername(event.target.value);
              setError(undefined);
              setSuccessMessage(undefined);
            }}
          />
          <Input
            autoComplete="new-password"
            label={settings?.configured ? "Parolă nouă (opțional)" : "Parolă"}
            type="password"
            value={password}
            disabled={isBusy}
            maxLength={512}
            hint={
              settings?.configured
                ? "Las-o goală pentru a păstra parola existentă."
                : "Obligatorie la prima salvare."
            }
            onChange={(event) => {
              setPassword(event.target.value);
              setError(undefined);
              setSuccessMessage(undefined);
            }}
          />
        </div>

        <p className="text-xs text-app-muted">
          Parola este criptată prin protecția sistemului de operare și nu este
          expusă interfeței sau exporturilor.
        </p>

        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              isBusy ||
              username.trim().length === 0 ||
              (needsPassword && password.length === 0)
            }
          >
            {isSaving ? "Se salvează..." : "Salvează credentialele"}
          </Button>
          {settings?.configured ? (
            <Button
              variant="danger"
              disabled={isBusy}
              onClick={() => void remove()}
            >
              {isDeleting ? "Se șterg..." : "Șterge credentialele"}
            </Button>
          ) : null}
        </div>
      </form>

      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}
    </section>
  );
};
