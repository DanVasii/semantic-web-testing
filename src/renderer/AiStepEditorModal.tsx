import { useEffect, useMemo, useState } from "react";

import type {
  AiModelInfo,
  AiProviderId,
  AiStepEditPreview,
  AiStepEditResult,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { TestFlowItem } from "../shared/test-model.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

interface AiStepEditorModalProps {
  api: SemanticAppApi;
  open: boolean;
  projectId: string;
  test: TestDefinition;
  step: TestFlowItem;
  onClose: () => void;
  onApplied: (test: TestDefinition, aiVersion: number) => void;
}

const aiFieldLabels: Record<string, string> = {
  actionType: "tipul acțiunii",
  title: "titlul",
  humanDescription: "descrierea pasului",
  whyExplanation: "explicația",
  target: "locatorul principal",
  primaryLocator: "locatorul principal",
  fallbacks: "fallback-urile",
  repeat: "numărul de repetări",
  repeatUntil: "condiția de repetare",
  waitAfter: "așteptarea de după pas",
  enabled: "starea pasului",
};

const readableAiValue = (value: unknown): string => {
  if (value === undefined) return "nesetat";
  if (value === null) return "gol";
  if (typeof value === "boolean") return value ? "activ" : "inactiv";
  if (typeof value === "string" || typeof value === "number") {
    return `„${String(value)}”`;
  }
  return "o configurație nouă";
};

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Operația AI a eșuat.";

const configuredModel = (
  provider: AiProviderId,
  settings: Awaited<ReturnType<SemanticAppApi["getAiSettings"]>>,
): string =>
  provider === "gemini"
    ? settings.gemini.model
    : provider === "ollama"
      ? settings.ollama.model
      : "";

export const AiStepEditorModal = ({
  api,
  onApplied,
  onClose,
  open,
  projectId,
  step,
  test,
}: AiStepEditorModalProps) => {
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<AiProviderId>("none");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [preview, setPreview] = useState<AiStepEditPreview>();
  const [result, setResult] = useState<AiStepEditResult>();
  const [approvedDownstream, setApprovedDownstream] = useState<Set<string>>(
    new Set(),
  );
  const [busy, setBusy] = useState<
    "settings" | "models" | "preview" | "send" | "apply"
  >();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setModels([]);
    setPreview(undefined);
    setResult(undefined);
    setApprovedDownstream(new Set());
    setError(undefined);
    setBusy("settings");
    void api
      .getAiSettings()
      .then((settings) => {
        setProvider(settings.provider);
        setModel(configuredModel(settings.provider, settings));
        if (settings.provider !== "none") {
          void api
            .listAiModels(settings.provider)
            .then(setModels)
            .catch((loadError: unknown) => {
              setError(errorMessage(loadError));
            });
        }
      })
      .catch((loadError: unknown) => {
        setError(errorMessage(loadError));
      })
      .finally(() => {
        setBusy(undefined);
      });
  }, [api, open, step.id]);

  const input = useMemo(
    () => ({
      projectId,
      testId: test.id,
      selectedStepId: step.id,
      instruction,
      provider,
      model,
    }),
    [instruction, model, projectId, provider, step.id, test.id],
  );

  const invalidateProposal = (): void => {
    setPreview(undefined);
    setResult(undefined);
    setApprovedDownstream(new Set());
    setError(undefined);
  };

  const loadModels = async (
    nextProvider: AiProviderId = provider,
    refresh = true,
  ): Promise<void> => {
    if (nextProvider === "none") return;
    setBusy("models");
    setError(undefined);
    try {
      const loadedModels = await api.listAiModels(nextProvider, refresh);
      setModels(loadedModels);
      setModel((current) =>
        current.length > 0 ? current : (loadedModels[0]?.id ?? ""),
      );
    } catch (loadError) {
      setError(errorMessage(loadError));
    } finally {
      setBusy(undefined);
    }
  };

  const createPreview = async (): Promise<void> => {
    setBusy("preview");
    setError(undefined);
    setResult(undefined);
    try {
      setPreview(await api.previewAiStepEdit(input));
    } catch (previewError) {
      setError(errorMessage(previewError));
    } finally {
      setBusy(undefined);
    }
  };

  const send = async (): Promise<void> => {
    setBusy("send");
    setError(undefined);
    try {
      const generated = await api.generateAiStepEdit(input);
      setResult(generated);
      setApprovedDownstream(new Set());
    } catch (sendError) {
      setError(errorMessage(sendError));
    } finally {
      setBusy(undefined);
    }
  };

  const apply = async (includeApprovedDownstream: boolean): Promise<void> => {
    if (result === undefined) return;
    setBusy("apply");
    setError(undefined);
    try {
      const applied = await api.applyAiStepChanges({
        projectId,
        testId: test.id,
        baseVersion: test.version,
        selectedStepId: step.id,
        proposal: result.proposal,
        approvedDownstreamStepIds: includeApprovedDownstream
          ? [...approvedDownstream]
          : [],
      });
      onApplied(applied.test, applied.aiVersion);
      onClose();
    } catch (applyError) {
      setError(errorMessage(applyError));
    } finally {
      setBusy(undefined);
    }
  };

  const currentDiffs =
    result?.diffs.filter((diff) => diff.stepId === step.id) ?? [];

  return (
    <Modal
      open={open}
      title={`Asistent AI · ${"title" in step ? (step.title ?? step.id) : step.id}`}
      size="wide"
      onClose={onClose}
    >
      <div className="grid gap-4">
        <p className="rounded-lg border border-app-border bg-app-canvas p-3 text-sm">
          Contextul este pregătit local. Nimic nu se trimite până nu apeși
          explicit „Trimite la AI”.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Provider
            <select
              className={fieldClass}
              value={provider}
              disabled={busy !== undefined}
              onChange={(event) => {
                const nextProvider = event.target.value as AiProviderId;
                setProvider(nextProvider);
                setModel("");
                setModels([]);
                invalidateProposal();
                if (nextProvider !== "none") {
                  void loadModels(nextProvider, false);
                }
              }}
            >
              <option value="none">None</option>
              <option value="gemini">Gemini</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label className={labelClass}>
            Model pentru această cerere
            {models.length > 0 ? (
              <select
                className={fieldClass}
                value={model}
                onChange={(event) => {
                  setModel(event.target.value);
                  invalidateProposal();
                }}
              >
                {model.length > 0 && !models.some(({ id }) => id === model) ? (
                  <option value={model}>{model} · salvat implicit</option>
                ) : null}
                {models.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.displayName}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className={fieldClass}
                value={model}
                placeholder="Selectează sau introdu modelul"
                onChange={(event) => {
                  setModel(event.target.value);
                  invalidateProposal();
                }}
              />
            )}
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={provider === "none" || busy !== undefined}
            onClick={() => void loadModels()}
          >
            {busy === "models" ? "Se încarcă..." : "Reîncarcă modelele"}
          </Button>
          <span className="text-xs text-app-muted">
            Lista este preîncărcată și nu conține datele testului.
          </span>
        </div>

        <label className={labelClass}>
          Ce vrei să schimbe AI la acest pas?
          <textarea
            className={`${fieldClass} min-h-28`}
            value={instruction}
            placeholder="Ex.: Clarifică faptul că se selectează ziua disponibilă din luna și anul alese."
            onChange={(event) => {
              setInstruction(event.target.value);
              invalidateProposal();
            }}
          />
        </label>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={
              instruction.trim().length === 0 ||
              model.trim().length === 0 ||
              busy !== undefined
            }
            onClick={() => void createPreview()}
          >
            {busy === "preview" ? "Se pregătește..." : "1. Generează preview"}
          </Button>
          <Button
            disabled={
              preview === undefined || provider === "none" || busy !== undefined
            }
            onClick={() => void send()}
          >
            {busy === "send" ? "Se analizează..." : "2. Trimite la AI"}
          </Button>
        </div>

        {provider === "none" ? (
          <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            Providerul AI este dezactivat. Poți inspecta preview-ul după ce
            alegi Gemini sau Ollama și un model.
          </p>
        ) : null}

        {error ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        {preview ? (
          <section className="rounded-xl border border-app-border bg-app-canvas p-4">
            <h3 className="text-sm font-semibold">Request preview · local</h3>
            <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-3">
              <div>
                <dt className="text-app-muted">Provider / model</dt>
                <dd className="font-semibold">
                  {preview.request.provider} · {preview.request.model}
                </dd>
              </div>
              <div>
                <dt className="text-app-muted">Tokeni estimați</dt>
                <dd className="font-semibold">
                  {preview.request.estimatedInputTokens}
                </dd>
              </div>
              <div>
                <dt className="text-app-muted">Context trimis</dt>
                <dd className="font-semibold">
                  {preview.request.sentContextBytes} bytes
                </dd>
              </div>
            </dl>
            <p className="mt-3 text-xs text-app-muted">
              Pași anteriori: {preview.context.previousStepIds.length} · pași
              următori: {preview.context.nextStepIds.length} · pagini analizate:{" "}
              {preview.context.pageIds.length}
            </p>
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold">
                Vezi exact contextul și promptul
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(
                  {
                    context: preview.request.contextPreview,
                    omittedPaths: preview.request.omittedPaths,
                    prompt: preview.request.prompt,
                    outputSchema: preview.request.outputSchema,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </section>
        ) : null}

        {result ? (
          <section className="rounded-xl border border-brand-200 bg-brand-50 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold">Propunere AI · neaplicată</h3>
                <p className="mt-1 text-sm">{result.proposal.summary}</p>
              </div>
              <span className="rounded-full bg-app-surface px-3 py-1 text-xs font-semibold">
                {result.usage.totalTokens} tokeni total ·{" "}
                {result.usage.inputTokens} input · {result.usage.outputTokens}{" "}
                output
              </span>
            </div>

            <div className="mt-4 rounded-lg border border-brand-200 bg-app-surface p-3">
              <p className="text-sm font-semibold">Pasul curent</p>
              <p className="mt-1 text-xs text-app-muted">
                {result.proposal.currentStepChange.rationale}
              </p>
              {currentDiffs.length === 0 ? (
                <p className="mt-2 text-xs text-app-muted">
                  Propunerea nu schimbă efectiv câmpurile pasului curent.
                </p>
              ) : (
                <ul className="mt-2 grid gap-2">
                  {currentDiffs.map((diff) => (
                    <li
                      key={`${diff.stepId}-${diff.field}`}
                      className="rounded border border-app-border p-2 text-xs"
                    >
                      <strong>{aiFieldLabels[diff.field] ?? diff.field}</strong>
                      <p className="mt-1 text-app-muted">
                        Schimbă {readableAiValue(diff.before)} în{" "}
                        {readableAiValue(diff.after)}.
                      </p>
                      <details className="mt-2">
                        <summary className="cursor-pointer font-semibold">
                          Compară valorile tehnice
                        </summary>
                        <div className="mt-1 grid gap-1 sm:grid-cols-2">
                          <pre className="overflow-auto rounded bg-red-50 p-2">
                            - {JSON.stringify(diff.before)}
                          </pre>
                          <pre className="overflow-auto rounded bg-emerald-50 p-2">
                            + {JSON.stringify(diff.after)}
                          </pre>
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {result.proposal.downstreamChanges.length > 0 ? (
              <div className="mt-4">
                <h4 className="text-sm font-semibold">
                  Review downstream · aprobă individual
                </h4>
                <ul className="mt-2 grid gap-2">
                  {result.proposal.downstreamChanges.map((change) => {
                    const diffs = result.diffs.filter(
                      (diff) => diff.stepId === change.stepId,
                    );
                    return (
                      <li
                        key={change.stepId}
                        className="rounded-lg border border-brand-200 bg-app-surface p-3"
                      >
                        <label className="flex items-start gap-2 text-sm font-semibold">
                          <input
                            type="checkbox"
                            checked={approvedDownstream.has(change.stepId)}
                            onChange={(event) => {
                              setApprovedDownstream((current) => {
                                const next = new Set(current);
                                if (event.target.checked) {
                                  next.add(change.stepId);
                                } else {
                                  next.delete(change.stepId);
                                }
                                return next;
                              });
                            }}
                          />
                          Pas {change.stepId}
                        </label>
                        <p className="mt-1 text-xs text-app-muted">
                          {change.rationale}
                        </p>
                        <p className="mt-2 text-xs">
                          {diffs.length === 0
                            ? "Nu există diferențe efective pentru acest pas."
                            : `AI propune ${diffs.length} ${
                                diffs.length === 1 ? "modificare" : "modificări"
                              }: ${diffs
                                .map(
                                  ({ field }) => aiFieldLabels[field] ?? field,
                                )
                                .join(", ")}.`}
                        </p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-semibold">
                            Detalii tehnice
                          </summary>
                          <pre className="mt-2 overflow-auto rounded bg-slate-950 p-2 text-xs text-slate-100">
                            {JSON.stringify(diffs, null, 2)}
                          </pre>
                        </details>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-sm text-app-muted">
                AI nu a propus schimbări downstream.
              </p>
            )}

            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold">
                Response preview JSON
              </summary>
              <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                {JSON.stringify(result.proposal, null, 2)}
              </pre>
            </details>

            <div className="mt-4 flex flex-wrap justify-end gap-2">
              <Button
                variant="secondary"
                disabled={currentDiffs.length === 0 || busy !== undefined}
                onClick={() => void apply(false)}
              >
                Aplică doar pasul curent
              </Button>
              <Button
                disabled={
                  (currentDiffs.length === 0 &&
                    approvedDownstream.size === 0) ||
                  busy !== undefined
                }
                onClick={() => void apply(true)}
              >
                {busy === "apply"
                  ? "Se creează versiunea..."
                  : `Aplică aprobările (${(currentDiffs.length > 0 ? 1 : 0) + approvedDownstream.size})`}
              </Button>
            </div>
          </section>
        ) : null}

        <div className="flex justify-end border-t border-app-border pt-4">
          <Button
            variant="secondary"
            disabled={busy !== undefined}
            onClick={onClose}
          >
            Închide
          </Button>
        </div>
      </div>
    </Modal>
  );
};
