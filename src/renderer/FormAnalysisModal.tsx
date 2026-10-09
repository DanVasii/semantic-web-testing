import { useEffect, useMemo, useRef, useState } from "react";

import type {
  AnalyzedForm,
  FormDefaultKey,
  FormTestGenerationResult,
  ProjectFormSettings,
} from "../shared/form-analysis.js";
import type {
  AiModelInfo,
  AiProviderId,
  AiSettingsSummary,
} from "../shared/ai.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import type { ImapAccountSummary } from "../shared/imap.js";
import type { AnalyzedPageSummary } from "../shared/page-analysis.js";
import { AiModelPricingPanel } from "./components/AiModelPricingPanel.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";

export interface FormAnalysisModalProps {
  api: SemanticAppApi;
  open: boolean;
  page?: AnalyzedPageSummary;
  projectId: string;
  onClose: () => void;
  onTestsCreated: () => void;
}

const defaultFields: Array<{ key: FormDefaultKey; label: string }> = [
  { key: "firstName", label: "Prenume" },
  { key: "lastName", label: "Nume" },
  { key: "fullName", label: "Nume complet" },
  { key: "phone", label: "Telefon" },
  { key: "company", label: "Companie" },
  { key: "address", label: "Adresă" },
  { key: "city", label: "Oraș" },
  { key: "county", label: "Județ" },
  { key: "postalCode", label: "Cod poștal" },
  { key: "country", label: "Țară" },
  { key: "password", label: "Parolă de test" },
  { key: "message", label: "Mesaj" },
];

const emptySettings = (projectId: string): ProjectFormSettings => ({
  projectId,
  defaults: {},
});

const semanticLabels: Record<string, string> = {
  first_name: "prenume",
  last_name: "nume",
  full_name: "nume complet",
  email: "e-mail · gestionat prin IMAP",
  phone: "telefon",
  company: "companie",
  address: "adresă",
  city: "oraș",
  county: "județ",
  postal_code: "cod poștal",
  country: "țară",
  password: "parolă",
  message: "mesaj",
  unknown: "necunoscut",
};

const fieldRestrictions = (field: AnalyzedForm["fields"][number]): string[] => [
  ...(field.placeholder === undefined
    ? []
    : [`placeholder: ${field.placeholder}`]),
  ...(field.autocomplete === undefined
    ? []
    : [`autocomplete: ${field.autocomplete}`]),
  ...(field.pattern === undefined ? [] : [`pattern: ${field.pattern}`]),
  ...(field.minLength === undefined
    ? []
    : [`minim ${field.minLength} caractere`]),
  ...(field.maxLength === undefined
    ? []
    : [`maximum ${field.maxLength} caractere`]),
  ...(field.min === undefined ? [] : [`minim: ${field.min}`]),
  ...(field.max === undefined ? [] : [`maxim: ${field.max}`]),
  ...(field.step === undefined ? [] : [`pas: ${field.step}`]),
  ...(field.accept === undefined ? [] : [`fișiere acceptate: ${field.accept}`]),
  ...(field.multiple === true ? ["permite mai multe fișiere"] : []),
  ...(field.options.length === 0
    ? []
    : [`opțiuni: ${field.options.map(({ label }) => label).join(", ")}`]),
];

const configuredModelFor = (
  settings: AiSettingsSummary,
  provider: AiProviderId = settings.provider,
): string =>
  provider === "ollama"
    ? settings.ollama.model
    : provider === "lm_studio"
      ? settings.lmStudio.model
      : provider === "gemini"
        ? settings.gemini.model
        : provider === "openai"
          ? settings.openai.model
          : "";

