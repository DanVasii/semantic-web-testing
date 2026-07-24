import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition, TestVersion } from "../shared/persistence.js";
import {
  createFlowItem,
  createProceduralDescription,
  createSimpleLocator,
  toDeclarativeTestDefinition,
} from "../shared/test-editor.js";
import {
  ACTION_TYPES,
  MATCH_OPERATORS,
  RELATIVE_LOCATOR_RELATIONS,
  SIMPLE_LOCATOR_TYPES,
  type ActionStep,
  type LocatorDefinition,
  type TestFlowItem,
} from "../shared/test-model.js";
import { validateDeclarativeTest } from "../shared/test-validation.js";
import { Button } from "./components/Button.js";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";

interface LocatorEditorProps {
  locator: LocatorDefinition;
  onChange: (locator: LocatorDefinition) => void;
  label?: string;
  depth?: number;
}

const LocatorEditor = ({
  depth = 0,
  label = "Locator",
  locator,
  onChange,
}: LocatorEditorProps) => {
  const kind =
    locator.type === "relative" || locator.type === "repeated_component"
      ? locator.type
      : "simple";

  const changeKind = (nextKind: string): void => {
    if (nextKind === "relative") {
      onChange({
        type: "relative",
        anchor: createSimpleLocator(),
        relation: "inside",
        target: createSimpleLocator(),
      });
    } else if (nextKind === "repeated_component") {
      onChange({
        type: "repeated_component",
        container: createSimpleLocator(),
        filters: [
          {
            field: createSimpleLocator(),
            operator: "contains",
            value: "produs",
          },
        ],
        targetInsideContainer: createSimpleLocator(),
      });
    } else {
      onChange(createSimpleLocator());
    }
  };

  return (
    <fieldset className="mt-3 rounded-lg border border-app-border p-3">
      <legend className="px-1 text-xs font-semibold">{label}</legend>
      <label className={labelClass}>
        Strategie
        <select
          className={fieldClass}
          aria-label={`${label} strategie`}
          value={kind}
          onChange={(event) => {
            changeKind(event.target.value);
          }}
        >
          <option value="simple">Simplu</option>
          <option value="relative">Relativ</option>
          <option value="repeated_component">Componentă repetitivă</option>
        </select>
      </label>

      {kind === "simple" &&
      locator.type !== "relative" &&
      locator.type !== "repeated_component" ? (
        <div className="mt-2 grid gap-3 sm:grid-cols-3">
          <label className={labelClass}>
            Tip
            <select
              className={fieldClass}
              value={locator.type}
              onChange={(event) => {
                const nextType = event.target
                  .value as (typeof SIMPLE_LOCATOR_TYPES)[number];
                onChange({
                  type: nextType,
                  operator: locator.operator,
                  value: locator.value,
                  ...(nextType === "role" ? { role: "button" } : {}),
                  ...(nextType === "data_attribute"
                    ? { attribute: "data-testid" }
                    : {}),
                });
              }}
            >
              {SIMPLE_LOCATOR_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            Operator
            <select
              className={fieldClass}
              value={locator.operator}
              onChange={(event) => {
                const operator = event.target
                  .value as (typeof MATCH_OPERATORS)[number];
                const usesKeywords =
                  operator === "contains_all_keywords" ||
                  operator === "contains_any_keyword";
                onChange({
                  ...locator,
                  operator,
                  value: usesKeywords
                    ? Array.isArray(locator.value)
                      ? locator.value
                      : locator.value
                          .split(",")
                          .map((value) => value.trim())
                          .filter(Boolean)
                    : Array.isArray(locator.value)
                      ? locator.value.join(" ")
                      : locator.value,
                });
              }}
            >
              {MATCH_OPERATORS.map((operator) => (
                <option key={operator} value={operator}>
                  {operator}
                </option>
              ))}
            </select>
          </label>
          <label className={labelClass}>
            {Array.isArray(locator.value) ? "Cuvinte-cheie" : "Valoare"}
            <input
              className={fieldClass}
              value={
                Array.isArray(locator.value)
                  ? locator.value.join(", ")
                  : locator.value
              }
              onChange={(event) => {
                onChange({
                  ...locator,
                  value: Array.isArray(locator.value)
                    ? event.target.value
                        .split(",")
                        .map((value) => value.trim())
                        .filter(Boolean)
                    : event.target.value,
                });
              }}
            />
          </label>
          {locator.type === "role" ? (
            <label className={labelClass}>
              Rol ARIA
              <input
                className={fieldClass}
                value={locator.role ?? ""}
                onChange={(event) => {
                  onChange({ ...locator, role: event.target.value });
                }}
              />
            </label>
          ) : null}
          {locator.type === "data_attribute" ? (
            <label className={labelClass}>
              Atribut
              <input
                className={fieldClass}
                value={locator.attribute ?? ""}
                onChange={(event) => {
                  onChange({ ...locator, attribute: event.target.value });
                }}
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {locator.type === "relative" ? (
        <div className="mt-2">
          <label className={labelClass}>
            Relație
            <select
              className={fieldClass}
              value={locator.relation}
              onChange={(event) => {
                onChange({
                  ...locator,
                  relation: event.target
                    .value as (typeof RELATIVE_LOCATOR_RELATIONS)[number],
                });
              }}
            >
              {RELATIVE_LOCATOR_RELATIONS.map((relation) => (
                <option key={relation} value={relation}>
                  {relation}
                </option>
              ))}
            </select>
          </label>
          {depth < 2 ? (
            <>
              <LocatorEditor
                depth={depth + 1}
                label="Ancoră"
                locator={locator.anchor}
                onChange={(anchor) => {
                  onChange({ ...locator, anchor });
                }}
              />
              <LocatorEditor
                depth={depth + 1}
                label="Țintă relativă"
                locator={locator.target}
                onChange={(target) => {
                  onChange({ ...locator, target });
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}

      {locator.type === "repeated_component" ? (
        <div className="mt-2">
          {depth < 2 ? (
            <>
              <LocatorEditor
                depth={depth + 1}
                label="Container repetitiv"
                locator={locator.container}
                onChange={(container) => {
                  onChange({ ...locator, container });
                }}
              />
              {locator.filters.map((filter, index) => (
                <fieldset
                  key={index}
                  className="mt-3 rounded-lg border border-app-border p-3"
                >
                  <legend className="px-1 text-xs font-semibold">
                    Filtru {index + 1}
                  </legend>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className={labelClass}>
                      Operator
                      <select
                        className={fieldClass}
                        value={filter.operator}
                        onChange={(event) => {
                          const filters = clone(locator.filters);
                          filters[index] = {
                            ...filter,
                            operator: event.target
                              .value as (typeof MATCH_OPERATORS)[number],
                          };
                          onChange({ ...locator, filters });
                        }}
                      >
                        {MATCH_OPERATORS.map((operator) => (
                          <option key={operator} value={operator}>
                            {operator}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className={labelClass}>
                      Valoare filtru
                      <input
                        className={fieldClass}
                        value={
                          Array.isArray(filter.value)
                            ? filter.value.join(", ")
                            : filter.value
                        }
                        onChange={(event) => {
                          const filters = clone(locator.filters);
                          filters[index] = {
                            ...filter,
                            value: event.target.value,
                          };
                          onChange({ ...locator, filters });
                        }}
                      />
                    </label>
                  </div>
                  <LocatorEditor
                    depth={depth + 1}
                    label="Câmp filtrat"
                    locator={filter.field}
                    onChange={(field) => {
                      const filters = clone(locator.filters);
                      filters[index] = { ...filter, field };
                      onChange({ ...locator, filters });
                    }}
                  />
                </fieldset>
              ))}
              <Button
                className="mt-3"
                variant="secondary"
                onClick={() => {
                  onChange({
                    ...locator,
                    filters: [
                      ...locator.filters,
                      {
                        field: createSimpleLocator(),
                        operator: "contains",
                        value: "valoare",
                      },
                    ],
                  });
                }}
              >
                + Filtru
              </Button>
              <LocatorEditor
                depth={depth + 1}
                label="Țintă în container"
                locator={locator.targetInsideContainer}
                onChange={(targetInsideContainer) => {
                  onChange({ ...locator, targetInsideContainer });
                }}
              />
            </>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
};

interface TestFlowEditorProps {
  api: SemanticAppApi;
  projectId: string;
  test: TestDefinition;
  onTestSaved: (test: TestDefinition) => void;
}

export const TestFlowEditor = ({
  api,
  onTestSaved,
  projectId,
  test,
}: TestFlowEditorProps) => {
  const [items, setItems] = useState<TestFlowItem[]>(() =>
    clone(test.flowItems),
  );
  const [history, setHistory] = useState<TestFlowItem[][]>([]);
  const [addType, setAddType] = useState<TestFlowItem["type"]>("action");
  const [draggedIndex, setDraggedIndex] = useState<number>();
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<TestVersion[]>([]);

  useEffect(() => {
    setItems(clone(test.flowItems));
    setHistory([]);
    setDirty(false);
  }, [test.id, test.version, test.flowItems]);

  useEffect(() => {
    void api
      .listTestVersions(projectId, test.id)
      .then(setVersions)
      .catch(() => {
        setVersions([]);
      });
  }, [api, projectId, test.id, test.version]);

  const validation = useMemo(
    () => validateDeclarativeTest(toDeclarativeTestDefinition(test, items, [])),
    [items, test],
  );

  const mutate = (next: TestFlowItem[]): void => {
    setHistory((current) => [...current.slice(-49), clone(items)]);
    setItems(next);
    setDirty(true);
    setSaveError(undefined);
  };

  const updateItem = (index: number, item: TestFlowItem): void => {
    const next = [...items];
    next[index] = item;
    mutate(next);
  };

  const moveItem = (from: number, to: number): void => {
    if (to < 0 || to >= items.length || from === to) return;
    const next = [...items];
    const [item] = next.splice(from, 1);
    if (item !== undefined) {
      next.splice(to, 0, item);
      mutate(next);
    }
  };

  const save = async (): Promise<void> => {
    if (!validation.valid) return;
    setIsSaving(true);
    setSaveError(undefined);
    try {
      const saved = await api.saveTestFlow(projectId, test.id, items);
      setDirty(false);
      setHistory([]);
      onTestSaved(saved);
      setVersions(await api.listTestVersions(projectId, test.id));
    } catch {
      setSaveError("Flow-ul nu a putut fi salvat.");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <section
      className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4"
      aria-labelledby="flow-editor-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="flow-editor-heading" className="font-semibold">
            Editor flow declarativ
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Revizuiește pașii înregistrați, locatorii și explicațiile înainte de
            salvare.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={history.length === 0}
            onClick={() => {
              const previous = history.at(-1);
              if (previous !== undefined) {
                setItems(previous);
                setHistory((current) => current.slice(0, -1));
                setDirty(true);
              }
            }}
          >
            Undo
          </Button>
          <Button
            aria-label="Salvează flow-ul testului"
            disabled={!dirty || !validation.valid || isSaving}
            onClick={() => {
              void save();
            }}
          >
            {isSaving ? "Se salvează..." : "Salvează testul"}
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-2">
        <label className={labelClass}>
          Tip pas nou
          <select
            className={fieldClass}
            value={addType}
            onChange={(event) => {
              setAddType(event.target.value as TestFlowItem["type"]);
            }}
          >
            <option value="action">Acțiune</option>
            <option value="check">Verificare</option>
            <option value="breakpoint">Breakpoint</option>
            <option value="manual_intervention">Intervenție manuală</option>
          </select>
        </label>
        <Button
          onClick={() => {
            mutate([...items, createFlowItem(addType, createId())]);
          }}
        >
          + Adaugă pas
        </Button>
      </div>

      {!validation.valid ? (
        <div
          className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          <p className="font-semibold">Flow invalid — salvarea este blocată</p>
          <ul className="mt-1 list-disc pl-5">
            {validation.issues.slice(0, 8).map((issue, index) => (
              <li key={`${issue.path}-${index}`}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p
          className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          role="status"
        >
          Flow valid. Poate fi salvat.
        </p>
      )}
      {saveError ? (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {saveError}
        </p>
      ) : null}

      {items.length === 0 ? (
        <p className="mt-4 rounded-lg border border-dashed border-app-border p-5 text-center text-sm text-app-muted">
          Flow-ul nu conține încă pași.
        </p>
      ) : (
        <ol className="mt-4 grid gap-4">
          {items.map((item, index) => {
            const itemIssues = validation.valid
              ? []
              : validation.issues.filter((issue) =>
                  issue.path.startsWith(`$.flowItems[${index}]`),
                );
            return (
              <li
                key={item.id}
                draggable
                className="rounded-xl border border-app-border bg-app-surface p-4"
                onDragStart={() => {
                  setDraggedIndex(index);
                }}
                onDragOver={(event) => {
                  event.preventDefault();
                }}
                onDrop={() => {
                  if (draggedIndex !== undefined) {
                    moveItem(draggedIndex, index);
                    setDraggedIndex(undefined);
                  }
                }}
              >
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span
                      className="cursor-grab text-app-muted"
                      title="Trage pentru reordonare"
                    >
                      ⋮⋮
                    </span>
                    <span className="text-xs font-semibold text-brand-700 uppercase">
                      {index + 1}. {item.type}
                    </span>
                    <label className="flex items-center gap-2 text-xs">
                      <input
                        type="checkbox"
                        checked={item.enabled}
                        onChange={(event) => {
                          updateItem(index, {
                            ...item,
                            enabled: event.target.checked,
                          });
                        }}
                      />
                      Activ
                    </label>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      disabled={index === 0}
                      aria-label={`Mută pasul ${index + 1} în sus`}
                      onClick={() => {
                        moveItem(index, index - 1);
                      }}
                    >
                      ↑
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={index === items.length - 1}
                      aria-label={`Mută pasul ${index + 1} în jos`}
                      onClick={() => {
                        moveItem(index, index + 1);
                      }}
                    >
                      ↓
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        const duplicate = clone(item);
                        duplicate.id = createId();
                        const next = [...items];
                        next.splice(index + 1, 0, duplicate);
                        mutate(next);
                      }}
                    >
                      Duplică
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => {
                        mutate(
                          items.filter((_, itemIndex) => itemIndex !== index),
                        );
                      }}
                    >
                      Șterge
                    </Button>
                  </div>
                </div>

                {"title" in item ? (
                  <div className="mt-3 grid gap-3 lg:grid-cols-3">
                    <label className={labelClass}>
                      Titlu
                      <input
                        className={fieldClass}
                        value={item.title ?? ""}
                        onChange={(event) => {
                          updateItem(index, {
                            ...item,
                            title: event.target.value,
                          });
                        }}
                      />
                    </label>
                    {"humanDescription" in item ? (
                      <label className={labelClass}>
                        Descriere umană
                        <textarea
                          className={fieldClass}
                          value={item.humanDescription}
                          onChange={(event) => {
                            updateItem(index, {
                              ...item,
                              humanDescription: event.target.value,
                            });
                          }}
                        />
                      </label>
                    ) : null}
                    {"whyExplanation" in item ? (
                      <label className={labelClass}>
                        De ce?
                        <textarea
                          className={fieldClass}
                          value={item.whyExplanation}
                          onChange={(event) => {
                            updateItem(index, {
                              ...item,
                              whyExplanation: event.target.value,
                            });
                          }}
                        />
                      </label>
                    ) : null}
                  </div>
                ) : null}

                {item.type === "action" ? (
                  <>
                    <label className={`${labelClass} mt-3`}>
                      Tip acțiune
                      <select
                        className={fieldClass}
                        value={item.actionType}
                        onChange={(event) => {
                          updateItem(index, {
                            ...item,
                            actionType: event.target
                              .value as ActionStep["actionType"],
                          });
                        }}
                      >
                        {ACTION_TYPES.map((actionType) => (
                          <option key={actionType} value={actionType}>
                            {actionType}
                          </option>
                        ))}
                      </select>
                    </label>
                    {item.target !== undefined ? (
                      <LocatorEditor
                        label="Locator principal"
                        locator={item.target.primary}
                        onChange={(primary) => {
                          updateItem(index, {
                            ...item,
                            target: { ...item.target, primary },
                          });
                        }}
                      />
                    ) : (
                      <Button
                        className="mt-3"
                        variant="secondary"
                        onClick={() => {
                          updateItem(index, {
                            ...item,
                            target: { primary: createSimpleLocator() },
                          });
                        }}
                      >
                        + Locator principal
                      </Button>
                    )}
                    <div className="mt-3">
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-sm font-semibold">
                          Fallback-uri ({item.fallbacks.length}/3)
                        </h4>
                        <Button
                          variant="secondary"
                          disabled={item.fallbacks.length >= 3}
                          onClick={() => {
                            updateItem(index, {
                              ...item,
                              fallbacks: [
                                ...item.fallbacks,
                                {
                                  locator: createSimpleLocator(),
                                  humanDescription: "Locator alternativ",
                                  whyExplanation:
                                    "Este folosit dacă locatorul principal nu găsește elementul.",
                                },
                              ],
                            });
                          }}
                        >
                          + Fallback
                        </Button>
                      </div>
                      {item.fallbacks.map((fallback, fallbackIndex) => (
                        <div
                          key={fallbackIndex}
                          className="mt-3 rounded-lg border border-app-border p-3"
                        >
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="secondary"
                              disabled={fallbackIndex === 0}
                              onClick={() => {
                                const fallbacks = clone(item.fallbacks);
                                const [moving] = fallbacks.splice(
                                  fallbackIndex,
                                  1,
                                );
                                if (moving !== undefined) {
                                  fallbacks.splice(
                                    fallbackIndex - 1,
                                    0,
                                    moving,
                                  );
                                }
                                updateItem(index, { ...item, fallbacks });
                              }}
                            >
                              ↑
                            </Button>
                            <Button
                              variant="secondary"
                              disabled={
                                fallbackIndex === item.fallbacks.length - 1
                              }
                              onClick={() => {
                                const fallbacks = clone(item.fallbacks);
                                const [moving] = fallbacks.splice(
                                  fallbackIndex,
                                  1,
                                );
                                if (moving !== undefined) {
                                  fallbacks.splice(
                                    fallbackIndex + 1,
                                    0,
                                    moving,
                                  );
                                }
                                updateItem(index, { ...item, fallbacks });
                              }}
                            >
                              ↓
                            </Button>
                            <Button
                              variant="danger"
                              onClick={() => {
                                updateItem(index, {
                                  ...item,
                                  fallbacks: item.fallbacks.filter(
                                    (_, candidateIndex) =>
                                      candidateIndex !== fallbackIndex,
                                  ),
                                });
                              }}
                            >
                              Șterge fallback
                            </Button>
                          </div>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2">
                            <label className={labelClass}>
                              Descriere
                              <input
                                className={fieldClass}
                                value={fallback.humanDescription}
                                onChange={(event) => {
                                  const fallbacks = clone(item.fallbacks);
                                  fallbacks[fallbackIndex] = {
                                    ...fallback,
                                    humanDescription: event.target.value,
                                  };
                                  updateItem(index, { ...item, fallbacks });
                                }}
                              />
                            </label>
                            <label className={labelClass}>
                              De ce?
                              <input
                                className={fieldClass}
                                value={fallback.whyExplanation}
                                onChange={(event) => {
                                  const fallbacks = clone(item.fallbacks);
                                  fallbacks[fallbackIndex] = {
                                    ...fallback,
                                    whyExplanation: event.target.value,
                                  };
                                  updateItem(index, { ...item, fallbacks });
                                }}
                              />
                            </label>
                          </div>
                          <LocatorEditor
                            label={`Locator fallback ${fallbackIndex + 1}`}
                            locator={fallback.locator}
                            onChange={(locator) => {
                              const fallbacks = clone(item.fallbacks);
                              fallbacks[fallbackIndex] = {
                                ...fallback,
                                locator,
                              };
                              updateItem(index, { ...item, fallbacks });
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                {item.type === "check" && "target" in item.config ? (
                  <LocatorEditor
                    label="Locator verificare"
                    locator={item.config.target}
                    onChange={(target) => {
                      updateItem(index, {
                        ...item,
                        config: { ...item.config, target },
                      });
                    }}
                  />
                ) : null}

                {item.type === "breakpoint" ||
                item.type === "manual_intervention" ? (
                  <label className={`${labelClass} mt-3`}>
                    Instrucțiuni
                    <textarea
                      className={fieldClass}
                      value={item.instructions ?? ""}
                      onChange={(event) => {
                        updateItem(index, {
                          ...item,
                          instructions: event.target.value,
                        });
                      }}
                    />
                  </label>
                ) : null}

                <details className="mt-3 rounded-lg bg-app-canvas p-3">
                  <summary className="cursor-pointer text-sm font-semibold">
                    Preview tehnic și descriere procedurală
                  </summary>
                  <p className="mt-3 text-sm">
                    {createProceduralDescription(item)}
                  </p>
                  <pre className="mt-3 max-h-72 overflow-auto rounded-lg bg-slate-950 p-3 text-xs text-slate-100">
                    {JSON.stringify(item, null, 2)}
                  </pre>
                </details>
                {itemIssues.length > 0 ? (
                  <p className="mt-3 text-xs text-red-700">
                    {itemIssues.map((issue) => issue.message).join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      <div className="mt-5 border-t border-app-border pt-4">
        <h4 className="text-sm font-semibold">Versiuni salvate</h4>
        {versions.length === 0 ? (
          <p className="mt-1 text-xs text-app-muted">
            Prima versiune va fi creată la salvarea flow-ului.
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2 text-xs">
            {versions.map((version) => (
              <li
                key={version.id}
                className="rounded-full border border-app-border bg-app-surface px-3 py-1"
                title={version.snapshotFilePath}
              >
                v{version.versionNumber} · {version.source}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
};
