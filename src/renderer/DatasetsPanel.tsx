import { useEffect, useMemo, useState, type ChangeEvent } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  DatasetPrimitive,
  DatasetValue,
  GeneratedDatasetValue,
  TestDataset,
} from "../shared/test-model.js";
import {
  parseTestDatasetJson,
  validateTestDataset,
  type ValidationIssue,
} from "../shared/test-validation.js";
import { Button } from "./components/Button.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { Input } from "./components/Input.js";
import { Select } from "./components/Select.js";
import { Tabs } from "./components/Tabs.js";

export interface DatasetsPanelProps {
  api: SemanticAppApi;
  projectId: string;
  testId: string;
}

type DatasetValueKind =
  "primitive" | "fixed" | GeneratedDatasetValue["strategy"];

const valueKind = (value: DatasetValue): DatasetValueKind => {
  if (value === null || typeof value !== "object") {
    return "primitive";
  }
  return value.type === "fixed" ? "fixed" : value.strategy;
};

const defaultValue = (kind: DatasetValueKind): DatasetValue => {
  switch (kind) {
    case "primitive":
      return "";
    case "fixed":
      return { type: "fixed", value: "" };
    case "timestamp":
    case "uuid":
      return { type: "generated", strategy: kind };
    case "random_number":
      return {
        type: "generated",
        strategy: "random_number",
        min: 1,
        max: 100,
      };
    case "unique_email":
      return {
        type: "generated",
        strategy: "unique_email",
        template: "test+{{timestamp}}@example.test",
      };
    case "current_date":
      return {
        type: "generated",
        strategy: "current_date",
        format: "YYYY-MM-DD",
      };
    case "current_date_plus_days":
    case "current_date_minus_days":
      return {
        type: "generated",
        strategy: kind,
        days: 1,
        format: "YYYY-MM-DD",
      };
    case "random_choice":
      return {
        type: "generated",
        strategy: "random_choice",
        choices: [""],
      };
    case "template":
      return {
        type: "generated",
        strategy: "template",
        template: "Test automat {{timestamp}}",
      };
  }
};

const primitiveType = (
  value: DatasetPrimitive,
): "string" | "number" | "boolean" | "null" => {
  if (value === null) return "null";
  if (typeof value === "number") return "number";
  if (typeof value === "boolean") return "boolean";
  return "string";
};

const defaultPrimitive = (
  type: ReturnType<typeof primitiveType>,
): DatasetPrimitive => {
  switch (type) {
    case "string":
      return "";
    case "number":
      return 0;
    case "boolean":
      return false;
    case "null":
      return null;
  }
};

interface PrimitiveEditorProps {
  labelPrefix: string;
  value: DatasetPrimitive;
  onChange: (value: DatasetPrimitive) => void;
}

const PrimitiveEditor = ({
  labelPrefix,
  onChange,
  value,
}: PrimitiveEditorProps) => {
  const type = primitiveType(value);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <Select
        label={`${labelPrefix} - tip`}
        value={type}
        options={[
          { value: "string", label: "Text" },
          { value: "number", label: "Număr" },
          { value: "boolean", label: "Boolean" },
          { value: "null", label: "Null" },
        ]}
        onChange={(event) => {
          onChange(
            defaultPrimitive(
              event.target.value as ReturnType<typeof primitiveType>,
            ),
          );
        }}
      />
      {type === "boolean" ? (
        <Select
          label={`${labelPrefix} - valoare`}
          value={String(value)}
          options={[
            { value: "false", label: "false" },
            { value: "true", label: "true" },
          ]}
          onChange={(event) => {
            onChange(event.target.value === "true");
          }}
        />
      ) : type === "null" ? (
        <div className="rounded-lg border border-app-border bg-app-canvas p-3 text-sm text-app-muted">
          Valoarea este null.
        </div>
      ) : (
        <Input
          label={`${labelPrefix} - valoare`}
          type={type === "number" ? "number" : "text"}
          value={String(value)}
          onChange={(event) => {
            onChange(
              type === "number"
                ? Number(event.target.value)
                : event.target.value,
            );
          }}
        />
      )}
    </div>
  );
};

