import { useEffect, useMemo, useState } from "react";

import type {
  AiGenerationResult,
  AiModelInfo,
  AiProviderId,
  AiRequestPreview,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { JsonValue } from "../shared/persistence.js";
import { toDeclarativeTestDefinition } from "../shared/test-editor.js";
import type { CheckStep, TestFlowItem } from "../shared/test-model.js";
import { validateDeclarativeTest } from "../shared/test-validation.js";
import { Button } from "./components/Button.js";
import { AiModelPricingPanel } from "./components/AiModelPricingPanel.js";
import { Modal } from "./components/Modal.js";

interface AiStepCreatorModalProps {
  api: SemanticAppApi;
  open: boolean;
  test: TestDefinition;
  items: TestFlowItem[];
  stepId: string;
  stepType: "action" | "check";
  onAdd: (step: TestFlowItem) => void;
  onClose: () => void;
}

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";
const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Generarea pasului a eșuat.";

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

const proposedStep = (
  result: AiGenerationResult | undefined,
): TestFlowItem | undefined => {
  const output = result?.output;
  if (
    typeof output !== "object" ||
    output === null ||
    Array.isArray(output) ||
    typeof output.step !== "object" ||
    output.step === null ||
    Array.isArray(output.step)
  ) {
    return undefined;
  }
  return output.step as unknown as TestFlowItem;
};

const explicitTextsFrom = (instruction: string): string[] => {
  const quoted = [
    ...instruction.matchAll(/["“«]([^"”»\r\n]{2,200})["”»]/g),
  ].flatMap((match) => (match[1]?.trim() ? [match[1].trim()] : []));
  const labeled = [
    ...instruction.matchAll(
      /(?:textul|mesajul|eroarea)(?:\s+exact(?:ă|a)?)?\s*[-:=]?\s+(?!(?:care|pentru|despre|de|sau|ori|ce)\b)([^,.!?;\r\n]{2,120})/giu,
    ),
  ].flatMap((match) => (match[1]?.trim() ? [match[1].trim()] : []));
  return [...new Set([...quoted, ...labeled])].slice(0, 20);
};

const needsAdaptiveCheck = (step: CheckStep): boolean =>
  step.checkType === "visual" ||
  (step.checkType === "js_eval" &&
    "jsSnippet" in step.config &&
    /document\s*\.\s*body[\s\S]{0,120}innerText/i.test(step.config.jsSnippet));

const normalizeCreatedStep = (
  step: TestFlowItem,
  instruction: string,
): TestFlowItem => {
  if (step.type !== "check" || !needsAdaptiveCheck(step)) return step;
  return {
    ...step,
    checkType: "adaptive",
    config: {
      strategy: "auto",
      expectedTexts: explicitTextsFrom(instruction),
      matchMode: "any",
      caseSensitive: false,
      ignoreDiacritics: true,
      visualPrompt: step.humanDescription.trim() || step.title,
      visualFallback: true,
      minimumConfidence: 0.6,
    },
  };
};

export const AiStepCreatorModal = ({
  api,
  items,
  onAdd,
  onClose,
  open,
  stepId,
  stepType,
  test,
}: AiStepCreatorModalProps) => {
  const [instruction, setInstruction] = useState("");
  const [targetSelector, setTargetSelector] = useState("");
  const [provider, setProvider] = useState<AiProviderId>("none");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [preview, setPreview] = useState<AiRequestPreview>();
  const [result, setResult] = useState<AiGenerationResult>();
  const [busy, setBusy] = useState<
    "settings" | "models" | "preview" | "send"
  >();
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    setInstruction("");
    setTargetSelector("");
    setPreview(undefined);
    setResult(undefined);
    setError(undefined);
    setBusy("settings");
    void api
      .getAiSettings()
      .then(async (settings) => {
        setProvider(settings.provider);
        setModel(configuredModel(settings.provider, settings));
        if (settings.provider !== "none") {
          setModels(await api.listAiModels(settings.provider));
        }
      })
      .catch((reason: unknown) => setError(errorMessage(reason)))
      .finally(() => setBusy(undefined));
  }, [api, open, stepId]);

  const requestInput = useMemo(
    () => ({
      task: "create_step" as const,
      provider,
      model,
      context: JSON.parse(
        JSON.stringify({
          userInstruction: instruction.trim(),
          desiredStepType: stepType,
          targetSelector:
            targetSelector.trim().length > 0
              ? targetSelector.trim()
              : undefined,
          stepId,
          test: {
            id: test.id,
            name: test.name,
            description: test.description ?? "",
            startUrl: test.startUrl,
            testMode: test.testMode,
          },
          previousSteps: items.slice(-5),
          constraints: {
            allowedCheckTypes: [
              "element",
              "text",
              "url",
              "js_eval",
              "visual",
              "adaptive",
            ],
            defaultCheckTimeoutMs: 5000,
            requireExplicitCheckCondition: true,
            adaptiveCheckRule:
              "Folosește adaptive: mesajele concrete merg în expectedTexts; fără mesaje concrete lista rămâne goală și runnerul folosește imaginea.",
          },
        }),
      ) as JsonValue,
    }),
    [
      instruction,
      targetSelector,
      items,
      model,
      provider,
      stepId,
      stepType,
      test,
    ],
  );

  const loadModels = async (
    nextProvider: AiProviderId = provider,
    refresh = true,
  ): Promise<void> => {
    if (nextProvider === "none") {
      setModels([]);
      setModel("");
      return;
    }
    setBusy("models");
    setError(undefined);
    try {
      const loaded = await api.listAiModels(nextProvider, refresh);
      setModels(loaded);
      setModel((current) =>
        loaded.some(({ id }) => id === current)
          ? current
          : (loaded[0]?.id ?? current),
      );
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
    console.log("[AI] Creare preview request...", requestInput);
    try {
      const previewData = await api.previewAiRequest(requestInput);
      console.log("[AI] Preview generat cu succes.", previewData);
      setPreview(previewData);
    } catch (reason) {
      console.error("[AI Error] Eroare la preview:", reason);
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const send = async (): Promise<void> => {
    setBusy("send");
    setError(undefined);
    console.log(
      "[AI] Se trimite request-ul către provider-ul",
      requestInput.provider,
      "...",
      requestInput,
    );
    try {
      const generated = await api.generateAiRequest(requestInput);
      console.log("[AI] Răspuns primit de la AI:", generated);
      const rawStep = proposedStep(generated);
      const step =
        rawStep === undefined
          ? undefined
          : normalizeCreatedStep(rawStep, instruction);
      if (step === undefined || step.id !== stepId || step.type !== stepType) {
        console.error("[AI Error] Pas invalid returnat:", generated);
        throw new Error(
          "AI nu a returnat pasul solicitat cu tipul și ID-ul rezervat.",
        );
      }
      const validation = validateDeclarativeTest(
        toDeclarativeTestDefinition(test, [...items, step]),
      );
      if (!validation.valid) {
        console.error(
          "[AI Error] Pasul generat nu a trecut de schema de validare:",
          validation.issues,
          step,
        );
        throw new Error(
          `Pasul AI nu este valid: ${validation.issues
            .slice(0, 4)
            .map((issue) => `${issue.path}: ${issue.message}`)
            .join(" · ")}`,
        );
      }
      const output = generated.output as Record<string, JsonValue>;
      setResult({
        ...generated,
        output: { ...output, step: step as unknown as JsonValue },
      });
    } catch (reason) {
      console.error("[AI Error] Eroare la generare pas:", reason);
      setError(errorMessage(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const step = proposedStep(result);
  return (
    <Modal open={open} title="Adaugă pas cu AI" size="wide" onClose={onClose}>
      <div className="grid gap-4">
        <p className="rounded-lg border border-brand-200 bg-brand-50 p-3 text-sm text-brand-900">
          Descrie rezultatul dorit. AI primește regulile declarative, contextul
          pașilor anteriori și schema strictă pentru{" "}
          {stepType === "check" ? "verificare" : "acțiune"}.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className={labelClass}>
            Provider
            <select
              className={fieldClass}
              value={provider}
              disabled={busy !== undefined}
              onChange={(event) => {
                const next = event.target.value as AiProviderId;
                setProvider(next);
                setModel("");
                setModels([]);
                setPreview(undefined);
                setResult(undefined);
                void loadModels(next, false);
              }}
            >
              <option value="none">Dezactivat</option>
              <option value="gemini">Gemini</option>
              <option value="openai">OpenAI</option>
              <option value="lm_studio">LM Studio</option>
              <option value="ollama">Ollama</option>
            </select>
          </label>
          <label className={labelClass}>
            Model
            <select
              className={fieldClass}
              value={model}
              disabled={
                provider === "none" || busy === "settings" || busy === "models"
              }
              onChange={(event) => {
                setModel(event.target.value);
                setPreview(undefined);
                setResult(undefined);
              }}
            >
              {model.length > 0 && !models.some(({ id }) => id === model) ? (
                <option value={model}>{model} · salvat implicit</option>
              ) : null}
              {models.length === 0 && model.length === 0 ? (
                <option value="">Niciun model încărcat</option>
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
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            disabled={provider === "none" || busy !== undefined}
            onClick={() => void loadModels()}
          >
            {busy === "models" ? "Se încarcă…" : "Reîncarcă modelele"}
          </Button>
          <span className="text-xs text-app-muted">
            Selectează modelul folosit numai pentru generarea acestui pas.
          </span>
        </div>
        <label className={labelClass}>
          Descrierea pasului
          <textarea
            className={`${fieldClass} min-h-28`}
            value={instruction}
            placeholder={
              stepType === "check"
                ? "Ex.: Așteaptă maximum 10 secunde ca mesajul de succes să conțină textul «Salvat»."
                : "Ex.: Apasă butonul Salvează identificat prin data-testid save-button."
            }
            onChange={(event) => {
              setInstruction(event.target.value);
              setPreview(undefined);
              setResult(undefined);
            }}
          />
        </label>
        <label className={labelClass}>
          Target (Selector CSS - Opțional)
          <input
            type="text"
            className={fieldClass}
            value={targetSelector}
            placeholder="Ex.: #success-message, .alert-box, button[type='submit']"
            onChange={(event) => {
              setTargetSelector(event.target.value);
              setPreview(undefined);
              setResult(undefined);
            }}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={
              busy !== undefined ||
              provider === "none" ||
              model.trim().length === 0 ||
              instruction.trim().length === 0
            }
            onClick={() => void createPreview()}
          >
            {busy === "preview" ? "Se pregătește…" : "1. Preview request"}
          </Button>
          <Button
            disabled={preview === undefined || busy !== undefined}
            onClick={() => void send()}
          >
            {busy === "send"
              ? "⏳ Se generează (poate dura 10-30s)..."
              : "2. Trimite la AI"}
          </Button>
        </div>
        {preview ? (
          <details className="rounded-lg border border-app-border p-3">
            <summary className="cursor-pointer text-sm font-semibold">
              Context și schemă trimise · aproximativ{" "}
              {preview.estimatedInputTokens} tokeni
            </summary>
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(
                {
                  systemInstruction: preview.systemInstruction,
                  prompt: preview.prompt,
                  outputSchema: preview.outputSchema,
                },
                null,
                2,
              )}
            </pre>
          </details>
        ) : null}
        {step ? (
          <section className="rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <h4 className="font-semibold text-emerald-900">
              Propunere validată
            </h4>
            <p className="mt-1 text-sm text-emerald-800">
              {"title" in step ? step.title : step.id}
            </p>
            <pre className="mt-3 max-h-72 overflow-auto rounded bg-slate-950 p-3 text-xs text-slate-100">
              {JSON.stringify(step, null, 2)}
            </pre>
            <Button
              className="mt-3"
              onClick={() => {
                onAdd(step);
                onClose();
              }}
            >
              3. Adaugă pasul propus
            </Button>
          </section>
        ) : null}
        {error ? (
          <p className="text-sm text-red-700" role="alert">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  );
};
