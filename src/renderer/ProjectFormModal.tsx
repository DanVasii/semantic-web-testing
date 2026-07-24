import { useEffect, useState, type FormEvent } from "react";

import type { Project } from "../shared/persistence.js";
import {
  hasProjectInputErrors,
  normalizeProjectUrl,
  validateProjectInput,
  type ProjectInput,
  type ProjectInputErrors,
} from "../shared/projects.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import { Modal } from "./components/Modal.js";

export interface ProjectFormModalProps {
  open: boolean;
  project?: Project;
  isSaving: boolean;
  onClose: () => void;
  onSave: (input: ProjectInput) => Promise<void>;
}

export const ProjectFormModal = ({
  isSaving,
  onClose,
  onSave,
  open,
  project,
}: ProjectFormModalProps) => {
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [errors, setErrors] = useState<ProjectInputErrors>({});

  useEffect(() => {
    if (open) {
      setName(project?.name ?? "");
      setBaseUrl(project?.baseUrl ?? "");
      setErrors({});
    }
  }, [open, project]);

  const input = { name, baseUrl };
  let normalizedUrl: string | undefined;

  if (baseUrl.trim().length > 0 && !validateProjectInput(input).baseUrl) {
    normalizedUrl = normalizeProjectUrl(baseUrl);
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const nextErrors = validateProjectInput(input);
    setErrors(nextErrors);

    if (!hasProjectInputErrors(nextErrors)) {
      void onSave(input);
    }
  };

  return (
    <Modal
      open={open}
      title={project ? "Editează proiectul" : "Proiect nou"}
      onClose={onClose}
    >
      <form className="grid gap-5" onSubmit={handleSubmit} noValidate>
        <Input
          autoFocus
          label="Numele proiectului"
          placeholder="Exemplu: Magazin online"
          value={name}
          {...(errors.name ? { error: errors.name } : {})}
          maxLength={101}
          onChange={(event) => {
            setName(event.target.value);
            if (errors.name) {
              setErrors((current) => {
                const next = { ...current };
                delete next.name;
                return next;
              });
            }
          }}
        />
        <Input
          label="URL-ul proiectului"
          placeholder="https://example.com"
          value={baseUrl}
          {...(errors.baseUrl ? { error: errors.baseUrl } : {})}
          hint="Query string-ul și hash-ul sunt eliminate din URL-ul normalizat."
          inputMode="url"
          onChange={(event) => {
            setBaseUrl(event.target.value);
            if (errors.baseUrl) {
              setErrors((current) => {
                const next = { ...current };
                delete next.baseUrl;
                return next;
              });
            }
          }}
        />

        {normalizedUrl ? (
          <div className="rounded-lg border border-brand-100 bg-brand-50 px-3 py-2">
            <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
              URL normalizat
            </p>
            <p className="mt-1 break-all text-sm text-app-ink">
              {normalizedUrl}
            </p>
          </div>
        ) : null}

        <div className="flex justify-end gap-3 border-t border-app-border pt-5">
          <Button variant="secondary" onClick={onClose} disabled={isSaving}>
            Anulează
          </Button>
          <Button type="submit" disabled={isSaving}>
            {isSaving
              ? "Se salvează..."
              : project
                ? "Salvează modificările"
                : "Creează proiectul"}
          </Button>
        </div>
      </form>
    </Modal>
  );
};
