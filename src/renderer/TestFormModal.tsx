import { useEffect, useState } from "react";

import type { Project, TestDefinition } from "../shared/persistence.js";
import {
  hasTestInputErrors,
  type TestInput,
  type TestInputErrors,
  validateTestInput,
} from "../shared/tests.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import { Modal } from "./components/Modal.js";

export interface TestFormModalProps {
  isSaving: boolean;
  open: boolean;
  project: Project;
  test?: TestDefinition;
  onClose: () => void;
  onSave: (input: TestInput) => void;
}

export const TestFormModal = ({
  isSaving,
  onClose,
  onSave,
  open,
  project,
  test,
}: TestFormModalProps) => {
  const [name, setName] = useState(test?.name ?? "");
  const [description, setDescription] = useState(test?.description ?? "");
  const [startUrl, setStartUrl] = useState(
    test?.normalizedStartUrl ?? project.normalizedBaseUrl,
  );
  const [errors, setErrors] = useState<TestInputErrors>({});

  useEffect(() => {
    if (open) {
      setName(test?.name ?? "");
      setDescription(test?.description ?? "");
      setStartUrl(test?.normalizedStartUrl ?? project.normalizedBaseUrl);
      setErrors({});
    }
  }, [
    open,
    project.normalizedBaseUrl,
    test?.description,
    test?.name,
    test?.normalizedStartUrl,
  ]);

  const submit = (): void => {
    const input: TestInput = {
      name,
      ...(description.trim().length === 0 ? {} : { description }),
      startUrl,
    };
    const nextErrors = validateTestInput(input, project);
    setErrors(nextErrors);
    if (!hasTestInputErrors(nextErrors)) {
      onSave(input);
    }
  };

  return (
    <Modal
      open={open}
      title={test === undefined ? "Test nou" : "Editează testul"}
      onClose={onClose}
    >
      <div className="grid gap-4">
        <p>
          Testul începe printr-o înregistrare manuală. URL-ul de start poate fi
          diferit de pagina principală, dar trebuie să aparțină proiectului.
          {test === undefined
            ? ""
            : " Schimbarea lui invalidează înregistrarea existentă."}
        </p>
        <Input
          label="Numele testului"
          value={name}
          {...(errors.name ? { error: errors.name } : {})}
          disabled={isSaving}
          onChange={(event) => {
            setName(event.target.value);
          }}
        />
        <Input
          label="URL de start"
          value={startUrl}
          inputMode="url"
          {...(errors.startUrl ? { error: errors.startUrl } : {})}
          hint="Query string-ul și hash-ul sunt păstrate pentru pornirea testului."
          disabled={isSaving}
          onChange={(event) => {
            setStartUrl(event.target.value);
          }}
        />
        <div className="grid gap-1.5">
          <label
            htmlFor="test-description"
            className="text-sm font-medium text-app-ink"
          >
            Descriere pentru interpretarea flow-ului
          </label>
          <textarea
            id="test-description"
            className={`min-h-24 resize-y rounded-lg border bg-app-surface px-3 py-2 text-sm text-app-ink shadow-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100 ${
              errors.description ? "border-red-500" : "border-app-border"
            }`}
            value={description}
            disabled={isSaving}
            placeholder="Ex.: selectează un produs, adaugă-l în coș și continuă până la checkout."
            onChange={(event) => {
              setDescription(event.target.value);
            }}
          />
          {errors.description ? (
            <p role="alert" className="text-sm text-red-700">
              {errors.description}
            </p>
          ) : (
            <p className="text-sm text-app-muted">
              Vei putea selecta ulterior componente repetitive și câmpuri de
              date.
            </p>
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-app-border pt-4">
          <Button variant="secondary" disabled={isSaving} onClick={onClose}>
            Anulează
          </Button>
          <Button disabled={isSaving} onClick={submit}>
            {isSaving
              ? "Se salvează..."
              : test === undefined
                ? "Creează testul"
                : "Salvează testul"}
          </Button>
        </div>
      </div>
    </Modal>
  );
};
