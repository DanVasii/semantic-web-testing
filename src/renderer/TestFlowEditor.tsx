import { useEffect, useMemo, useRef, useState } from "react";

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
  type AdaptiveCheckConfig,
  type CheckStep,
  type JsonCheckValue,
  type JsEvalCheckConfig,
  type LocatorDefinition,
  type MysqlCheckConfig,
  type TestFlowItem,
  type VisualInteractionRegion,
  type VisualCheckConfig,
} from "../shared/test-model.js";
import type { VisualStepContextCapture } from "../shared/runner.js";
import { validateDeclarativeTest } from "../shared/test-validation.js";
import { AiStepEditorModal } from "./AiStepEditorModal.js";
import { AiStepCreatorModal } from "./AiStepCreatorModal.js";
import { Button } from "./components/Button.js";
import { Dropdown } from "./components/Dropdown.js";
import { locatorConsoleSnippet } from "./locator-console-snippet.js";
import { VisualRegionCaptureModal } from "./VisualRegionCaptureModal.js";

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const createId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `step-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const fieldClass =
  "mt-1 min-h-10 w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm focus:border-brand-500 focus:outline-none";
const labelClass = "block text-xs font-semibold text-app-muted";
const DATA_INPUT_ACTION_TYPES = new Set<ActionStep["actionType"]>([
  "fill",
  "upload_file",
  "select_option",
  "check",
  "uncheck",
]);

const URL_ACTION_TYPES = new Set<ActionStep["actionType"]>([
  "navigate",
  "wait_for_url",
]);

const isGooglePayClick = (item: ActionStep): boolean =>
  item.actionType === "click" &&
  /google\s*pay|\bgpay\b/i.test(
    JSON.stringify({
      title: item.title,
      humanDescription: item.humanDescription,
      target: item.target,
    }),
  );

const flowItemKindLabel = (item: TestFlowItem): string => {
  if (item.type === "action") return `Acțiune · ${item.actionType}`;
  if (item.type === "check") return `Verificare · ${item.checkType}`;
  if (item.type === "breakpoint") return "Breakpoint";
  return "Intervenție manuală";
};

const flowItemTitle = (item: TestFlowItem, index: number): string =>
  ("title" in item && item.title?.trim()) || `Pas ${index + 1}`;

const flowItemShortDescription = (item: TestFlowItem): string | undefined => {
  if ("humanDescription" in item && item.humanDescription.trim()) {
    return item.humanDescription;
  }
  if (
    (item.type === "breakpoint" || item.type === "manual_intervention") &&
    item.instructions?.trim()
  ) {
    return item.instructions;
  }
  return undefined;
};

interface MySqlCheckEditorProps {
  api: SemanticAppApi;
  projectId: string;
  item: CheckStep;
  onChange: (item: CheckStep) => void;
}

const MySqlCheckEditor = ({
  api,
  projectId,
  item,
  onChange,
}: MySqlCheckEditorProps) => {
  const [schema, setSchema] =
    useState<Awaited<ReturnType<SemanticAppApi["loadMySqlSchema"]>>>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    let active = true;
    void api
      .loadMySqlSchema(projectId)
      .then((result) => {
        if (active) setSchema(result);
      })
      .catch((reason: unknown) => {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Schema MySQL nu a putut fi încărcată.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [api, projectId]);

  if (!("tableNames" in item.config) || !("identities" in item.config)) {
    return null;
  }

  const config: MysqlCheckConfig = item.config;
  const selected = new Set(config.tableNames);
  return (
    <fieldset className="mt-3 rounded-lg border border-app-border p-3">
      <legend className="px-1 text-xs font-semibold">
        Tabele incluse în check
      </legend>
      <p className="text-xs text-app-muted">
        Baseline-ul complet este capturat o singură dată înainte de primul pas.
        Fiecare check recitește integral tabelele bifate.
      </p>
      {error ? (
        <p className="mt-2 text-xs text-red-700" role="alert">
          {error}
        </p>
      ) : schema === undefined ? (
        <p className="mt-2 text-xs text-app-muted">Se încarcă schema...</p>
      ) : (
        <div className="mt-3 grid gap-2">
          {schema.tables.map((table) => {
            const unavailable = table.identityColumns.length === 0;
            return (
              <label
                key={table.name}
                className="flex items-start gap-3 rounded-lg border border-app-border bg-app-surface p-3 text-sm"
              >
                <input
                  type="checkbox"
                  className="mt-1"
                  disabled={unavailable}
                  checked={selected.has(table.name)}
                  onChange={(event) => {
                    const tableNames = event.target.checked
                      ? [...config.tableNames, table.name]
                      : config.tableNames.filter((name) => name !== table.name);
                    const identities = event.target.checked
                      ? [
                          ...config.identities.filter(
                            (identity) => identity.tableName !== table.name,
                          ),
                          {
                            tableName: table.name,
                            columns: [...table.identityColumns],
                          },
                        ]
                      : config.identities.filter(
                          (identity) => identity.tableName !== table.name,
                        );
                    onChange({
                      ...item,
                      config: { tableNames, identities },
                    });
                  }}
                />
                <span>
                  <span className="font-semibold">{table.name}</span>
                  <span className="mt-1 block text-xs text-app-muted">
                    {unavailable
                      ? "Configurează identity columns în secțiunea MySQL a proiectului."
                      : `Identitate AND: ${table.identityColumns.join(" + ")}`}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
};

interface LocatorEditorProps {
  locator: LocatorDefinition;
  onChange: (locator: LocatorDefinition) => void;
  label?: string;
  depth?: number;
  frameOrigin?: string | undefined;
}

const LocatorEditor = ({
  depth = 0,
  frameOrigin,
  label = "Locator",
  locator,
  onChange,
}: LocatorEditorProps) => {
  const [copyStatus, setCopyStatus] = useState<"copied" | "error">();
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

  const copyConsoleSnippet = async (): Promise<void> => {
    try {
      if (navigator.clipboard === undefined) {
        throw new Error("Clipboard indisponibil");
      }
      await navigator.clipboard.writeText(
        locatorConsoleSnippet(locator, { frameOrigin }),
      );
      setCopyStatus("copied");
    } catch {
      setCopyStatus("error");
    }
  };

  return (
    <fieldset className="mt-3 rounded-lg border border-app-border p-3">
      <legend className="px-1 text-xs font-semibold">{label}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <label className={`${labelClass} min-w-44 flex-1`}>
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
        {copyStatus === "copied" ? (
          <span className="pb-2 text-xs font-medium text-emerald-700">
            Copiat
          </span>
        ) : copyStatus === "error" ? (
          <span className="pb-2 text-xs font-medium text-red-700">
            Copiere eșuată
          </span>
        ) : null}
        <Button
          variant="secondary"
          onClick={() => {
            void copyConsoleSnippet();
          }}
        >
          Copiază JS
        </Button>
      </div>

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
                frameOrigin={frameOrigin}
                label="Ancoră"
                locator={locator.anchor}
                onChange={(anchor) => {
                  onChange({ ...locator, anchor });
                }}
              />
              <LocatorEditor
                depth={depth + 1}
                frameOrigin={frameOrigin}
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
                frameOrigin={frameOrigin}
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
                    frameOrigin={frameOrigin}
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
                frameOrigin={frameOrigin}
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
  saveFlow?: (flowItems: TestFlowItem[]) => Promise<TestDefinition>;
  availableVariableNames?: string[];
}

export const TestFlowEditor = ({
  api,
  availableVariableNames = [],
  onTestSaved,
  projectId,
  saveFlow,
  test,
}: TestFlowEditorProps) => {
  const [items, setItems] = useState<TestFlowItem[]>(() =>
    clone(test.flowItems),
  );
  const [history, setHistory] = useState<TestFlowItem[][]>([]);
  const [addType, setAddType] = useState<TestFlowItem["type"]>("action");
  const [addMethod, setAddMethod] = useState<"manual" | "ai">("manual");
  const [aiCreate, setAiCreate] = useState<{
    stepId: string;
    stepType: "action" | "check";
  }>();
  const [draggedIndex, setDraggedIndex] = useState<number>();
  const [isSaving, setIsSaving] = useState(false);
  const [isUndoingAi, setIsUndoingAi] = useState(false);
  const [saveError, setSaveError] = useState<string>();
  const [dirty, setDirty] = useState(false);
  const [versions, setVersions] = useState<TestVersion[]>([]);
  const [aiStep, setAiStep] = useState<TestFlowItem>();
  const [lastAiVersion, setLastAiVersion] = useState<number>();
  const [selectedItemId, setSelectedItemId] = useState<string | undefined>(
    test.flowItems[0]?.id,
  );
  const [selectedRevealIndex, setSelectedRevealIndex] = useState(0);
  const [selectedFallbackIndex, setSelectedFallbackIndex] = useState(0);
  const [datasetVariableNames, setDatasetVariableNames] = useState<string[]>(
    [],
  );
  const [visualCapture, setVisualCapture] = useState<{
    itemIndex: number;
    capture: VisualStepContextCapture;
  }>();
  const [capturingVisualStepId, setCapturingVisualStepId] = useState<string>();
  const urlInputRefs = useRef(new Map<string, HTMLInputElement>());
  const activeUrlInputId = useRef<string | undefined>(undefined);

  useEffect(() => {
    setItems(clone(test.flowItems));
    setSelectedItemId(test.flowItems[0]?.id);
    setHistory([]);
    setDirty(false);
  }, [test.id, test.version, test.flowItems]);

  useEffect(() => {
    setSelectedItemId((current) =>
      current !== undefined && items.some(({ id }) => id === current)
        ? current
        : items[0]?.id,
    );
  }, [items]);

  useEffect(() => {
    setSelectedRevealIndex(0);
    setSelectedFallbackIndex(0);
  }, [selectedItemId]);

  useEffect(() => {
    void api
      .listTestVersions(projectId, test.id)
      .then(setVersions)
      .catch(() => {
        setVersions([]);
      });
  }, [api, projectId, test.id, test.version]);

  useEffect(() => {
    let active = true;
    if (typeof api.listDatasets !== "function") {
      setDatasetVariableNames([]);
      return () => {
        active = false;
      };
    }
    void api
      .listDatasets(projectId, test.id)
      .then((datasets) => {
        if (!active) return;
        setDatasetVariableNames(
          [
            ...new Set(datasets.flatMap(({ values }) => Object.keys(values))),
          ].sort(),
        );
      })
      .catch(() => {
        if (active) setDatasetVariableNames([]);
      });
    return () => {
      active = false;
    };
  }, [api, projectId, test.id, test.version]);

  const urlVariableNames = useMemo(
    () => [
      ...new Set([
        "baseUrl",
        "runId",
        "testId",
        "startedAt",
        ...availableVariableNames,
        ...datasetVariableNames,
      ]),
    ],
    [availableVariableNames, datasetVariableNames],
  );

  const validation = useMemo(
    () => validateDeclarativeTest(toDeclarativeTestDefinition(test, items, [])),
    [items, test],
  );
  const requiresRecordedFlowApproval = test.workflowState === "flow_analyzed";
  const canSave =
    validation.valid && !isSaving && (dirty || requiresRecordedFlowApproval);

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

  const insertUrlVariable = (
    index: number,
    item: ActionStep,
    variableName: string,
  ): void => {
    const input = urlInputRefs.current.get(item.id);
    const current = item.url ?? "";
    const inputHasCursor =
      input !== undefined && activeUrlInputId.current === item.id;
    const start = inputHasCursor
      ? (input.selectionStart ?? current.length)
      : current.length;
    const end = inputHasCursor ? (input.selectionEnd ?? start) : start;
    const token = `{{${variableName}}}`;
    updateItem(index, {
      ...item,
      url: `${current.slice(0, start)}${token}${current.slice(end)}`,
    });
    requestAnimationFrame(() => {
      const nextInput = urlInputRefs.current.get(item.id);
      const cursor = start + token.length;
      nextInput?.focus();
      nextInput?.setSelectionRange(cursor, cursor);
    });
  };

  const saveVisualRegion = (
    itemIndex: number,
    region: VisualInteractionRegion,
  ): void => {
    const item = items[itemIndex];
    if (item?.type !== "action" || item.actionType !== "visual_ai") return;
    updateItem(itemIndex, { ...item, visualRegion: region });
    setVisualCapture(undefined);
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
      const saved = await (saveFlow === undefined
        ? api.saveTestFlow(projectId, test.id, items)
        : saveFlow(items));
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

  const undoLocalChange = (): void => {
    const previous = history.at(-1);
    if (previous === undefined) return;
    setItems(previous);
    setHistory((current) => current.slice(0, -1));
    setDirty(true);
  };

  const undoAiChange = (): void => {
    if (lastAiVersion === undefined) return;
    setIsUndoingAi(true);
    setSaveError(undefined);
    void api
      .undoAiStepChange({
        projectId,
        testId: test.id,
        aiVersion: lastAiVersion,
      })
      .then(async (restored) => {
        setLastAiVersion(undefined);
        onTestSaved(restored);
        setVersions(await api.listTestVersions(projectId, test.id));
      })
      .catch((error: unknown) => {
        setSaveError(
          error instanceof Error
            ? error.message
            : "Modificarea AI nu a putut fi anulată.",
        );
      })
      .finally(() => {
        setIsUndoingAi(false);
      });
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
          <Dropdown
            align="right"
            compact
            label={isUndoingAi ? "Se revine..." : "Istoric"}
            items={[
              {
                id: "undo-local",
                label: "Anulează ultima modificare",
                disabled: history.length === 0,
                onSelect: undoLocalChange,
              },
              {
                id: "undo-ai",
                label: "Anulează ultima schimbare AI",
                disabled:
                  lastAiVersion === undefined ||
                  lastAiVersion !== test.version ||
                  isUndoingAi,
                onSelect: undoAiChange,
              },
            ]}
          />
          <Button
            aria-label="Salvează flow-ul testului"
            disabled={!canSave}
            onClick={() => {
              void save();
            }}
          >
            {isSaving
              ? "Se salvează..."
              : requiresRecordedFlowApproval
                ? "Aprobă și pregătește testul"
                : "Salvează testul"}
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
        <label className={labelClass}>
          Metodă
          <select
            className={fieldClass}
            value={addMethod}
            disabled={
              addType === "breakpoint" || addType === "manual_intervention"
            }
            onChange={(event) => {
              setAddMethod(event.target.value as "manual" | "ai");
            }}
          >
            <option value="manual">Configurare manuală</option>
            <option value="ai">Descriere pentru AI</option>
          </select>
        </label>
        <Button
          onClick={() => {
            const stepId = createId();
            if (
              addMethod === "ai" &&
              (addType === "action" || addType === "check")
            ) {
              setAiCreate({ stepId, stepType: addType });
              return;
            }
            const nextItem = createFlowItem(addType, stepId);
            mutate([...items, nextItem]);
            setSelectedItemId(nextItem.id);
          }}
        >
          {addMethod === "ai" && (addType === "action" || addType === "check")
            ? "+ Descrie pasul pentru AI"
            : "+ Adaugă pas"}
        </Button>
      </div>
      {test.testMode === "recorded" ? (
        <p className="mt-3 rounded-lg border border-app-border bg-app-surface p-3 text-xs text-app-muted">
          Test înregistrat: runnerul urmează exact pașii, iar editarea AI este
          dezactivată. Poți schimba tipul testului din „Editează testul”.
        </p>
      ) : (
        <p className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3 text-xs text-brand-800">
          Test dinamic: poți deschide AI pe un pas salvat. Trimiterea rămâne
          manuală și explicită.
        </p>
      )}

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
          {requiresRecordedFlowApproval
            ? "Flow-ul înregistrat este valid. Verifică pașii de mai jos, apoi apasă „Aprobă și pregătește testul”. Nu trebuie să modifici un pas dacă este deja corect."
            : dirty
              ? "Flow valid. Poate fi salvat."
              : "Flow valid. Nu există modificări nesalvate."}
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
        <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(210px,0.5fr)_minmax(0,1.8fr)]">
          <nav
            className="max-h-[76vh] min-w-0 overflow-x-hidden overflow-y-auto rounded-xl border border-app-border bg-white p-2 lg:sticky lg:top-4"
            aria-label="Pașii testului"
          >
            <div className="flex items-start justify-between gap-2 px-2 py-2">
              <div>
                <p className="text-xs font-semibold tracking-wide text-brand-700 uppercase">
                  Pași
                </p>
                <p className="mt-1 text-xs text-app-muted">
                  Click pentru detalii
                </p>
              </div>
              <span className="rounded-full bg-app-canvas px-2 py-0.5 text-[11px] font-semibold text-app-muted">
                {items.length}
              </span>
            </div>
            <ol className="mt-1 grid min-w-0 gap-1">
              {items.map((item, index) => {
                const selected = item.id === selectedItemId;
                const description = flowItemShortDescription(item);
                return (
                  <li
                    key={item.id}
                    className="min-w-0 overflow-hidden"
                    draggable
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
                    <button
                      type="button"
                      className={`min-w-0 w-full overflow-hidden rounded-lg border px-2.5 py-2 text-left transition ${
                        selected
                          ? "border-brand-500 bg-brand-50 shadow-sm"
                          : "border-transparent bg-slate-50 hover:border-app-border hover:bg-white"
                      }`}
                      aria-label={`${index + 1}. ${flowItemKindLabel(item)} · ${flowItemTitle(item, index)}`}
                      aria-current={selected ? "step" : undefined}
                      title={description}
                      onClick={() => {
                        setSelectedItemId(item.id);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white text-[11px] font-bold text-brand-700">
                          {index + 1}
                        </span>
                        <span className="min-w-0 flex-1">
                          <strong className="block truncate text-sm text-app-ink">
                            {flowItemTitle(item, index)}
                          </strong>
                          <span className="block truncate text-[10px] font-semibold tracking-wide text-app-muted uppercase">
                            {flowItemKindLabel(item)}
                          </span>
                        </span>
                        {!item.enabled ? (
                          <span className="text-[10px] text-app-muted">
                            Oprit
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
          </nav>
          <ol className="min-w-0">
            {items.map((item, index) => {
              if (item.id !== selectedItemId) return null;
              const itemIssues = validation.valid
                ? []
                : validation.issues.filter((issue) =>
                    issue.path.startsWith(`$.flowItems[${index}]`),
                  );
              const activeRevealIndex =
                item.type === "action" && item.revealBefore?.length
                  ? Math.min(selectedRevealIndex, item.revealBefore.length - 1)
                  : -1;
              const activeFallbackIndex =
                item.type === "action" && item.fallbacks.length > 0
                  ? Math.min(selectedFallbackIndex, item.fallbacks.length - 1)
                  : -1;
              return (
                <li
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-app-border bg-app-surface shadow-sm"
                >
                  <div className="flex flex-wrap items-center justify-between gap-3 border-b border-app-border bg-app-canvas px-3 py-2.5">
                    <div className="flex items-center gap-3">
                      <span
                        className="text-app-muted"
                        title="Reordonează din lista din stânga"
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
                      {test.testMode === "dynamic_ai" ? (
                        <Button
                          variant="secondary"
                          size="compact"
                          disabled={dirty}
                          title={
                            dirty
                              ? "Salvează sau anulează modificările locale înainte de AI."
                              : "Deschide chat-ul contextual pentru acest pas."
                          }
                          onClick={() => {
                            setAiStep(item);
                          }}
                        >
                          Editează cu AI
                        </Button>
                      ) : null}
                      <Dropdown
                        align="right"
                        compact
                        label="Acțiuni pas"
                        items={[
                          {
                            id: "move-step-up",
                            label: "Mută pasul în sus",
                            disabled: index === 0,
                            onSelect: () => moveItem(index, index - 1),
                          },
                          {
                            id: "move-step-down",
                            label: "Mută pasul în jos",
                            disabled: index === items.length - 1,
                            onSelect: () => moveItem(index, index + 1),
                          },
                          {
                            id: "duplicate-step",
                            label: "Duplică pasul",
                            onSelect: () => {
                              const duplicate = clone(item);
                              duplicate.id = createId();
                              const next = [...items];
                              next.splice(index + 1, 0, duplicate);
                              mutate(next);
                              setSelectedItemId(duplicate.id);
                            },
                          },
                          {
                            id: "delete-step",
                            label: "Șterge pasul",
                            tone: "danger",
                            onSelect: () => {
                              mutate(
                                items.filter(
                                  (_, itemIndex) => itemIndex !== index,
                                ),
                              );
                            },
                          },
                        ]}
                      />
                    </div>
                  </div>

                  <div className="grid items-stretch gap-x-3 px-3 pb-3 xl:grid-cols-2">
                    {"title" in item ? (
                      <section
                        className="mt-3 rounded-lg border border-app-border bg-app-canvas p-3 xl:col-span-2"
                        aria-label="Conținutul pasului"
                      >
                        <p className="text-[11px] font-semibold tracking-wide text-brand-700 uppercase">
                          Conținutul pasului
                        </p>
                        <div className="mt-2 grid gap-3 lg:grid-cols-3">
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
                                className={`${fieldClass} min-h-10 resize-y`}
                                rows={2}
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
                                className={`${fieldClass} min-h-10 resize-y`}
                                rows={2}
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
                      </section>
                    ) : null}

                    {item.type === "action" ? (
                      <>
                        <label
                          className={`${labelClass} mt-3 rounded-lg border border-app-border bg-app-canvas p-3`}
                        >
                          Tip acțiune
                          <select
                            className={fieldClass}
                            value={item.actionType}
                            onChange={(event) => {
                              const actionType = event.target
                                .value as ActionStep["actionType"];
                              const nextItem: ActionStep = {
                                ...item,
                                actionType,
                                ...(DATA_INPUT_ACTION_TYPES.has(actionType)
                                  ? { valueStrategy: "dataset" as const }
                                  : {}),
                              };
                              if (URL_ACTION_TYPES.has(actionType)) {
                                nextItem.url = item.url ?? "{{baseUrl}}";
                              } else {
                                delete nextItem.url;
                              }
                              if (actionType === "visual_ai") {
                                nextItem.visualInstruction =
                                  item.visualInstruction ?? "";
                              } else {
                                delete nextItem.visualInstruction;
                                delete nextItem.visualRegion;
                              }
                              updateItem(index, nextItem);
                            }}
                          >
                            {ACTION_TYPES.map((actionType) => (
                              <option key={actionType} value={actionType}>
                                {actionType === "visual_ai"
                                  ? "Acțiune vizuală AI"
                                  : actionType}
                              </option>
                            ))}
                          </select>
                        </label>
                        {DATA_INPUT_ACTION_TYPES.has(item.actionType) ? (
                          <div className="mt-3 grid gap-3 rounded-lg border border-app-border bg-app-canvas p-3 sm:grid-cols-2">
                            <label className={labelClass}>
                              ID semantic câmp
                              <input
                                className={fieldClass}
                                value={item.inputFieldId ?? ""}
                                placeholder="ex. customer_email"
                                onChange={(event) => {
                                  const previousFieldId = item.inputFieldId;
                                  const inputFieldId =
                                    event.target.value.trim() || undefined;
                                  const nextValueKey =
                                    item.valueKey === undefined ||
                                    item.valueKey === previousFieldId
                                      ? inputFieldId
                                      : item.valueKey;
                                  const nextItem: ActionStep = { ...item };
                                  delete nextItem.inputFieldId;
                                  delete nextItem.valueKey;
                                  if (inputFieldId !== undefined) {
                                    nextItem.inputFieldId = inputFieldId;
                                  }
                                  if (nextValueKey !== undefined) {
                                    nextItem.valueKey = nextValueKey;
                                  }
                                  nextItem.valueStrategy = "dataset";
                                  if (item.target !== undefined) {
                                    nextItem.target = { ...item.target };
                                    delete nextItem.target.fieldId;
                                    if (inputFieldId !== undefined) {
                                      nextItem.target.fieldId = inputFieldId;
                                    }
                                  }
                                  updateItem(index, nextItem);
                                }}
                              />
                            </label>
                            <label className={labelClass}>
                              Cheie dataset
                              <input
                                className={fieldClass}
                                value={item.valueKey ?? ""}
                                placeholder="ex. customer_email"
                                onChange={(event) => {
                                  const valueKey =
                                    event.target.value.trim() || undefined;
                                  const nextItem: ActionStep = { ...item };
                                  delete nextItem.valueKey;
                                  if (valueKey !== undefined) {
                                    nextItem.valueKey = valueKey;
                                  }
                                  nextItem.valueStrategy = "dataset";
                                  updateItem(index, nextItem);
                                }}
                              />
                            </label>
                            <p className="text-xs text-app-muted sm:col-span-2">
                              Valoarea este citită din datasetul rulării. Dacă
                              cheia lipsește, rularea se oprește pentru
                              completare manuală în browser.
                            </p>
                          </div>
                        ) : null}
                        {URL_ACTION_TYPES.has(item.actionType) ? (
                          <div className="mt-3 rounded-lg border border-app-border bg-app-canvas p-3">
                            <label className={labelClass}>
                              URL sau template
                              <input
                                ref={(element) => {
                                  if (element === null) {
                                    urlInputRefs.current.delete(item.id);
                                  } else {
                                    urlInputRefs.current.set(item.id, element);
                                  }
                                }}
                                className={fieldClass}
                                value={item.url ?? ""}
                                placeholder="{{baseUrl}}/comenzi/{{order_id}}"
                                onBlur={() => {
                                  if (activeUrlInputId.current === item.id) {
                                    activeUrlInputId.current = undefined;
                                  }
                                }}
                                onFocus={() => {
                                  activeUrlInputId.current = item.id;
                                }}
                                onChange={(event) => {
                                  updateItem(index, {
                                    ...item,
                                    url: event.target.value,
                                  });
                                }}
                              />
                            </label>
                            <div className="mt-3">
                              <p className="text-xs font-semibold text-app-muted">
                                Variabile disponibile
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                {urlVariableNames.map((variableName) => (
                                  <button
                                    key={variableName}
                                    type="button"
                                    className="rounded-full border border-app-border bg-app-surface px-2.5 py-1 font-mono text-xs text-app-ink hover:border-brand-500 hover:bg-brand-50"
                                    onMouseDown={(event) =>
                                      event.preventDefault()
                                    }
                                    onClick={() =>
                                      insertUrlVariable(
                                        index,
                                        item,
                                        variableName,
                                      )
                                    }
                                  >
                                    {`{{${variableName}}}`}
                                  </button>
                                ))}
                              </div>
                            </div>
                            <p className="mt-2 text-xs text-app-muted">
                              Poți folosi un URL complet, un URL primit dintr-un
                              pas anterior (de exemplu {"{{payment_url}}"}) sau
                              un template precum
                              {" {{baseUrl}}/comenzi/{{order_id}}"}.
                            </p>
                          </div>
                        ) : null}
                        {isGooglePayClick(item) ? (
                          <div className="mt-3 grid gap-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                            <label className={labelClass}>
                              Card Google Pay TEST dorit
                              <textarea
                                className={`${fieldClass} min-h-20 resize-y`}
                                rows={3}
                                value={item.googlePayCardDescription ?? ""}
                                placeholder="Ex.: Alege cardul Visa care produce eroarea Incorrect CVC."
                                onChange={(event) =>
                                  updateItem(index, {
                                    ...item,
                                    googlePayCardDescription:
                                      event.target.value,
                                  })
                                }
                              />
                            </label>
                            <p className="text-xs text-blue-900">
                              Când acest câmp este completat, runner-ul
                              detectează automat sheet-ul Google Pay, deschide
                              lista, folosește AI pentru alegerea cardului
                              descris și apasă „Plătește acum”. Flow-ul este
                              permis numai dacă sheet-ul indică explicit mediul
                              de testare.
                            </p>
                          </div>
                        ) : null}
                        {item.actionType === "visual_ai" ? (
                          <div className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-violet-50 p-3">
                            <label className={labelClass}>
                              Ce trebuie să facă AI-ul
                              <textarea
                                className={`${fieldClass} min-h-24 resize-y`}
                                rows={4}
                                value={item.visualInstruction ?? ""}
                                placeholder="Ex.: Selectează prima dată disponibilă din luna următoare și oprește-te când apar fotografiile în dreapta."
                                onChange={(event) =>
                                  updateItem(index, {
                                    ...item,
                                    visualInstruction: event.target.value,
                                  })
                                }
                              />
                            </label>
                            <p className="text-xs text-violet-900">
                              La rulare, AI-ul primește doar zona selectată,
                              poate da cel mult 5 clickuri și verifică din nou
                              imaginea după fiecare click.
                            </p>
                            <div className="flex flex-wrap items-center gap-3">
                              <Button
                                variant="secondary"
                                disabled={capturingVisualStepId !== undefined}
                                onClick={() => {
                                  if (
                                    api.captureVisualStepContext === undefined
                                  ) {
                                    setSaveError(
                                      "Capturarea vizuală nu este disponibilă în această versiune a aplicației.",
                                    );
                                    return;
                                  }
                                  setCapturingVisualStepId(item.id);
                                  setSaveError(undefined);
                                  void api
                                    .captureVisualStepContext(
                                      projectId,
                                      test.id,
                                      item.id,
                                      items,
                                    )
                                    .then((capture) => {
                                      setVisualCapture({
                                        itemIndex: index,
                                        capture,
                                      });
                                    })
                                    .catch((error: unknown) => {
                                      setSaveError(
                                        error instanceof Error
                                          ? error.message
                                          : "Zona vizuală nu a putut fi capturată.",
                                      );
                                    })
                                    .finally(() => {
                                      setCapturingVisualStepId(undefined);
                                    });
                                }}
                              >
                                {capturingVisualStepId === item.id
                                  ? "Se rulează pașii anteriori…"
                                  : item.visualRegion === undefined
                                    ? "Capturează zona vizuală"
                                    : "Recapturează zona vizuală"}
                              </Button>
                              {item.visualRegion !== undefined ? (
                                <span className="text-xs font-semibold text-emerald-700">
                                  Zona este salvată
                                </span>
                              ) : (
                                <span className="text-xs text-app-muted">
                                  Opțional. Fără zonă, AI-ul vede întregul
                                  viewport.
                                </span>
                              )}
                            </div>
                            {item.visualRegion?.referenceImageBase64 !==
                            undefined ? (
                              <figure className="w-fit max-w-full rounded-lg border border-violet-200 bg-white p-2">
                                <img
                                  alt="Zona salvată pentru pasul vizual"
                                  className="max-h-44 max-w-full rounded"
                                  src={`data:image/jpeg;base64,${item.visualRegion.referenceImageBase64}`}
                                />
                                <figcaption className="mt-1 text-xs text-app-muted">
                                  Exact această zonă va fi trimisă către AI.
                                </figcaption>
                              </figure>
                            ) : null}
                          </div>
                        ) : null}
                        {!URL_ACTION_TYPES.has(item.actionType) &&
                        item.actionType !== "visual_ai" ? (
                          <>
                            {item.target !== undefined ? (
                              <div className="min-w-0">
                                {item.target.frame !== undefined ? (
                                  <p className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900">
                                    Context iframe: {item.target.frame.origin}
                                  </p>
                                ) : null}
                                <LocatorEditor
                                  frameOrigin={item.target.frame?.origin}
                                  label="Locator principal"
                                  locator={item.target.primary}
                                  onChange={(primary) => {
                                    updateItem(index, {
                                      ...item,
                                      target: { ...item.target, primary },
                                    });
                                  }}
                                />
                              </div>
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
                            {item.revealBefore &&
                            item.revealBefore.length > 0 ? (
                              <section className="mt-3 rounded-lg border border-brand-200 bg-brand-50 p-3">
                                <div className="flex flex-wrap items-start justify-between gap-2">
                                  <div>
                                    <h4 className="text-sm font-semibold text-brand-900">
                                      Pregătire automată
                                    </h4>
                                    <p className="mt-0.5 text-xs text-brand-800">
                                      Hover doar dacă ținta nu este vizibilă.
                                    </p>
                                  </div>
                                  <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-brand-800">
                                    {item.revealBefore.length} candidați
                                  </span>
                                </div>
                                <div
                                  className="mt-2 flex gap-1 overflow-x-auto pb-1"
                                  role="tablist"
                                  aria-label="Candidați pregătire automată"
                                >
                                  {item.revealBefore.map(
                                    (_, preparationIndex) => (
                                      <button
                                        key={preparationIndex}
                                        type="button"
                                        role="tab"
                                        aria-selected={
                                          preparationIndex === activeRevealIndex
                                        }
                                        className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                          preparationIndex === activeRevealIndex
                                            ? "border-brand-500 bg-white text-brand-900"
                                            : "border-brand-200 bg-brand-100 text-brand-800"
                                        }`}
                                        onClick={() =>
                                          setSelectedRevealIndex(
                                            preparationIndex,
                                          )
                                        }
                                      >
                                        Hover {preparationIndex + 1}
                                      </button>
                                    ),
                                  )}
                                </div>
                                {activeRevealIndex >= 0 ? (
                                  <div className="mt-2 rounded-lg border border-brand-200 bg-app-surface p-2.5">
                                    <div className="flex justify-end">
                                      <Button
                                        variant="secondary"
                                        onClick={() => {
                                          updateItem(index, {
                                            ...item,
                                            revealBefore:
                                              item.revealBefore!.filter(
                                                (_, candidateIndex) =>
                                                  candidateIndex !==
                                                  activeRevealIndex,
                                              ),
                                          });
                                          setSelectedRevealIndex((current) =>
                                            Math.max(0, current - 1),
                                          );
                                        }}
                                      >
                                        Elimină hover
                                      </Button>
                                    </div>
                                    <LocatorEditor
                                      frameOrigin={
                                        item.revealBefore[activeRevealIndex]
                                          ?.target.frame?.origin
                                      }
                                      label={`Locator hover ${activeRevealIndex + 1}`}
                                      locator={
                                        item.revealBefore[activeRevealIndex]!
                                          .target.primary
                                      }
                                      onChange={(primary) => {
                                        updateItem(index, {
                                          ...item,
                                          revealBefore: item.revealBefore!.map(
                                            (candidate, candidateIndex) =>
                                              candidateIndex ===
                                              activeRevealIndex
                                                ? {
                                                    ...candidate,
                                                    target: {
                                                      ...candidate.target,
                                                      primary,
                                                    },
                                                  }
                                                : candidate,
                                          ),
                                        });
                                      }}
                                    />
                                  </div>
                                ) : null}
                              </section>
                            ) : null}
                            <div className="mt-3 rounded-lg border border-app-border bg-app-canvas p-3">
                              <div className="flex items-center justify-between gap-2">
                                <h4 className="text-sm font-semibold">
                                  Fallback-uri ({item.fallbacks.length}/3)
                                </h4>
                                <Button
                                  variant="secondary"
                                  disabled={item.fallbacks.length >= 3}
                                  onClick={() => {
                                    setSelectedFallbackIndex(
                                      item.fallbacks.length,
                                    );
                                    updateItem(index, {
                                      ...item,
                                      fallbacks: [
                                        ...item.fallbacks,
                                        {
                                          locator: createSimpleLocator(),
                                          humanDescription:
                                            "Locator alternativ",
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
                              {item.fallbacks.length > 0 ? (
                                <div
                                  className="mt-2 flex gap-1 overflow-x-auto pb-1"
                                  role="tablist"
                                  aria-label="Fallback-uri locator"
                                >
                                  {item.fallbacks.map(
                                    (fallback, fallbackIndex) => (
                                      <button
                                        key={fallbackIndex}
                                        type="button"
                                        role="tab"
                                        aria-selected={
                                          fallbackIndex === activeFallbackIndex
                                        }
                                        className={`max-w-40 shrink-0 truncate rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                          fallbackIndex === activeFallbackIndex
                                            ? "border-brand-500 bg-white text-brand-900"
                                            : "border-app-border bg-slate-100 text-app-muted"
                                        }`}
                                        title={fallback.humanDescription}
                                        onClick={() =>
                                          setSelectedFallbackIndex(
                                            fallbackIndex,
                                          )
                                        }
                                      >
                                        {fallbackIndex + 1}.{" "}
                                        {fallback.humanDescription}
                                      </button>
                                    ),
                                  )}
                                </div>
                              ) : (
                                <p className="mt-2 text-xs text-app-muted">
                                  Niciun locator alternativ configurat.
                                </p>
                              )}
                              {activeFallbackIndex >= 0 ? (
                                <div className="mt-2 rounded-lg border border-app-border bg-app-surface p-2.5">
                                  <div className="flex flex-wrap justify-end gap-2">
                                    <Button
                                      variant="secondary"
                                      disabled={activeFallbackIndex === 0}
                                      onClick={() => {
                                        const fallbacks = clone(item.fallbacks);
                                        const [moving] = fallbacks.splice(
                                          activeFallbackIndex,
                                          1,
                                        );
                                        if (moving !== undefined) {
                                          fallbacks.splice(
                                            activeFallbackIndex - 1,
                                            0,
                                            moving,
                                          );
                                        }
                                        updateItem(index, {
                                          ...item,
                                          fallbacks,
                                        });
                                        setSelectedFallbackIndex(
                                          activeFallbackIndex - 1,
                                        );
                                      }}
                                    >
                                      ↑
                                    </Button>
                                    <Button
                                      variant="secondary"
                                      disabled={
                                        activeFallbackIndex ===
                                        item.fallbacks.length - 1
                                      }
                                      onClick={() => {
                                        const fallbacks = clone(item.fallbacks);
                                        const [moving] = fallbacks.splice(
                                          activeFallbackIndex,
                                          1,
                                        );
                                        if (moving !== undefined) {
                                          fallbacks.splice(
                                            activeFallbackIndex + 1,
                                            0,
                                            moving,
                                          );
                                        }
                                        updateItem(index, {
                                          ...item,
                                          fallbacks,
                                        });
                                        setSelectedFallbackIndex(
                                          activeFallbackIndex + 1,
                                        );
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
                                              candidateIndex !==
                                              activeFallbackIndex,
                                          ),
                                        });
                                        setSelectedFallbackIndex((current) =>
                                          Math.max(0, current - 1),
                                        );
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
                                        value={
                                          item.fallbacks[activeFallbackIndex]!
                                            .humanDescription
                                        }
                                        onChange={(event) => {
                                          const fallbacks = clone(
                                            item.fallbacks,
                                          );
                                          fallbacks[activeFallbackIndex] = {
                                            ...item.fallbacks[
                                              activeFallbackIndex
                                            ]!,
                                            humanDescription:
                                              event.target.value,
                                          };
                                          updateItem(index, {
                                            ...item,
                                            fallbacks,
                                          });
                                        }}
                                      />
                                    </label>
                                    <label className={labelClass}>
                                      De ce?
                                      <input
                                        className={fieldClass}
                                        value={
                                          item.fallbacks[activeFallbackIndex]!
                                            .whyExplanation
                                        }
                                        onChange={(event) => {
                                          const fallbacks = clone(
                                            item.fallbacks,
                                          );
                                          fallbacks[activeFallbackIndex] = {
                                            ...item.fallbacks[
                                              activeFallbackIndex
                                            ]!,
                                            whyExplanation: event.target.value,
                                          };
                                          updateItem(index, {
                                            ...item,
                                            fallbacks,
                                          });
                                        }}
                                      />
                                    </label>
                                  </div>
                                  <LocatorEditor
                                    frameOrigin={item.target?.frame?.origin}
                                    label={`Locator fallback ${activeFallbackIndex + 1}`}
                                    locator={
                                      item.fallbacks[activeFallbackIndex]!
                                        .locator
                                    }
                                    onChange={(locator) => {
                                      const fallbacks = clone(item.fallbacks);
                                      fallbacks[activeFallbackIndex] = {
                                        ...item.fallbacks[activeFallbackIndex]!,
                                        locator,
                                      };
                                      updateItem(index, { ...item, fallbacks });
                                    }}
                                  />
                                </div>
                              ) : null}
                            </div>
                          </>
                        ) : null}
                      </>
                    ) : null}

                    {item.type === "check" ? (
                      <label
                        className={`${labelClass} mt-3 rounded-lg border border-app-border bg-app-canvas p-3`}
                      >
                        Tip verificare
                        <select
                          className={fieldClass}
                          value={item.checkType}
                          onChange={(event) => {
                            const checkType = event.target
                              .value as CheckStep["checkType"];
                            const config =
                              checkType === "mysql"
                                ? { tableNames: [], identities: [] }
                                : checkType === "url"
                                  ? {
                                      operator: "contains" as const,
                                      value: "http",
                                    }
                                  : checkType === "text"
                                    ? {
                                        target: createSimpleLocator(),
                                        operator: "contains" as const,
                                        value: "text",
                                      }
                                    : checkType === "js_eval"
                                      ? {
                                          jsSnippet:
                                            "return { passed: true, message: 'Validat' };",
                                        }
                                      : checkType === "visual"
                                        ? {
                                            prompt:
                                              item.humanDescription ||
                                              "Verifică vizual rezultatul așteptat pe pagină.",
                                            minimumConfidence: 0.6,
                                          }
                                        : checkType === "adaptive"
                                          ? {
                                              strategy: "auto" as const,
                                              expectedTexts: [],
                                              matchMode: "any" as const,
                                              caseSensitive: false,
                                              ignoreDiacritics: true,
                                              visualPrompt:
                                                item.humanDescription ||
                                                "Verifică vizual rezultatul așteptat.",
                                              visualFallback: true,
                                              minimumConfidence: 0.6,
                                            }
                                          : {
                                              target: createSimpleLocator(),
                                              state: "visible" as const,
                                            };
                            updateItem(index, { ...item, checkType, config });
                          }}
                        >
                          <option value="element">Element</option>
                          <option value="text">Text</option>
                          <option value="url">URL</option>
                          <option value="js_eval">Evaluare JavaScript</option>
                          <option value="visual">Vizual cu AI</option>
                          <option value="adaptive">Adaptiv DOM → vizual</option>
                        </select>
                      </label>
                    ) : null}

                    {item.type === "check" &&
                    item.checkType === "visual" &&
                    "prompt" in item.config ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3 sm:grid-cols-[minmax(0,1fr)_10rem]">
                        <label className={labelClass}>
                          Ce trebuie confirmat în captură
                          <textarea
                            className={fieldClass}
                            rows={3}
                            value={item.config.prompt}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                config: {
                                  ...(item.config as VisualCheckConfig),
                                  prompt: event.target.value,
                                },
                              });
                            }}
                          />
                        </label>
                        <label className={labelClass}>
                          Încredere minimă
                          <input
                            className={fieldClass}
                            type="number"
                            min={0}
                            max={1}
                            step={0.05}
                            value={item.config.minimumConfidence ?? 0.6}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                config: {
                                  ...(item.config as VisualCheckConfig),
                                  minimumConfidence: Number(event.target.value),
                                },
                              });
                            }}
                          />
                        </label>
                        <p className="text-xs text-violet-800 sm:col-span-2">
                          La rulare se capturează întreaga pagină și imaginea
                          este trimisă providerului AI activ. Modelul selectat
                          trebuie să accepte imagini.
                        </p>
                      </div>
                    ) : null}

                    {item.type === "check" &&
                    item.checkType === "adaptive" &&
                    "strategy" in item.config ? (
                      <div className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50/60 p-3">
                        <div className="grid gap-3 sm:grid-cols-3">
                          <label className={labelClass}>
                            Strategie
                            <select
                              className={fieldClass}
                              value={item.config.strategy}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    strategy: event.target
                                      .value as AdaptiveCheckConfig["strategy"],
                                  },
                                });
                              }}
                            >
                              <option value="auto">Automat</option>
                              <option value="dom">DOM prioritar</option>
                              <option value="visual">Doar vizual</option>
                            </select>
                          </label>
                          <label className={labelClass}>
                            Potrivire mesaje
                            <select
                              className={fieldClass}
                              value={item.config.matchMode}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    matchMode: event.target
                                      .value as AdaptiveCheckConfig["matchMode"],
                                  },
                                });
                              }}
                            >
                              <option value="any">Oricare</option>
                              <option value="all">Toate</option>
                              <option value="exact">Text exact</option>
                            </select>
                          </label>
                          <label className={labelClass}>
                            Încredere vizuală
                            <input
                              className={fieldClass}
                              type="number"
                              min={0}
                              max={1}
                              step={0.05}
                              value={item.config.minimumConfidence ?? 0.6}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    minimumConfidence: Number(
                                      event.target.value,
                                    ),
                                  },
                                });
                              }}
                            />
                          </label>
                        </div>

                        <div className="mt-3 rounded-lg border border-cyan-200 bg-white/70 p-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-xs font-semibold text-app-muted">
                              Mesaje concrete acceptate
                            </span>
                            <Button
                              variant="secondary"
                              onClick={() => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    expectedTexts: [
                                      ...(item.config as AdaptiveCheckConfig)
                                        .expectedTexts,
                                      "",
                                    ],
                                  },
                                });
                              }}
                            >
                              + Mesaj
                            </Button>
                          </div>
                          {item.config.expectedTexts.length === 0 ? (
                            <p className="mt-2 text-xs text-app-muted">
                              Fără mesaje concrete, strategia Automat folosește
                              direct verificarea vizuală.
                            </p>
                          ) : (
                            <div className="mt-2 grid gap-2">
                              {item.config.expectedTexts.map(
                                (text, textIndex) => (
                                  <div
                                    key={`${item.id}-expected-${textIndex}`}
                                    className="flex gap-2"
                                  >
                                    <input
                                      aria-label={`Mesaj acceptat ${textIndex + 1}`}
                                      className={fieldClass}
                                      value={text}
                                      placeholder="Ex.: Telefon invalid"
                                      onChange={(event) => {
                                        const expectedTexts = [
                                          ...(
                                            item.config as AdaptiveCheckConfig
                                          ).expectedTexts,
                                        ];
                                        expectedTexts[textIndex] =
                                          event.target.value;
                                        updateItem(index, {
                                          ...item,
                                          config: {
                                            ...(item.config as AdaptiveCheckConfig),
                                            expectedTexts,
                                          },
                                        });
                                      }}
                                    />
                                    <Button
                                      variant="danger"
                                      onClick={() => {
                                        updateItem(index, {
                                          ...item,
                                          config: {
                                            ...(item.config as AdaptiveCheckConfig),
                                            expectedTexts: (
                                              item.config as AdaptiveCheckConfig
                                            ).expectedTexts.filter(
                                              (_, candidateIndex) =>
                                                candidateIndex !== textIndex,
                                            ),
                                          },
                                        });
                                      }}
                                    >
                                      Elimină
                                    </Button>
                                  </div>
                                ),
                              )}
                            </div>
                          )}
                        </div>

                        <label className={`${labelClass} mt-3`}>
                          Instrucțiune pentru fallback-ul vizual
                          <textarea
                            className={fieldClass}
                            rows={2}
                            value={item.config.visualPrompt ?? ""}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                config: {
                                  ...(item.config as AdaptiveCheckConfig),
                                  visualPrompt: event.target.value,
                                },
                              });
                            }}
                          />
                        </label>
                        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs font-semibold text-app-muted">
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.config.visualFallback}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    visualFallback: event.target.checked,
                                  },
                                });
                              }}
                            />
                            Fallback vizual dacă DOM nu confirmă
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.config.ignoreDiacritics ?? true}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    ignoreDiacritics: event.target.checked,
                                  },
                                });
                              }}
                            />
                            Ignoră diacriticele
                          </label>
                          <label className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={item.config.caseSensitive ?? false}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...(item.config as AdaptiveCheckConfig),
                                    caseSensitive: event.target.checked,
                                  },
                                });
                              }}
                            />
                            Majuscule exacte
                          </label>
                        </div>
                      </div>
                    ) : null}

                    {item.type === "check" && item.checkType === "mysql" ? (
                      <MySqlCheckEditor
                        api={api}
                        projectId={projectId}
                        item={item}
                        onChange={(nextItem) => {
                          updateItem(index, nextItem);
                        }}
                      />
                    ) : null}

                    {item.type === "check" &&
                    item.checkType === "js_eval" &&
                    "jsSnippet" in item.config ? (
                      <div className="mt-3 rounded-lg border border-app-border bg-app-canvas p-3">
                        <label className={labelClass}>
                          Evaluare JS (Snippet)
                          <textarea
                            className={`${fieldClass} font-mono text-xs`}
                            rows={5}
                            value={item.config.jsSnippet}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                config: {
                                  ...item.config,
                                  jsSnippet: event.target.value,
                                },
                              });
                            }}
                          />
                        </label>
                        <label className={`${labelClass} mt-3`}>
                          Rezultat așteptat (JSON, opțional)
                          <input
                            className={`${fieldClass} font-mono text-xs`}
                            placeholder='ex: {"total": 5}'
                            value={
                              item.config.expectedResult !== undefined
                                ? JSON.stringify(item.config.expectedResult)
                                : ""
                            }
                            onChange={(event) => {
                              try {
                                const val = event.target.value.trim()
                                  ? (JSON.parse(
                                      event.target.value,
                                    ) as JsonCheckValue)
                                  : undefined;
                                const config: JsEvalCheckConfig = {
                                  ...(item.config as JsEvalCheckConfig),
                                };
                                if (val === undefined) {
                                  delete config.expectedResult;
                                } else {
                                  config.expectedResult = val;
                                }
                                updateItem(index, {
                                  ...item,
                                  config,
                                });
                              } catch {
                                // Imediat în timpul tastării poate fi invalid
                              }
                            }}
                          />
                        </label>
                        <p className="mt-1 text-xs text-app-muted">
                          Dacă este lăsat gol, scriptul trebuie să returneze un
                          obiect{" "}
                          <code className="text-slate-700">{`{ passed: boolean, message: string }`}</code>{" "}
                          sau <code className="text-slate-700">true</code>.
                        </p>
                      </div>
                    ) : null}

                    {item.type === "check" &&
                    ["element", "text", "url"].includes(item.checkType) ? (
                      <div className="mt-3 grid gap-3 rounded-lg border border-app-border bg-app-canvas p-3 sm:grid-cols-2">
                        <label className={labelClass}>
                          Timeout verificare (ms)
                          <input
                            className={fieldClass}
                            type="number"
                            min={0}
                            max={120000}
                            step={500}
                            value={item.timeoutMs ?? 5000}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                timeoutMs: Number(event.target.value),
                              });
                            }}
                          />
                        </label>
                        {item.checkType === "element" &&
                        "state" in item.config ? (
                          <label className={labelClass}>
                            Condiție element
                            <select
                              className={fieldClass}
                              value={item.config.state}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...item.config,
                                    state: event.target
                                      .value as typeof item.config.state,
                                  },
                                });
                              }}
                            >
                              <option value="visible">Vizibil</option>
                              <option value="hidden">Ascuns sau absent</option>
                              <option value="enabled">Activ</option>
                              <option value="disabled">Dezactivat</option>
                              <option value="checked">Bifat</option>
                              <option value="unchecked">Nebifat</option>
                            </select>
                          </label>
                        ) : null}
                      </div>
                    ) : null}

                    {item.type === "check" &&
                    (item.checkType === "text" || item.checkType === "url") &&
                    "operator" in item.config &&
                    "value" in item.config ? (
                      <fieldset className="mt-3 rounded-lg border border-app-border p-3">
                        <legend className="px-1 text-xs font-semibold">
                          Regula de conformitate
                        </legend>
                        <div className="grid gap-3 sm:grid-cols-2">
                          <label className={labelClass}>
                            Operator
                            <select
                              className={fieldClass}
                              value={item.config.operator}
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...item.config,
                                    operator: event.target
                                      .value as typeof item.config.operator,
                                  },
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
                            Valoare așteptată
                            <input
                              className={fieldClass}
                              value={
                                Array.isArray(item.config.value)
                                  ? item.config.value.join(", ")
                                  : item.config.value
                              }
                              onChange={(event) => {
                                updateItem(index, {
                                  ...item,
                                  config: {
                                    ...item.config,
                                    value: event.target.value,
                                  },
                                });
                              }}
                            />
                          </label>
                        </div>
                        <label className="mt-3 flex items-center gap-2 text-xs font-semibold text-app-muted">
                          <input
                            type="checkbox"
                            checked={item.config.caseSensitive ?? false}
                            onChange={(event) => {
                              updateItem(index, {
                                ...item,
                                config: {
                                  ...item.config,
                                  caseSensitive: event.target.checked,
                                },
                              });
                            }}
                          />
                          Diferențiază majusculele de minuscule
                        </label>
                      </fieldset>
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
                      <label
                        className={`${labelClass} mt-3 rounded-lg border border-app-border bg-app-canvas p-3`}
                      >
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

                    <details className="mt-3 rounded-lg bg-app-canvas p-3 xl:col-span-2">
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
                      <p className="mt-3 text-xs text-red-700 xl:col-span-2">
                        {itemIssues.map((issue) => issue.message).join(" · ")}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
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
      {aiStep ? (
        <AiStepEditorModal
          api={api}
          open
          projectId={projectId}
          step={aiStep}
          test={test}
          onClose={() => {
            setAiStep(undefined);
          }}
          onApplied={(saved, aiVersion) => {
            setLastAiVersion(aiVersion);
            setAiStep(undefined);
            onTestSaved(saved);
            void api
              .listTestVersions(projectId, test.id)
              .then(setVersions)
              .catch(() => setVersions([]));
          }}
        />
      ) : null}
      {aiCreate ? (
        <AiStepCreatorModal
          api={api}
          open
          test={test}
          items={items}
          stepId={aiCreate.stepId}
          stepType={aiCreate.stepType}
          onClose={() => setAiCreate(undefined)}
          onAdd={(step) => {
            mutate([...items, step]);
            setSelectedItemId(step.id);
          }}
        />
      ) : null}
      {visualCapture !== undefined ? (
        <VisualRegionCaptureModal
          capture={visualCapture.capture}
          open
          onClose={() => setVisualCapture(undefined)}
          onSave={(region) => saveVisualRegion(visualCapture.itemIndex, region)}
        />
      ) : null}
    </section>
  );
};