export const FormAnalysisModal = ({
  api,
  onClose,
  onTestsCreated,
  open,
  page,
  projectId,
}: FormAnalysisModalProps) => {
  const [forms, setForms] = useState<AnalyzedForm[]>([]);
  const [settings, setSettings] = useState<ProjectFormSettings>(
    emptySettings(projectId),
  );
  const [accounts, setAccounts] = useState<ImapAccountSummary[]>([]);
  const [selectedFormId, setSelectedFormId] = useState("");
  const [imapAccountId, setImapAccountId] = useState("");
  const [expectEmail, setExpectEmail] = useState(true);
  const [aiSettings, setAiSettings] = useState<AiSettingsSummary>();
  const [aiProvider, setAiProvider] = useState<AiProviderId>("none");
  const [aiModel, setAiModel] = useState("");
  const [aiModels, setAiModels] = useState<AiModelInfo[]>([]);
  const [loadingAiModels, setLoadingAiModels] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [generation, setGeneration] = useState<FormTestGenerationResult>();
  const [selectedScenarios, setSelectedScenarios] = useState<Set<string>>(
    new Set(),
  );
  const [loading, setLoading] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const modelRequestId = useRef(0);

  useEffect(() => {
    if (!open || page === undefined) return;
    let active = true;
    setLoading(true);
    modelRequestId.current += 1;
    setError(undefined);
    setGeneration(undefined);
    setAiModels([]);
    setLoadingAiModels(false);
    Promise.all([
      api.listAnalyzedPageForms?.(projectId, page.page.id) ??
        Promise.resolve([]),
      api.getProjectFormSettings?.(projectId) ??
        Promise.resolve(emptySettings(projectId)),
      api.listImapAccounts(),
      api.getAiSettings(),
    ])
      .then(
        ([loadedForms, loadedSettings, loadedAccounts, loadedAiSettings]) => {
          if (!active) return;
          setForms(loadedForms);
          setSettings(loadedSettings);
          setAccounts(loadedAccounts);
          setSelectedFormId(loadedForms[0]?.id ?? "");
          setImapAccountId(
            loadedSettings.defaultImapAccountId ?? loadedAccounts[0]?.id ?? "",
          );
          setAiSettings(loadedAiSettings);
          setAiProvider(loadedAiSettings.provider);
          setAiModel(configuredModelFor(loadedAiSettings));
          if (loadedAiSettings.provider !== "none") {
            const requestId = ++modelRequestId.current;
            setLoadingAiModels(true);
            void api
              .listAiModels(loadedAiSettings.provider)
              .then((models) => {
                if (active && requestId === modelRequestId.current) {
                  setAiModels(models);
                }
              })
              .catch(() => {
                // Modelul salvat rămâne selectabil dacă lista nu poate fi încărcată.
              })
              .finally(() => {
                if (active && requestId === modelRequestId.current) {
                  setLoadingAiModels(false);
                }
              });
          }
        },
      )
      .catch((reason: unknown) => {
        if (active)
          setError(
            reason instanceof Error
              ? reason.message
              : "Formularele nu au putut fi încărcate.",
          );
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [api, open, page, projectId]);

  const selectedForm = useMemo(
    () => forms.find(({ id }) => id === selectedFormId),
    [forms, selectedFormId],
  );
  const formHasEmail = selectedForm?.fields.some(
    ({ semanticType }) => semanticType === "email",
  );
  const aiModelOptions = useMemo(() => {
    const available = [...aiModels];
    if (aiModel.length > 0 && !available.some(({ id }) => id === aiModel)) {
      available.unshift({ id: aiModel, displayName: aiModel });
    }
    return available;
  }, [aiModel, aiModels]);

  const reloadAiModels = async (): Promise<void> => {
    if (aiProvider === "none") return;
    const requestId = ++modelRequestId.current;
    setLoadingAiModels(true);
    setError(undefined);
    try {
      const models = await api.listAiModels(aiProvider, true);
      if (requestId === modelRequestId.current) setAiModels(models);
    } catch (reason) {
      if (requestId === modelRequestId.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Lista modelelor AI nu a putut fi actualizată.",
        );
      }
    } finally {
      if (requestId === modelRequestId.current) setLoadingAiModels(false);
    }
  };

  const selectAiProvider = async (provider: AiProviderId): Promise<void> => {
    const requestId = ++modelRequestId.current;
    setAiProvider(provider);
    setAiModels([]);
    setLoadingAiModels(false);
    setGeneration(undefined);
    setError(undefined);
    setAiModel(
      aiSettings === undefined ? "" : configuredModelFor(aiSettings, provider),
    );
    if (provider === "none") return;
    if (provider === "gemini" && aiSettings?.gemini.apiKeyConfigured !== true) {
      setError(
        "Configurează cheia API Gemini în setările AI înainte de generare.",
      );
      return;
    }
    if (
      provider === "openai" &&
      aiSettings?.openai?.apiKeyConfigured !== true
    ) {
      setError("Configurează cheia OpenAI API în setările aplicației.");
      return;
    }
    setLoadingAiModels(true);
    try {
      const models = await api.listAiModels(provider);
      if (requestId === modelRequestId.current) setAiModels(models);
    } catch (reason) {
      if (requestId === modelRequestId.current) {
        setError(
          reason instanceof Error
            ? reason.message
            : "Modelele providerului selectat nu au putut fi încărcate.",
        );
      }
    } finally {
      if (requestId === modelRequestId.current) setLoadingAiModels(false);
    }
  };

  const saveSettings = async (): Promise<void> => {
    if (api.saveProjectFormSettings === undefined) return;
    setSavingSettings(true);
    setError(undefined);
    try {
      const saved = await api.saveProjectFormSettings(projectId, {
        defaults: settings.defaults,
        ...(imapAccountId.length === 0
          ? {}
          : { defaultImapAccountId: imapAccountId }),
      });
      setSettings(saved);
      setMessage("Datele implicite pentru formulare au fost salvate.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Setările nu au putut fi salvate.",
      );
    } finally {
      setSavingSettings(false);
    }
  };

  const generate = async (): Promise<void> => {
    if (
      api.generateFormTests === undefined ||
      page === undefined ||
      selectedForm === undefined
    ) {
      return;
    }
    setGenerating(true);
    setGeneration(undefined);
    setMessage(undefined);
    setError(undefined);
    try {
      const result = await api.generateFormTests({
        projectId,
        pageId: page.page.id,
        formId: selectedForm.id,
        ...(imapAccountId.length === 0 ? {} : { imapAccountId }),
        expectEmail,
        ...(instructions.trim().length === 0
          ? {}
          : { instructions: instructions.trim() }),
        ...(aiProvider === "none" ? {} : { provider: aiProvider }),
        ...(aiModel.trim().length === 0 ? {} : { model: aiModel.trim() }),
      });
      setGeneration(result);
      setSelectedScenarios(new Set(result.scenarios.map(({ id }) => id)));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Testele nu au putut fi generate.",
      );
    } finally {
      setGenerating(false);
    }
  };

  const createTests = async (): Promise<void> => {
    if (
      api.createGeneratedFormTests === undefined ||
      generation === undefined ||
      page === undefined
    ) {
      return;
    }
    setCreating(true);
    setError(undefined);
    try {
      const created = await api.createGeneratedFormTests({
        projectId,
        pageId: page.page.id,
        formId: generation.formId,
        ...(imapAccountId.length === 0 ? {} : { imapAccountId }),
        provider: generation.provider,
        model: generation.model,
        scenarios: generation.scenarios,
        selectedScenarioIds: [...selectedScenarios],
      });
      setMessage(`${created.tests.length} teste au fost create.`);
      setGeneration(undefined);
      onTestsCreated();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Testele nu au putut fi salvate.",
      );
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      open={open}
      title={`Formulare · ${page?.title ?? "Pagină analizată"}`}
      size="wide"
      onClose={() => !generating && !creating && onClose()}
    >
      {loading ? <p role="status">Se citesc formularele…</p> : null}
      {error ? (
        <p className="mb-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="mb-3 text-sm text-emerald-700" role="status">
          {message}
        </p>
      ) : null}

      {!loading && forms.length === 0 ? (
        <p>În ultima analiză nu a fost detectat niciun formular HTML.</p>
      ) : null}

      {forms.length > 0 ? (
        <div className="grid gap-4 lg:grid-cols-[15rem_1fr]">
          <nav
            className="grid content-start gap-2"
            aria-label="Formulare detectate"
          >
            {forms.map((form) => (
              <button
                key={form.id}
                type="button"
                className={`rounded-lg border p-3 text-left ${
                  selectedFormId === form.id
                    ? "border-brand-500 bg-brand-50"
                    : "border-app-border bg-white"
                }`}
                onClick={() => {
                  setSelectedFormId(form.id);
                  setGeneration(undefined);
                }}
              >
                <strong className="block text-sm">{form.title}</strong>
                <span className="text-xs text-app-muted">
                  {form.fields.length} câmpuri · {form.method.toUpperCase()}
                </span>
              </button>
            ))}
          </nav>

          {selectedForm ? (
            <div>
              <div className="rounded-xl border border-app-border p-4">
                <h4 className="font-semibold">{selectedForm.title}</h4>
                <p className="mt-1 break-all text-xs text-app-muted">
                  {selectedForm.action || selectedForm.pageUrl}
                </p>
                <div className="mt-3 grid gap-2">
                  {selectedForm.fields.map((field) => (
                    <div
                      key={field.id}
                      className="grid gap-1 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-[1fr_auto]"
                    >
                      <span>
                        <strong>{field.label}</strong>
                        <span className="ml-2 text-xs text-app-muted">
                          {field.name} · {field.inputType}
                        </span>
                        {fieldRestrictions(field).length > 0 ? (
                          <span className="mt-1 block text-xs text-app-muted">
                            {fieldRestrictions(field).join(" · ")}
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs font-semibold text-brand-700">
                        {semanticLabels[field.semanticType] ??
                          field.semanticType}
                        {field.required ? " · obligatoriu" : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              <details className="mt-4 rounded-xl border border-app-border p-4">
                <summary className="cursor-pointer font-semibold">
                  Date implicite și cont IMAP
                </summary>
                <p className="mt-2 text-xs text-app-muted">
                  AI poate adapta aceste valori, dar nu primește și nu generează
                  adresa de e-mail.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {defaultFields.map(({ key, label }) => (
                    <label
                      key={key}
                      className="grid gap-1 text-xs font-semibold"
                    >
                      {label}
                      <input
                        className="min-h-9 rounded border border-app-border px-2 font-normal"
                        type={key === "password" ? "password" : "text"}
                        value={settings.defaults[key] ?? ""}
                        onChange={(event) =>
                          setSettings((current) => ({
                            ...current,
                            defaults: {
                              ...current.defaults,
                              [key]: event.target.value,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
                <label className="mt-3 grid gap-1 text-sm font-semibold">
                  Adresă e-mail din IMAP
                  <select
                    className="min-h-10 rounded border border-app-border bg-white px-3"
                    value={imapAccountId}
                    onChange={(event) => setImapAccountId(event.target.value)}
                  >
                    <option value="">Nicio adresă selectată</option>
                    {accounts.map((account) => (
                      <option key={account.id} value={account.id}>
                        {account.name} · {account.username}
                      </option>
                    ))}
                  </select>
                </label>
                <Button
                  className="mt-3"
                  variant="secondary"
                  disabled={savingSettings}
                  onClick={() => void saveSettings()}
                >
                  {savingSettings
                    ? "Se salvează…"
                    : "Salvează datele implicite"}
                </Button>
              </details>

              <div className="mt-4 rounded-xl border border-violet-200 bg-violet-50 p-4">
                <h4 className="font-semibold text-violet-950">
                  Generare teste cu AI
                </h4>
                <p className="mt-1 text-xs text-violet-900">
                  AI-ul este apelat numai când apeși butonul de mai jos.
                </p>
                <div className="mt-3 grid gap-3 sm:grid-cols-[12rem_1fr_auto] sm:items-end">
                  <label className="grid gap-1 text-sm font-semibold">
                    Provider AI
                    <select
                      className="min-h-10 rounded border border-violet-200 bg-white px-3 font-normal"
                      value={aiProvider}
                      disabled={generating}
                      onChange={(event) =>
                        void selectAiProvider(
                          event.target.value as AiProviderId,
                        )
                      }
                    >
                      <option value="none">Selectează providerul</option>
                      <option value="ollama">Ollama</option>
                      <option value="lm_studio">LM Studio</option>
                      <option value="gemini">Gemini</option>
                      <option value="openai">OpenAI</option>
                    </select>
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">
                    Model AI pentru formulare
                    <select
                      className="min-h-10 rounded border border-violet-200 bg-white px-3 font-normal"
                      value={aiModel}
                      disabled={aiProvider === "none" || loadingAiModels}
                      onChange={(event) => {
                        setAiModel(event.target.value);
                        setGeneration(undefined);
                      }}
                    >
                      <option value="">
                        {loadingAiModels
                          ? "Se încarcă modelele…"
                          : aiProvider === "none"
                            ? "Configurează mai întâi un provider AI"
                            : "Selectează modelul"}
                      </option>
                      {aiModelOptions.map((model) => (
                        <option key={model.id} value={model.id}>
                          {model.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    variant="secondary"
                    disabled={aiProvider === "none" || loadingAiModels}
                    onClick={() => void reloadAiModels()}
                  >
                    {loadingAiModels ? "Se încarcă…" : "Actualizează modele"}
                  </Button>
                </div>
                <AiModelPricingPanel
                  api={api}
                  provider={aiProvider}
                  model={aiModel}
                  className="mt-3"
                />
                {formHasEmail ? (
                  <label className="mt-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={expectEmail}
                      onChange={(event) => setExpectEmail(event.target.checked)}
                    />
                    Așteaptă e-mail în contul IMAP pentru scenariile valide
                  </label>
                ) : null}
                {selectedForm.fields.some(
                  ({ inputType }) => inputType === "file",
                ) ? (
                  <p className="mt-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                    Câmpurile de tip fișier vor genera pași „Încărcare fișier”,
                    nu „Completare”. După creare poți atașa un fișier
                    administrat în dataset; dacă lipsește, rularea solicită
                    selectarea lui manuală. Chei:{" "}
                    {selectedForm.fields
                      .map((field, index) =>
                        field.inputType === "file"
                          ? `${field.label} → form_field_${index + 1}`
                          : undefined,
                      )
                      .filter((value): value is string => value !== undefined)
                      .join(", ")}
                    .
                  </p>
                ) : null}
                <label className="mt-3 grid gap-1 text-sm font-semibold">
                  Instrucțiuni suplimentare opționale
                  <textarea
                    className="min-h-20 rounded border border-violet-200 bg-white p-2 font-normal"
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                  />
                </label>
                <Button
                  className="mt-3"
                  disabled={
                    generating ||
                    aiProvider === "none" ||
                    (aiProvider === "gemini" &&
                      aiSettings?.gemini.apiKeyConfigured !== true) ||
                    (aiProvider === "openai" &&
                      aiSettings?.openai?.apiKeyConfigured !== true) ||
                    aiModel.trim().length === 0 ||
                    selectedForm.submit === undefined ||
                    (formHasEmail === true && imapAccountId.length === 0)
                  }
                  onClick={() => void generate()}
                >
                  {generating ? "AI generează…" : "Generează teste"}
                </Button>
                {selectedForm.submit === undefined ? (
                  <p className="mt-2 text-xs text-amber-800">
                    Formularul nu are un buton de submit detectabil.
                  </p>
                ) : null}
              </div>

              {generation ? (
                <div className="mt-4 rounded-xl border border-emerald-200 p-4">
                  <h4 className="font-semibold">Preview teste propuse</h4>
                  <p className="mt-1 text-sm text-app-muted">
                    {generation.summary}
                  </p>
                  <div className="mt-3 grid gap-2">
                    {generation.scenarios.map((scenario) => (
                      <label
                        key={scenario.id}
                        className="flex items-start gap-3 rounded-lg border border-app-border p-3"
                      >
                        <input
                          className="mt-1"
                          type="checkbox"
                          checked={selectedScenarios.has(scenario.id)}
                          onChange={(event) =>
                            setSelectedScenarios((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(scenario.id);
                              else next.delete(scenario.id);
                              return next;
                            })
                          }
                        />
                        <span>
                          <strong className="block">{scenario.name}</strong>
                          <span className="text-xs text-app-muted">
                            {scenario.description}
                          </span>
                          <span className="mt-1 block text-xs text-brand-700">
                            {scenario.kind === "valid"
                              ? "Scenariu valid"
                              : "Validare negativă"}
                            {scenario.expectEmail ? " · verificare IMAP" : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                  <Button
                    className="mt-4"
                    disabled={creating || selectedScenarios.size === 0}
                    onClick={() => void createTests()}
                  >
                    {creating
                      ? "Se creează…"
                      : `Creează ${selectedScenarios.size} teste`}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
};