const strategyOptions = [
  { value: "primitive", label: "Valoare simplă" },
  { value: "fixed", label: "Valoare fixă" },
  { value: "timestamp", label: "Timestamp" },
  { value: "uuid", label: "UUID" },
  { value: "random_number", label: "Număr aleator" },
  { value: "unique_email", label: "Email unic" },
  { value: "current_date", label: "Data curentă" },
  {
    value: "current_date_plus_days",
    label: "Data curentă + zile",
  },
  {
    value: "current_date_minus_days",
    label: "Data curentă - zile",
  },
  { value: "random_choice", label: "Alegere aleatorie din listă" },
  { value: "template", label: "Text din template" },
];

interface DatasetValueRowProps {
  api: SemanticAppApi;
  projectId: string;
  testId: string;
  fieldId: string;
  value: DatasetValue;
  issues: ValidationIssue[];
  onChange: (value: DatasetValue) => void;
  onDelete: () => void;
  onRename: (nextFieldId: string) => string | undefined;
}

const DatasetValueRow = ({
  api,
  fieldId,
  issues,
  onChange,
  onDelete,
  onRename,
  projectId,
  testId,
  value,
}: DatasetValueRowProps) => {
  const [fieldDraft, setFieldDraft] = useState(fieldId);
  const [fieldError, setFieldError] = useState<string>();
  const [preview, setPreview] = useState<DatasetPrimitive>();
  const [hasPreview, setHasPreview] = useState(false);
  const [previewError, setPreviewError] = useState<string>();
  const [isPreviewing, setIsPreviewing] = useState(false);
  const kind = valueKind(value);

  useEffect(() => {
    setFieldDraft(fieldId);
  }, [fieldId]);

  const updateGenerated = (next: GeneratedDatasetValue): void => {
    setHasPreview(false);
    onChange(next);
  };

  const previewValue = async (): Promise<void> => {
    setIsPreviewing(true);
    setPreviewError(undefined);
    try {
      setPreview(await api.previewDatasetValue(projectId, testId, { value }));
      setHasPreview(true);
    } catch {
      setPreviewError("Preview-ul nu a putut fi generat.");
    } finally {
      setIsPreviewing(false);
    }
  };

  return (
    <article className="rounded-xl border border-app-border bg-app-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          <Input
            label={`Cheie semantică ${fieldId}`}
            value={fieldDraft}
            {...(fieldError === undefined ? {} : { error: fieldError })}
            onChange={(event) => {
              setFieldDraft(event.target.value);
              setFieldError(undefined);
            }}
            onBlur={() => {
              const error = onRename(fieldDraft);
              setFieldError(error);
              if (error) {
                setFieldDraft(fieldId);
              }
            }}
          />
          <Select
            label={`Strategie pentru ${fieldId}`}
            value={kind}
            options={strategyOptions}
            onChange={(event) => {
              setHasPreview(false);
              onChange(defaultValue(event.target.value as DatasetValueKind));
            }}
          />
        </div>
        <Button variant="danger" onClick={onDelete}>
          Șterge cheia
        </Button>
      </div>

      <div className="mt-4">
        {kind === "primitive" ? (
          <PrimitiveEditor
            labelPrefix={fieldId}
            value={value as DatasetPrimitive}
            onChange={(next) => {
              setHasPreview(false);
              onChange(next);
            }}
          />
        ) : kind === "fixed" && typeof value === "object" && value !== null ? (
          <PrimitiveEditor
            labelPrefix={fieldId}
            value={value.type === "fixed" ? value.value : ""}
            onChange={(next) => {
              setHasPreview(false);
              onChange({ type: "fixed", value: next });
            }}
          />
        ) : null}

        {typeof value === "object" &&
        value !== null &&
        value.type === "generated" ? (
          <div className="grid gap-3">
            {value.strategy === "random_number" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label={`Minim pentru ${fieldId}`}
                  type="number"
                  value={value.min}
                  onChange={(event) => {
                    updateGenerated({
                      ...value,
                      min: Number(event.target.value),
                    });
                  }}
                />
                <Input
                  label={`Maxim pentru ${fieldId}`}
                  type="number"
                  value={value.max}
                  onChange={(event) => {
                    updateGenerated({
                      ...value,
                      max: Number(event.target.value),
                    });
                  }}
                />
              </div>
            ) : null}

            {value.strategy === "unique_email" ? (
              <Input
                label={`Template email pentru ${fieldId}`}
                value={value.template ?? ""}
                hint="Token-uri: {{unique}}, {{timestamp}}, {{uuid}}"
                onChange={(event) => {
                  updateGenerated({
                    ...value,
                    template: event.target.value,
                  });
                }}
              />
            ) : null}

            {value.strategy === "current_date" ||
            value.strategy === "current_date_plus_days" ||
            value.strategy === "current_date_minus_days" ? (
              <div className="grid gap-3 sm:grid-cols-2">
                {"days" in value ? (
                  <Input
                    label={`Număr de zile pentru ${fieldId}`}
                    type="number"
                    min={0}
                    step={1}
                    value={value.days}
                    onChange={(event) => {
                      updateGenerated({
                        ...value,
                        days: Number(event.target.value),
                      });
                    }}
                  />
                ) : (
                  <div />
                )}
                <Input
                  label={`Format dată pentru ${fieldId}`}
                  value={value.format ?? ""}
                  hint="Exemplu: YYYY-MM-DD sau DD.MM.YYYY"
                  onChange={(event) => {
                    updateGenerated({
                      ...value,
                      format: event.target.value,
                    });
                  }}
                />
              </div>
            ) : null}

            {value.strategy === "random_choice" ? (
              <div className="grid gap-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="font-medium text-app-ink">
                    Valori disponibile pentru alegere
                  </p>
                  <Button
                    variant="secondary"
                    onClick={() => {
                      updateGenerated({
                        ...value,
                        choices: [...value.choices, ""],
                      });
                    }}
                  >
                    + Valoare
                  </Button>
                </div>
                {value.choices.map((choice, index) => (
                  <div
                    key={`${fieldId}-choice-${index}`}
                    className="grid gap-3 rounded-lg border border-app-border p-3 md:grid-cols-[1fr_auto]"
                  >
                    <PrimitiveEditor
                      labelPrefix={`${fieldId} alegerea ${index + 1}`}
                      value={choice}
                      onChange={(next) => {
                        const choices = [...value.choices];
                        choices[index] = next;
                        updateGenerated({ ...value, choices });
                      }}
                    />
                    <Button
                      variant="danger"
                      disabled={value.choices.length === 1}
                      onClick={() => {
                        updateGenerated({
                          ...value,
                          choices: value.choices.filter(
                            (_item, itemIndex) => itemIndex !== index,
                          ),
                        });
                      }}
                    >
                      Elimină
                    </Button>
                  </div>
                ))}
              </div>
            ) : null}

            {value.strategy === "template" ? (
              <label className="grid gap-1.5 text-sm font-medium text-app-ink">
                Template pentru {fieldId}
                <textarea
                  className="min-h-24 rounded-lg border border-app-border bg-app-surface px-3 py-2 font-mono text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  value={value.template}
                  onChange={(event) => {
                    updateGenerated({
                      ...value,
                      template: event.target.value,
                    });
                  }}
                />
                <span className="font-normal text-app-muted">
                  Token-uri: {"{{timestamp}}"} și {"{{uuid}}"}
                </span>
              </label>
            ) : null}
          </div>
        ) : null}
      </div>

      {issues.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-sm text-red-700" role="alert">
          {issues.map((issue) => (
            <li key={`${issue.path}-${issue.code}`}>
              {issue.path}: {issue.message}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          variant="secondary"
          disabled={isPreviewing}
          onClick={() => {
            void previewValue();
          }}
        >
          {isPreviewing ? "Se generează..." : "Previzualizează valoarea"}
        </Button>
        {hasPreview ? (
          <output className="rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 font-mono text-sm text-app-ink">
            {preview === null ? "null" : JSON.stringify(preview)}
          </output>
        ) : null}
        {previewError ? (
          <span className="text-sm text-red-700" role="alert">
            {previewError}
          </span>
        ) : null}
      </div>
    </article>
  );
};

const prettyDataset = (dataset: TestDataset): string =>
  JSON.stringify(dataset, null, 2);

export const DatasetsPanel = ({
  api,
  projectId,
  testId,
}: DatasetsPanelProps) => {
  const [datasets, setDatasets] = useState<TestDataset[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [draft, setDraft] = useState<TestDataset>();
  const [rawJson, setRawJson] = useState("");
  const [rawIssues, setRawIssues] = useState<ValidationIssue[]>([]);
  const [newName, setNewName] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isBusy, setIsBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [pendingDelete, setPendingDelete] = useState(false);

  const selectDataset = (dataset: TestDataset): void => {
    const copy = structuredClone(dataset);
    setSelectedId(dataset.id);
    setDraft(copy);
    setRawJson(prettyDataset(copy));
    setRawIssues([]);
    setError(undefined);
    setNotice(undefined);
  };

  useEffect(() => {
    let active = true;
    setIsLoading(true);
    void api
      .listDatasets(projectId, testId)
      .then((items) => {
        if (!active) return;
        setDatasets(items);
        if (items[0]) {
          selectDataset(items[0]);
        } else {
          setSelectedId(undefined);
          setDraft(undefined);
          setRawJson("");
          setRawIssues([]);
        }
      })
      .catch(() => {
        if (active) {
          setError("Dataset-urile nu au putut fi încărcate.");
        }
      })
      .finally(() => {
        if (active) {
          setIsLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [api, projectId, testId]);

  const validation = useMemo(
    () => (draft ? validateTestDataset(draft) : undefined),
    [draft],
  );
  const validationIssues =
    validation && !validation.valid ? validation.issues : [];
  const allIssues = rawIssues.length > 0 ? rawIssues : validationIssues;

  const updateDraft = (next: TestDataset): void => {
    setDraft(next);
    setRawJson(prettyDataset(next));
    setRawIssues([]);
    setNotice(undefined);
  };

  const createDataset = async (): Promise<void> => {
    setIsBusy(true);
    setError(undefined);
    try {
      const created = await api.createDataset(projectId, testId, {
        name: newName,
      });
      setDatasets((current) => [...current, created]);
      setNewName("");
      selectDataset(created);
      setNotice("Dataset creat.");
    } catch {
      setError("Dataset-ul nu a putut fi creat. Numele este obligatoriu.");
    } finally {
      setIsBusy(false);
    }
  };

  const duplicateDataset = async (): Promise<void> => {
    if (!draft) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const duplicate = await api.duplicateDataset(projectId, testId, draft.id);
      setDatasets((current) => [...current, duplicate]);
      selectDataset(duplicate);
      setNotice("Dataset duplicat.");
    } catch {
      setError("Dataset-ul nu a putut fi duplicat.");
    } finally {
      setIsBusy(false);
    }
  };

  const saveDataset = async (): Promise<void> => {
    if (!draft || !validation?.valid || rawIssues.length > 0) return;
    setIsBusy(true);
    setError(undefined);
    try {
      const saved = await api.saveDataset(projectId, testId, draft.id, {
        name: draft.name,
        values: draft.values,
      });
      setDatasets((current) =>
        current.map((item) => (item.id === saved.id ? saved : item)),
      );
      selectDataset(saved);
      setNotice("Dataset salvat.");
    } catch {
      setError("Dataset-ul nu a putut fi salvat.");
    } finally {
      setIsBusy(false);
    }
  };

  const deleteDataset = async (): Promise<void> => {
    if (!draft) return;
    setIsBusy(true);
    setError(undefined);
    try {
      await api.deleteDataset(projectId, testId, draft.id);
      const remaining = datasets.filter((item) => item.id !== draft.id);
      setDatasets(remaining);
      setPendingDelete(false);
      if (remaining[0]) {
        selectDataset(remaining[0]);
      } else {
        setSelectedId(undefined);
        setDraft(undefined);
        setRawJson("");
        setRawIssues([]);
      }
      setNotice("Dataset șters.");
    } catch {
      setError("Dataset-ul nu a putut fi șters.");
    } finally {
      setIsBusy(false);
    }
  };

  const visualEditor = draft ? (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-64 flex-1">
          <Input
            label="Numele datasetului"
            value={draft.name}
            onChange={(event) => {
              updateDraft({ ...draft, name: event.target.value });
            }}
          />
        </div>
        <Button
          variant="secondary"
          onClick={() => {
            let index = Object.keys(draft.values).length + 1;
            let fieldId = `field_${index}`;
            while (Object.hasOwn(draft.values, fieldId)) {
              index += 1;
              fieldId = `field_${index}`;
            }
            updateDraft({
              ...draft,
              values: { ...draft.values, [fieldId]: "" },
            });
          }}
        >
          + Cheie
        </Button>
      </div>

      {Object.keys(draft.values).length === 0 ? (
        <div className="rounded-xl border border-dashed border-app-border bg-app-canvas p-6 text-center">
          <p className="font-medium text-app-ink">
            Dataset-ul nu are încă valori
          </p>
          <p className="mt-1 text-sm text-app-muted">
            Adaugă o cheie semantică și alege o valoare fixă sau generată.
          </p>
        </div>
      ) : (
        Object.entries(draft.values).map(([fieldId, value]) => (
          <DatasetValueRow
            key={fieldId}
            api={api}
            projectId={projectId}
            testId={testId}
            fieldId={fieldId}
            value={value}
            issues={validationIssues.filter((issue) =>
              issue.path.startsWith(`$.values.${fieldId}`),
            )}
            onChange={(next) => {
              updateDraft({
                ...draft,
                values: { ...draft.values, [fieldId]: next },
              });
            }}
            onDelete={() => {
              const values = { ...draft.values };
              delete values[fieldId];
              updateDraft({ ...draft, values });
            }}
            onRename={(nextFieldId) => {
              const trimmed = nextFieldId.trim();
              if (trimmed.length === 0) {
                return "Cheia este obligatorie.";
              }
              if (trimmed !== fieldId && Object.hasOwn(draft.values, trimmed)) {
                return "Cheia există deja.";
              }
              if (trimmed === fieldId) {
                return undefined;
              }
              const entries = Object.entries(draft.values).map(([key, item]) =>
                key === fieldId
                  ? ([trimmed, item] as const)
                  : ([key, item] as const),
              );
              updateDraft({ ...draft, values: Object.fromEntries(entries) });
              return undefined;
            }}
          />
        ))
      )}
    </div>
  ) : null;

  const jsonEditor = draft ? (
    <div className="grid gap-3">
      <label className="grid gap-1.5 text-sm font-medium text-app-ink">
        JSON raw al datasetului
        <textarea
          aria-label="JSON raw al datasetului"
          spellCheck={false}
          className="min-h-96 rounded-lg border border-app-border bg-stone-950 px-4 py-3 font-mono text-sm leading-6 text-stone-100 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          value={rawJson}
          onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
            const json = event.target.value;
            setRawJson(json);
            setNotice(undefined);
            const parsed = parseTestDatasetJson(json);
            if (!parsed.valid) {
              setRawIssues(parsed.issues);
              return;
            }
            if (
              parsed.data.id !== draft.id ||
              parsed.data.testId !== draft.testId ||
              parsed.data.createdAt !== draft.createdAt
            ) {
              setRawIssues([
                {
                  path: "$",
                  code: "invalid_value",
                  message:
                    "id, testId și createdAt sunt administrate de aplicație și nu pot fi schimbate.",
                },
              ]);
              return;
            }
            setRawIssues([]);
            setDraft(parsed.data);
          }}
        />
      </label>
      <p className="text-xs text-app-muted">
        JSON valid actualizează imediat editorul vizual. Câmpurile id, testId și
        createdAt rămân nemodificabile.
      </p>
    </div>
  ) : null;

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="font-semibold text-app-ink">Datasets</h3>
          <p className="mt-1 text-sm text-app-muted">
            Valorile sunt locale, salvate în clar și aparțin exclusiv acestui
            test. Nu introduce parole sau alte secrete.
          </p>
        </div>
        {draft ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                void duplicateDataset();
              }}
            >
              Duplică
            </Button>
            <Button
              variant="danger"
              disabled={isBusy}
              onClick={() => {
                setPendingDelete(true);
              }}
            >
              Șterge
            </Button>
          </div>
        ) : null}
      </div>

      {error ? (
        <p
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          role="status"
        >
          {notice}
        </p>
      ) : null}

      <div className="mt-4 grid gap-4 lg:grid-cols-[16rem_1fr]">
        <aside className="rounded-xl border border-app-border bg-app-surface p-3">
          <form
            className="grid gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void createDataset();
            }}
          >
            <Input
              label="Dataset nou"
              placeholder="Client standard"
              value={newName}
              onChange={(event) => {
                setNewName(event.target.value);
              }}
            />
            <Button
              type="submit"
              disabled={isBusy || newName.trim().length === 0}
            >
              {isBusy ? "Se salvează..." : "Creează dataset"}
            </Button>
          </form>

          <div className="mt-4 grid gap-2" aria-label="Lista dataseturilor">
            {isLoading ? (
              <p className="text-sm text-app-muted">Se încarcă...</p>
            ) : datasets.length === 0 ? (
              <p className="text-sm text-app-muted">
                Nu există încă niciun dataset.
              </p>
            ) : (
              datasets.map((dataset) => (
                <button
                  key={dataset.id}
                  type="button"
                  aria-pressed={dataset.id === selectedId}
                  className={`rounded-lg border px-3 py-2 text-left text-sm font-medium ${
                    dataset.id === selectedId
                      ? "border-brand-500 bg-brand-50 text-brand-800"
                      : "border-app-border bg-app-surface text-app-ink hover:bg-app-canvas"
                  }`}
                  onClick={() => {
                    selectDataset(dataset);
                  }}
                >
                  {dataset.name}
                </button>
              ))
            )}
          </div>
        </aside>

        <div>
          {draft ? (
            <>
              <Tabs
                label="Editor dataset"
                tabs={[
                  {
                    id: "visual",
                    label: "Editor vizual",
                    content: visualEditor,
                  },
                  { id: "json", label: "JSON raw", content: jsonEditor },
                ]}
              />

              {allIssues.length > 0 ? (
                <div
                  className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3"
                  role="alert"
                >
                  <p className="font-semibold text-red-800">
                    Dataset-ul nu este valid
                  </p>
                  <ul className="mt-2 grid gap-1 text-sm text-red-700">
                    {allIssues.map((issue) => (
                      <li key={`${issue.path}-${issue.code}`}>
                        {issue.path}: {issue.message}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              <div className="mt-4 flex justify-end">
                <Button
                  disabled={
                    isBusy || !validation?.valid || rawIssues.length > 0
                  }
                  onClick={() => {
                    void saveDataset();
                  }}
                >
                  {isBusy ? "Se salvează..." : "Salvează datasetul"}
                </Button>
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-app-border bg-app-surface p-8 text-center">
              <p className="font-medium text-app-ink">
                Creează primul dataset al testului
              </p>
              <p className="mt-1 text-sm text-app-muted">
                Poți defini până la 1000 de chei semantice.
              </p>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={pendingDelete}
        title="Ștergi dataset-ul?"
        message={`Dataset-ul „${draft?.name ?? ""}” și toate valorile sale vor fi șterse.`}
        confirmLabel="Șterge datasetul"
        confirmVariant="danger"
        onCancel={() => {
          setPendingDelete(false);
        }}
        onConfirm={() => {
          void deleteDataset();
        }}
      />
    </section>
  );
};
