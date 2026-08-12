import { useEffect, useMemo, useState } from "react";

import type {
  AiConnectionTestResult,
  AiModelInfo,
  AiProviderId,
  AiRequestPreview,
  AiSettingsSummary,
  AiTask,
  SaveAiSettingsInput,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import { EXTERNAL_AI_TEST_PROMPT } from "../shared/external-ai-prompt.js";
import { ImapSettingsPanel } from "./ImapSettingsPanel.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import { Modal } from "./components/Modal.js";
import { Select } from "./components/Select.js";

export interface AiSettingsModalProps {
  api: SemanticAppApi;
  open: boolean;
  onClose: () => void;
}

const taskOptions = [
  { value: "analyze_step", label: "Analiză pas înregistrat" },
  { value: "generate_test", label: "Generare propunere test" },
  { value: "repair_locator", label: "Reparare locator" },
];

const previewContext = (task: AiTask) => {
  if (task === "analyze_step") {
    return {
      recordedStep: {
        type: "fill",
        target: { role: "textbox", label: "Email client" },
        valueKey: "customer_email",
      },
      semanticPage: {
        url: "https://example.test/checkout",
        relevantElements: [
          { fieldId: "customer_email", role: "textbox", label: "Email client" },
        ],
      },
    };
  }
  if (task === "repair_locator") {
    return {
      failedStep: {
        id: "step-checkout",
        title: "Apasă Finalizează comanda",
        primaryLocator: {
          type: "role",
          role: "button",
          value: "Finalizează comanda",
        },
      },
      currentRelevantElements: [
        {
          role: "button",
          accessibleName: "Trimite comanda",
          dataAttributes: { "data-testid": "submit-order" },
        },
      ],
    };
  }
  return {
    testName: "Checkout client",
    recordedEvents: [
      { type: "fill", fieldId: "customer_email" },
      { type: "click", target: "submit_order_button" },
    ],
    relevantPages: [
      {
        url: "https://example.test/checkout",
        interactiveElementCount: 8,
      },
    ],
  };
};

const settingsInput = ({
  apiKey,
  geminiModel,
  ollamaBaseUrl,
  ollamaModel,
  provider,
}: {
  apiKey: string;
  geminiModel: string;
  ollamaBaseUrl: string;
  ollamaModel: string;
  provider: AiProviderId;
}): SaveAiSettingsInput => ({
  provider,
  ollamaBaseUrl,
  ollamaModel,
  geminiModel,
  ...(apiKey.trim().length === 0 ? {} : { geminiApiKey: apiKey.trim() }),
});

export const AiSettingsModal = ({
  api,
  onClose,
  open,
}: AiSettingsModalProps) => {
  const [settings, setSettings] = useState<AiSettingsSummary>();
  const [provider, setProvider] = useState<AiProviderId>("none");
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState("http://127.0.0.1:11434");
  const [ollamaModel, setOllamaModel] = useState("");
  const [geminiModel, setGeminiModel] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<AiModelInfo[]>([]);
  const [connectionResult, setConnectionResult] =
    useState<AiConnectionTestResult>();
  const [task, setTask] = useState<AiTask>("analyze_step");
  const [preview, setPreview] = useState<AiRequestPreview>();
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();
  const [promptCopyMessage, setPromptCopyMessage] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let active = true;
    setIsLoading(true);
    setError(undefined);
    setSuccessMessage(undefined);
    setPromptCopyMessage(undefined);
    setConnectionResult(undefined);
    setPreview(undefined);
    setModels([]);
    setApiKey("");
    void api
      .getAiSettings()
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setProvider(loaded.provider);
        setOllamaBaseUrl(loaded.ollama.baseUrl);
        setOllamaModel(loaded.ollama.model);
        setGeminiModel(loaded.gemini.model);
        if (
          loaded.provider !== "none" &&
          (loaded.provider !== "gemini" || loaded.gemini.apiKeyConfigured)
        ) {
          setIsLoadingModels(true);
          void api
            .listAiModels(loaded.provider)
            .then((loadedModels) => {
              if (active) setModels(loadedModels);
            })
            .catch(() => {
              // Modelul implicit salvat rămâne disponibil dacă refresh-ul eșuează.
            })
            .finally(() => {
              if (active) setIsLoadingModels(false);
            });
        }
      })
      .catch(() => {
        if (active) setError("Setările AI nu au putut fi încărcate.");
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, open]);

  const selectedModel = provider === "ollama" ? ollamaModel : geminiModel;
  const modelOptions = useMemo(() => {
    const entries = [...models];
    if (
      selectedModel.length > 0 &&
      !entries.some(({ id }) => id === selectedModel)
    ) {
      entries.unshift({ id: selectedModel, displayName: selectedModel });
    }
    return [
      {
        value: "",
        label:
          models.length === 0
            ? isLoadingModels
              ? "Modelele se încarcă automat..."
              : "Niciun model încărcat"
            : "Selectează modelul",
      },
      ...entries.map((model) => ({
        value: model.id,
        label:
          model.inputTokenLimit === undefined
            ? model.displayName
            : `${model.displayName} · ${model.inputTokenLimit.toLocaleString("ro-RO")} tokenuri input`,
      })),
    ];
  }, [isLoadingModels, models, selectedModel]);

  const loadModels = async (
    nextProvider: Exclude<AiProviderId, "none">,
  ): Promise<void> => {
    if (nextProvider === "gemini" && !settings?.gemini.apiKeyConfigured) {
      return;
    }
    setIsLoadingModels(true);
    try {
      setModels(await api.listAiModels(nextProvider));
    } catch {
      // Testarea explicită a conexiunii va afișa eroarea completă.
    } finally {
      setIsLoadingModels(false);
    }
  };

  const save = async (
    loadCatalog = true,
  ): Promise<AiSettingsSummary | undefined> => {
    setIsSaving(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      const saved = await api.saveAiSettings(
        settingsInput({
          apiKey,
          geminiModel,
          ollamaBaseUrl,
          ollamaModel,
          provider,
        }),
      );
      setSettings(saved);
      setApiKey("");
      if (loadCatalog && saved.provider !== "none") {
        setModels(await api.listAiModels(saved.provider));
      }
      setSuccessMessage("Setările AI au fost salvate local.");
      return saved;
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Setările AI nu au putut fi salvate.",
      );
      return undefined;
    } finally {
      setIsSaving(false);
    }
  };

  const testConnection = async (): Promise<void> => {
    if (provider === "none") return;
    setIsTesting(true);
    setError(undefined);
    setSuccessMessage(undefined);
    setConnectionResult(undefined);
    try {
      const saved = await save(false);
      if (saved === undefined) return;
      const result = await api.testAiConnection(provider);
      setConnectionResult(result);
      setModels(result.models);
      if (!result.success) setError(result.message);
    } catch {
      setError("Conexiunea AI nu a putut fi testată.");
    } finally {
      setIsTesting(false);
    }
  };

  const removeGeminiKey = async (): Promise<void> => {
    setIsSaving(true);
    setError(undefined);
    setSuccessMessage(undefined);
    try {
      const saved = await api.saveAiSettings({
        provider: provider === "gemini" ? "none" : provider,
        ollamaBaseUrl,
        ollamaModel,
        geminiModel,
        clearGeminiApiKey: true,
      });
      setSettings(saved);
      setProvider(saved.provider);
      setApiKey("");
      setModels([]);
      setConnectionResult(undefined);
      setSuccessMessage("Cheia Gemini API a fost ștearsă.");
    } catch {
      setError("Cheia Gemini API nu a putut fi ștearsă.");
    } finally {
      setIsSaving(false);
    }
  };

  const createPreview = async (): Promise<void> => {
    setIsPreviewing(true);
    setError(undefined);
    try {
      setPreview(
        await api.previewAiRequest({
          task,
          context: previewContext(task),
          provider,
          model: selectedModel,
        }),
      );
    } catch {
      setError("Preview-ul requestului AI nu a putut fi generat.");
    } finally {
      setIsPreviewing(false);
    }
  };

  const isBusy =
    isLoading || isSaving || isTesting || isLoadingModels || isPreviewing;
  const geminiNeedsKey =
    provider === "gemini" &&
    !settings?.gemini.apiKeyConfigured &&
    apiKey.trim().length === 0;

  const copyExternalAiPrompt = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("Clipboard indisponibil");
      }
      await navigator.clipboard.writeText(EXTERNAL_AI_TEST_PROMPT);
      setPromptCopyMessage("Prompt copiat. Îl poți lipi în orice alt AI.");
    } catch {
      setPromptCopyMessage(
        "Copierea automată nu este disponibilă. Selectează textul manual.",
      );
    }
  };

  return (
    <Modal open={open} title="Setări aplicație" size="wide" onClose={onClose}>
      <div className="grid gap-6">
        <section
          className="rounded-xl border border-app-border bg-app-canvas p-4"
          aria-labelledby="ai-settings-title"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 id="ai-settings-title" className="font-semibold text-app-ink">
                Provider AI
              </h3>
              <p className="mt-1 text-sm text-app-muted">
                Catalogul de modele se încarcă automat, fără date din teste.
                Datele testului sunt trimise numai după clickul tău explicit.
              </p>
            </div>
            <span className="rounded-full bg-brand-100 px-2.5 py-1 text-xs font-semibold text-brand-800">
              Global în aplicație
            </span>
          </div>

          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <Select
              label="Provider activ"
              value={provider}
              disabled={isBusy}
              options={[
                { value: "none", label: "None · AI dezactivat" },
                { value: "ollama", label: "Ollama" },
                { value: "gemini", label: "Gemini API" },
              ]}
              onChange={(event) => {
                const nextProvider = event.target.value as AiProviderId;
                setProvider(nextProvider);
                setModels([]);
                setConnectionResult(undefined);
                setPreview(undefined);
                if (nextProvider !== "none") void loadModels(nextProvider);
              }}
            />
            {provider === "none" ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                Aplicația și testele statice funcționează complet fără AI.
              </div>
            ) : null}
          </div>

          {provider === "ollama" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Input
                label="URL Ollama"
                value={ollamaBaseUrl}
                disabled={isBusy}
                placeholder="http://127.0.0.1:11434"
                onChange={(event) => setOllamaBaseUrl(event.target.value)}
              />
              <Select
                label="Model implicit Ollama"
                value={ollamaModel}
                disabled={isBusy}
                options={modelOptions}
                onChange={(event) => setOllamaModel(event.target.value)}
              />
            </div>
          ) : null}

          {provider === "gemini" ? (
            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <Input
                label={
                  settings?.gemini.apiKeyConfigured
                    ? "Cheie Gemini API nouă (opțional)"
                    : "Cheie Gemini API"
                }
                type="password"
                autoComplete="new-password"
                value={apiKey}
                disabled={isBusy}
                hint={
                  settings?.gemini.apiKeyConfigured
                    ? "Cheia existentă este criptată. Lasă gol pentru a o păstra."
                    : "Cheia va fi criptată de sistemul de operare; nu folosim .env."
                }
                onChange={(event) => setApiKey(event.target.value)}
              />
              <Select
                label="Model implicit Gemini"
                value={geminiModel}
                disabled={isBusy}
                options={modelOptions}
                onChange={(event) => setGeminiModel(event.target.value)}
              />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              disabled={isBusy || geminiNeedsKey}
              onClick={() => void save()}
            >
              {isSaving ? "Se salvează..." : "Salvează setările AI"}
            </Button>
            {provider !== "none" ? (
              <Button
                variant="secondary"
                disabled={isBusy || geminiNeedsKey}
                onClick={() => void testConnection()}
              >
                {isTesting
                  ? "Se testează..."
                  : "Testează conexiunea și reîncarcă modelele"}
              </Button>
            ) : null}
            {settings?.gemini.apiKeyConfigured ? (
              <Button
                variant="danger"
                disabled={isBusy}
                onClick={() => void removeGeminiKey()}
              >
                Șterge cheia Gemini
              </Button>
            ) : null}
          </div>

          {connectionResult?.success ? (
            <p
              role="status"
              className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
            >
              {connectionResult.message} · {connectionResult.latencyMs} ms
            </p>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
            >
              {error}
            </p>
          ) : null}
          {successMessage ? (
            <p role="status" className="mt-3 text-sm text-emerald-700">
              {successMessage}
            </p>
          ) : null}
        </section>

        <section className="rounded-xl border border-app-border p-4">
          <h3 className="font-semibold text-app-ink">Preview request AI</h3>
          <p className="mt-1 text-sm text-app-muted">
            Preview local pentru R7–R14: prompt, context limitat, schema strictă
            și estimarea tokenurilor. Generarea preview-ului nu apelează
            providerul.
          </p>
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-64 flex-1">
              <Select
                label="Tip analiză"
                value={task}
                disabled={isBusy}
                options={taskOptions}
                onChange={(event) => {
                  setTask(event.target.value as AiTask);
                  setPreview(undefined);
                }}
              />
            </div>
            <Button
              variant="secondary"
              disabled={isBusy}
              onClick={() => void createPreview()}
            >
              {isPreviewing ? "Se generează..." : "Generează preview local"}
            </Button>
          </div>

          {preview ? (
            <div className="mt-4 grid gap-3">
              <dl className="grid gap-3 sm:grid-cols-4">
                <div className="rounded-lg bg-app-canvas p-3">
                  <dt className="text-xs text-app-muted">Provider</dt>
                  <dd className="mt-1 font-semibold">{preview.provider}</dd>
                </div>
                <div className="rounded-lg bg-app-canvas p-3">
                  <dt className="text-xs text-app-muted">Model</dt>
                  <dd className="mt-1 truncate font-semibold">
                    {preview.model || "Neselectat"}
                  </dd>
                </div>
                <div className="rounded-lg bg-app-canvas p-3">
                  <dt className="text-xs text-app-muted">
                    Tokenuri input estimate
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {preview.estimatedInputTokens.toLocaleString("ro-RO")}
                  </dd>
                </div>
                <div className="rounded-lg bg-app-canvas p-3">
                  <dt className="text-xs text-app-muted">Context trimis</dt>
                  <dd className="mt-1 font-semibold">
                    {preview.sentContextBytes.toLocaleString("ro-RO")} bytes
                  </dd>
                </div>
              </dl>
              <p className="text-xs text-app-muted">
                Estimare locală înainte de trimitere. Numărul exact de tokenuri
                input/output va veni din răspunsul providerului.
              </p>
              {preview.omittedPaths.length > 0 ? (
                <p className="text-xs text-amber-800">
                  Câmpuri omise din context: {preview.omittedPaths.join(", ")}
                </p>
              ) : null}
              <details>
                <summary className="cursor-pointer font-semibold text-app-ink">
                  Vezi promptul exact
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {preview.systemInstruction}
                  {"\n\n"}
                  {preview.prompt}
                </pre>
              </details>
              <details>
                <summary className="cursor-pointer font-semibold text-app-ink">
                  Vezi schema strictă de output
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                  {JSON.stringify(preview.outputSchema, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
        </section>

        <section className="rounded-xl border border-app-border bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                Import / export
              </p>
              <h3 className="mt-1 font-semibold text-app-ink">
                Prompt pentru generarea testelor cu alt AI
              </h3>
              <p className="mt-1 max-w-3xl text-sm text-app-muted">
                Copiază instrucțiunile într-un alt model AI, adaugă scenariul
                tău, apoi importă JSON-ul rezultat din secțiunea de teste.
                Promptul descrie structura strictă, locatorii și dataseturile.
              </p>
            </div>
            <Button
              variant="secondary"
              onClick={() => {
                void copyExternalAiPrompt();
              }}
            >
              Copiază promptul
            </Button>
          </div>
          {promptCopyMessage ? (
            <p className="mt-3 text-sm text-brand-700" role="status">
              {promptCopyMessage}
            </p>
          ) : null}
          <details className="mt-4 rounded-lg border border-app-border bg-slate-50 p-3">
            <summary className="cursor-pointer font-semibold text-app-ink">
              Vezi promptul complet
            </summary>
            <textarea
              className="mt-3 min-h-80 w-full resize-y rounded-lg border border-app-border bg-white p-3 font-mono text-xs leading-5 text-app-ink"
              readOnly
              aria-label="Prompt extern pentru generarea testelor"
              value={EXTERNAL_AI_TEST_PROMPT}
              onFocus={(event) => event.currentTarget.select()}
            />
          </details>
        </section>

        <section className="grid gap-3">
          <div className="rounded-xl border border-dashed border-app-border p-4">
            <h3 className="font-semibold text-app-ink">MySQL</h3>
            <p className="mt-1 text-sm text-app-muted">
              Conexiunea MySQL se configurează separat în pagina fiecărui
              proiect.
            </p>
          </div>
        </section>
        <ImapSettingsPanel api={api} />
      </div>
    </Modal>
  );
};
