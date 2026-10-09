import { useEffect, useMemo, useState } from "react";

import type {
  AiModelInfo,
  AiProviderId,
  AiSimilarTestContextMode,
  AiSimilarTestRequestPreview,
  AiSimilarTestResult,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { Button } from "./components/Button.js";
import { AiModelPricingPanel } from "./components/AiModelPricingPanel.js";
import { Modal } from "./components/Modal.js";

interface AiSimilarTestModalProps {
  api: SemanticAppApi;
  open: boolean;
  projectId: string;
  sourceTest: TestDefinition;
  onClose: () => void;
  onCreated: (test: TestDefinition) => void;
}

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Generarea testului a eșuat.";

const configuredModel = (
  provider: AiProviderId,
  settings: Awaited<ReturnType<SemanticAppApi["getAiSettings"]>>,
): string =>
  provider === "gemini"
    ? settings.gemini.model
    : provider === "openai"
      ? settings.openai.model
      : provider === "lm_studio"
        ? settings.lmStudio.model
        : provider === "ollama"
          ? settings.ollama.model
          : "";

const diffTone: Record<AiSimilarTestResult["diffs"][number]["kind"], string> = {
  metadata: "border-sky-200 bg-sky-50",
  dataset_added: "border-violet-200 bg-violet-50",
  step_modified: "border-amber-200 bg-amber-50",
  step_added: "border-emerald-200 bg-emerald-50",
  step_removed: "border-red-200 bg-red-50",
};

const contextModeHelp: Record<AiSimilarTestContextMode, string> = {
  economic:
    "Trimite pașii și dataseturile în format compact, fără analiza paginilor. Potrivit pentru variante bazate pe alte date.",
  balanced:
    "Adaugă numai elementele semantice relevante din maximum trei pagini. Recomandat pentru majoritatea variantelor.",
  full: "Trimite pașii, dataseturile și analiza semantică integrală. Folosește-l când varianta necesită elemente UI greu de identificat.",
};

export const AiSimilarTestModal = ({
  api,
  onClose,
  onCreated,
  open,
  projectId,
  sourceTest,
}: AiSimilarTestModalProps) => {
  const [instruction, setInstruction] = useState("");
  const [provider, setProvider] = useState<AiProviderId>("none");
  const [model, setModel] = useState("");
  const [contextMode, setContextMode] =
    useState<AiSimilarTestContextMode>("balanced");
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [preview, setPreview] = useState<AiSimilarTestRequestPreview>();
  const [result, setResult] = useState<AiSimilarTestResult>();
  const [busy, setBusy] = useState<
    "settings" | "models" | "preview" | "generate" | "create"
  >();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setContextMode("balanced");
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy("settings");
    void api
      .getAiSettings()
      .then(async (settings) => {
        setProvider(settings.provider);
        setModel(configuredModel(settings.provider, settings));
        setModels(
          settings.provider === "none"
            ? []
            : await api.listAiModels(settings.provider),
        );
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(undefined));
  }, [api, open, sourceTest.id]);

  const input = useMemo(
    () => ({
      projectId,
      sourceTestId: sourceTest.id,
      instruction,
      contextMode,
      provider,
      model,
    }),
    [contextMode, instruction, model, projectId, provider, sourceTest.id],
  );

  const invalidate = (): void => {
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
  };

  const loadModels = async (next: AiProviderId): Promise<void> => {
    setProvider(next);
    setModel("");
    setModels([]);
    invalidate();
    if (next === "none") return;
    setBusy("models");
    try {
      const loaded = await api.listAiModels(next);
      setModels(loaded);
      setModel(loaded[0]?.id ?? "");
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const createPreview = async (): Promise<void> => {
    setBusy("preview");
    setError(undefined);
    setResult(undefined);
    try {
      setPreview(await api.previewAiSimilarTest(input));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const generate = async (): Promise<void> => {
    setBusy("generate");
    setError(undefined);
    try {
      setResult(await api.generateAiSimilarTest(input));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const create = async (): Promise<void> => {
    if (result === undefined) return;
    setBusy("create");
    setError(undefined);
    try {
      const created = await api.createAiSimilarTest({
        projectId,
        sourceTestId: sourceTest.id,
        baseVersion: result.baseVersion,
        instruction,
        provider: result.provider,
        model: result.model,
        proposal: result.proposal,
      });
      onCreated(created.test);
      onClose();
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      open={open}
      title={`Generează similar cu AI · ${sourceTest.name}`}
      size="wide"
      onClose={onClose}
    >
      <div className="grid min-w-0 gap-4 overflow-x-hidden">
        {result === undefined ? (
          <>
            <p className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
              Testul original rămâne neschimbat. Varianta este creată numai după
              ce verifici diferențele și confirmi explicit.
            </p>
            <div className="grid min-w-0 gap-3 sm:grid-cols-3">
              <label className={`${labelClass} min-w-0`}>
                Provider
                <select
                  className={fieldClass}
                  value={provider}
                  disabled={busy !== undefined}
                  onChange={(event) =>
                    void loadModels(event.target.value as AiProviderId)
                  }
                >
                  <option value="none">Dezactivat</option>
                  <option value="gemini">Gemini</option>
                  <option value="openai">OpenAI</option>
                  <option value="lm_studio">LM Studio</option>
                  <option value="ollama">Ollama</option>
                </select>
              </label>
              <label className={`${labelClass} min-w-0`}>
                Nivel context
                <select
                  className={fieldClass}
                  value={contextMode}
                  disabled={busy !== undefined}
                  onChange={(event) => {
                    setContextMode(
                      event.target.value as AiSimilarTestContextMode,
                    );
                    invalidate();
                  }}
                >
                  <option value="economic">Economic</option>
                  <option value="balanced">Echilibrat · recomandat</option>
                  <option value="full">Complet</option>
                </select>
                <span className="mt-1 block font-normal leading-relaxed">
                  {contextModeHelp[contextMode]}
                </span>
              </label>
              <label className={`${labelClass} min-w-0`}>
                Model
                <select
                  className={fieldClass}
                  value={model}
                  disabled={provider === "none" || busy !== undefined}
                  onChange={(event) => {
                    setModel(event.target.value);
                    invalidate();
                  }}
                >
                  {model.length > 0 &&
                  !models.some(({ id }) => id === model) ? (
                    <option value={model}>{model} · configurat</option>
                  ) : null}
                  {models.length === 0 ? (
                    <option value="">Niciun model</option>
                  ) : null}
                  {models.map((candidate) => (
                    <option key={candidate.id} value={candidate.id}>
                      {candidate.displayName}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <AiModelPricingPanel api={api} provider={provider} model={model} />
            <label className={labelClass}>
              Cum trebuie să difere testul nou?
              <textarea
                className={`${fieldClass} min-h-32`}
                value={instruction}
                placeholder="Ex.: Creează două dataset-uri, unul cu email invalid și unul fără parolă. După Submit adaugă verificarea mesajului de eroare și păstrează restul pașilor."
                onChange={(event) => {
                  setInstruction(event.target.value);
                  invalidate();
                }}
              />
            </label>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={
                  provider === "none" ||
                  model.trim().length === 0 ||
                  instruction.trim().length === 0 ||
                  busy !== undefined
                }
                onClick={() => void createPreview()}
              >
                {busy === "preview" ? "Se pregătește…" : "1. Preview request"}
              </Button>
              <Button
                disabled={preview === undefined || busy !== undefined}
                onClick={() => void generate()}
              >
                {busy === "generate"
                  ? "Se generează…"
                  : "2. Generează diferențele"}
              </Button>
            </div>
            {preview ? (
              <details className="min-w-0 overflow-hidden rounded-lg border border-app-border p-3">
                <summary className="cursor-pointer break-words text-sm font-semibold">
                  Context {preview.contextMode} · {preview.stepIds.length} pași
                  · {preview.datasetNames.length} dataset-uri · aproximativ{" "}
                  {preview.request.estimatedInputTokens} tokeni
                </summary>
                <dl className="mt-3 grid gap-2 text-xs sm:grid-cols-2 lg:grid-cols-5">
                  {(
                    [
                      ["Instrucțiuni", preview.tokenBreakdown.instructions],
                      ["Test-sursă", preview.tokenBreakdown.sourceTest],
                      ["Dataseturi", preview.tokenBreakdown.datasets],
                      ["Pagini", preview.tokenBreakdown.pageContext],
                      ["Schemă output", preview.tokenBreakdown.outputSchema],
                    ] as const
                  ).map(([label, tokens]) => (
                    <div
                      key={label}
                      className="rounded-lg border border-app-border bg-app-canvas p-2"
                    >
                      <dt className="text-app-muted">{label}</dt>
                      <dd className="font-semibold">~{tokens} tokeni</dd>
                    </div>
                  ))}
                </dl>
                <pre className="mt-3 max-h-72 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto overflow-x-hidden rounded bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(
                    {
                      prompt: preview.request.prompt,
                      context: preview.request.contextPreview,
                      omittedPaths: preview.request.omittedPaths,
                    },
                    null,
                    2,
                  )}
                </pre>
              </details>
            ) : null}
          </>
        ) : null}
        {result ? (
          <section className="min-w-0 overflow-hidden rounded-xl border border-brand-200 bg-brand-50 p-4">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold">Preview diferențe · necreat</h3>
                <p className="mt-1 break-words text-sm">
                  {result.proposal.summary}
                </p>
                <p className="mt-1 break-words text-xs text-app-muted">
                  Nume propus: <strong>{result.proposal.name}</strong>
                </p>
              </div>
              <span className="rounded-full bg-app-surface px-3 py-1 text-xs font-semibold">
                {result.usage.totalTokens} tokeni
              </span>
            </div>
            <div className="mt-4 grid min-w-0 gap-2">
              {result.diffs.map((diff, index) => (
                <article
                  key={`${diff.kind}-${diff.stepId ?? index}-${index}`}
                  className={`min-w-0 overflow-hidden rounded-lg border p-3 ${diffTone[diff.kind]}`}
                >
                  <h4 className="break-words text-sm font-semibold">
                    {diff.label}
                  </h4>
                  {diff.rationale ? (
                    <p className="mt-1 break-words text-xs">{diff.rationale}</p>
                  ) : null}
                  <details className="mt-2">
                    <summary className="cursor-pointer text-xs font-semibold">
                      Vezi înainte / după
                    </summary>
                    <div className="mt-2 grid min-w-0 gap-2 lg:grid-cols-2">
                      {diff.before !== undefined ? (
                        <div className="min-w-0">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
                            Înainte
                          </p>
                          <pre className="max-h-56 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto overflow-x-hidden rounded bg-slate-950 p-3 text-xs text-slate-100">
                            {JSON.stringify(diff.before, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                      {diff.after !== undefined ? (
                        <div className="min-w-0">
                          <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide">
                            După
                          </p>
                          <pre className="max-h-56 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] overflow-y-auto overflow-x-hidden rounded bg-slate-950 p-3 text-xs text-slate-100">
                            {JSON.stringify(diff.after, null, 2)}
                          </pre>
                        </div>
                      ) : null}
                    </div>
                  </details>
                </article>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button
                disabled={busy !== undefined}
                onClick={() => void create()}
              >
                {busy === "create"
                  ? "Se creează…"
                  : "3. Confirmă și creează testul"}
              </Button>
              <Button
                variant="secondary"
                disabled={busy !== undefined}
                onClick={() => setResult(undefined)}
              >
                Modifică promptul
              </Button>
            </div>
          </section>
        ) : null}
        {error ? (
          <p
            className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
          >
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
