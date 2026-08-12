import { useState } from "react";

import type { TestImportPreview } from "../shared/import-export.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

export interface TestImportModalProps {
  api: SemanticAppApi;
  projectId: string;
  onImported: (test: TestDefinition) => void;
}

export const TestImportModal = ({
  api,
  onImported,
  projectId,
}: TestImportModalProps) => {
  const [preview, setPreview] = useState<TestImportPreview>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const selectFile = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    try {
      setPreview(await api.previewTestImport(projectId));
    } catch {
      setError("Fișierul JSON nu a putut fi citit.");
    } finally {
      setBusy(false);
    }
  };

  const confirm = async (): Promise<void> => {
    if (preview?.previewId === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      const imported = await api.confirmTestImport(
        projectId,
        preview.previewId,
      );
      setPreview(undefined);
      onImported(imported.test);
    } catch {
      setError("Importul nu a putut fi confirmat.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button
        variant="secondary"
        disabled={busy}
        onClick={() => void selectFile()}
      >
        {busy && preview === undefined ? "Se citește..." : "Importă JSON"}
      </Button>
      {error && preview === undefined ? (
        <p className="mt-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      <Modal
        open={preview !== undefined}
        title="Preview import JSON"
        size="wide"
        onClose={() => {
          if (!busy) setPreview(undefined);
        }}
      >
        {preview !== undefined ? (
          <div className="grid gap-4">
            <div className="rounded-lg border border-app-border bg-slate-50 px-4 py-3">
              <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                Fișier selectat
              </p>
              <strong className="mt-1 block break-all text-app-ink">
                {preview.fileName}
              </strong>
            </div>
            {preview.valid && preview.test !== undefined ? (
              <>
                <dl className="grid gap-3 rounded-xl border border-app-border bg-slate-50 p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-app-muted">Test</dt>
                    <dd className="font-semibold text-app-ink">
                      {preview.test.name}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-app-muted">Pași</dt>
                    <dd className="font-semibold text-app-ink">
                      {preview.test.flowItemCount}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-app-muted">Tip</dt>
                    <dd className="font-semibold text-app-ink">
                      {preview.test.testMode === "dynamic_ai"
                        ? "Dinamic AI"
                        : "Înregistrat"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-app-muted">URL start</dt>
                    <dd className="break-all font-semibold text-app-ink">
                      {preview.test.startUrl}
                    </dd>
                  </div>
                </dl>
                <section>
                  <h3 className="font-semibold text-app-ink">
                    Datasets ({preview.datasets.length})
                  </h3>
                  {preview.datasets.length === 0 ? (
                    <p className="mt-1">Exportul nu conține datasets.</p>
                  ) : (
                    <ul className="mt-2 grid gap-2">
                      {preview.datasets.map((dataset, index) => (
                        <li
                          key={`${dataset.name}-${index}`}
                          className="rounded-lg border border-app-border px-3 py-2"
                        >
                          <strong>{dataset.name}</strong> · {dataset.valueCount}{" "}
                          valori
                        </li>
                      ))}
                    </ul>
                  )}
                </section>
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
                  Importul creează numai testul și dataset-urile afișate. Nu
                  modifică proiectul, browserul, conexiunile și nu execută
                  testul.
                </p>
              </>
            ) : (
              <section className="rounded-xl border border-red-200 bg-red-50 p-4">
                <h3 className="font-semibold text-red-900">
                  Fișierul nu poate fi importat
                </h3>
                <ul className="mt-2 grid gap-2 text-red-800">
                  {preview.issues.map((validationIssue, index) => (
                    <li key={`${validationIssue.path}-${index}`}>
                      <code>{validationIssue.path}</code> ·{" "}
                      {validationIssue.message}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {error ? (
              <p className="text-red-700" role="alert">
                {error}
              </p>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setPreview(undefined)}
              >
                Anulează
              </Button>
              <Button
                disabled={!preview.valid || busy}
                onClick={() => void confirm()}
              >
                {busy ? "Se importă..." : "Confirmă importul"}
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
};
