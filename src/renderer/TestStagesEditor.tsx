import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { ImapAccountSummary } from "../shared/imap.js";
import type { MySqlSchemaResult } from "../shared/mysql.js";
import { normalizeTestPostRunChecks } from "../shared/post-run-checks.js";
import type { TestFlowItem } from "../shared/test-model.js";
import {
  MYSQL_ROW_SOURCES,
  SESSION_VARIABLE_TYPES,
  stagesForTest,
  validateTestStageDependencies,
  type ExternalCheckStep,
  type ImapVariableExtractor,
  type MysqlVariableExtractor,
  type TestStage,
} from "../shared/test-stages.js";
import { Button } from "./components/Button.js";
import { Dropdown } from "./components/Dropdown.js";
import { TestFlowEditor } from "./TestFlowEditor.js";

interface TestStagesEditorProps {
  api: SemanticAppApi;
  projectId: string;
  test: TestDefinition;
  onTestSaved: (test: TestDefinition) => void;
  section?: "all" | "flow" | "checks";
}

const clone = <T,>(value: T): T => structuredClone(value);
const createId = (prefix: string): string =>
  `${prefix}-${globalThis.crypto.randomUUID()}`;

const fieldClass =
  "mt-1 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm";
const labelClass = "text-xs font-semibold text-app-muted";

const emptyStage = (index: number): TestStage => ({
  id: createId("stage"),
  name: `Etapa ${index + 1}`,
  enabled: true,
  entry: { type: "continue_current_page" },
  flowItems: [],
  postChecks: [],
});

const emptyMysqlCheck = (): ExternalCheckStep => ({
  id: createId("mysql-check"),
  type: "check",
  checkType: "mysql",
  title: "Verificare MySQL",
  humanDescription: "Compară datele etapei cu baseline-ul MySQL.",
  config: { tableNames: [], identities: [] },
  enabled: true,
  required: true,
  extractors: [],
});

const emptyImapCheck = (accountId = ""): ExternalCheckStep => ({
  id: createId("imap-check"),
  type: "check",
  checkType: "imap",
  title: "Verificare email",
  humanDescription: "Așteaptă emailul produs de această etapă.",
  config: {
    accountId,
    mailbox: "INBOX",
    receivedAfterTestStart: true,
  },
  enabled: true,
  required: true,
  extractors: [],
});

const withoutStages = (
  test: TestDefinition,
  flowItems: TestFlowItem[],
): TestDefinition => {
  const result = { ...test, flowItems: clone(flowItems) };
  delete result.stages;
  return result;
};

const MySqlCheckEditor = ({
  check,
  schema,
  onChange,
}: {
  check: ExternalCheckStep;
  schema?: MySqlSchemaResult;
  onChange: (check: ExternalCheckStep) => void;
}) => {
  if (check.checkType !== "mysql" || !("tableNames" in check.config)) {
    return null;
  }
  const config = check.config;
  const extractors = (check.extractors ?? []).filter(
    (item): item is MysqlVariableExtractor => item.source === "mysql",
  );
  const addExtractor = (): void => {
    const table = schema?.tables.find(
      (candidate) => candidate.identityColumns.length > 0,
    );
    const column = table?.columns[0]?.name ?? "id";
    const extractor: MysqlVariableExtractor = {
      id: createId("mysql-extractor"),
      source: "mysql",
      tableName: table?.name ?? "",
      rowSource: "inserted",
      filters: [],
      column,
      cardinality: "exactly_one",
      output: {
        name: "orderId",
        type: "string",
        required: true,
        overwritePolicy: "deny",
      },
    };
    const nextConfig =
      table === undefined
        ? config
        : {
            tableNames: [...new Set([...config.tableNames, table.name])],
            identities: [
              ...config.identities.filter(
                (identity) => identity.tableName !== table.name,
              ),
              {
                tableName: table.name,
                columns: [...table.identityColumns],
              },
            ],
          };
    onChange({
      ...check,
      config: nextConfig,
      extractors: [...(check.extractors ?? []), extractor],
    });
  };

  const updateExtractor = (
    extractorId: string,
    next: MysqlVariableExtractor,
  ): void => {
    const tableNames = [
      ...new Set([
        ...config.tableNames,
        ...extractors
          .filter(({ id }) => id !== extractorId)
          .map(({ tableName }) => tableName),
        next.tableName,
      ]),
    ].filter(Boolean);
    const identities = tableNames.flatMap((tableName) => {
      const tableSchema = schema?.tables.find(({ name }) => name === tableName);
      const existing = config.identities.find(
        (identity) => identity.tableName === tableName,
      );
      const columns = tableSchema?.identityColumns ?? existing?.columns ?? [];
      return columns.length === 0 ? [] : [{ tableName, columns: [...columns] }];
    });
    onChange({
      ...check,
      config: { tableNames, identities },
      extractors: (check.extractors ?? []).map((item) =>
        item.id === extractorId ? next : item,
      ),
    });
  };

  return (
    <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/50 p-3">
      <div className="flex items-center justify-between gap-2">
        <strong className="text-sm">Valori extrase din DB</strong>
        <Button variant="secondary" onClick={addExtractor}>
          + Extrage coloană
        </Button>
      </div>
      {extractors.length === 0 ? (
        <p className="mt-2 text-xs text-app-muted">
          Check-ul validează diff-ul, dar nu publică încă variabile.
        </p>
      ) : (
        <div className="mt-3 grid gap-3">
          {extractors.map((extractor) => {
            const table = schema?.tables.find(
              ({ name }) => name === extractor.tableName,
            );
            return (
              <div
                key={extractor.id}
                className="grid gap-3 rounded-lg border border-blue-200 bg-white p-3 md:grid-cols-3"
              >
                <label className={labelClass}>
                  Tabel
                  <select
                    className={fieldClass}
                    value={extractor.tableName}
                    onChange={(event) => {
                      const nextTable = schema?.tables.find(
                        ({ name }) => name === event.target.value,
                      );
                      updateExtractor(extractor.id, {
                        ...extractor,
                        tableName: event.target.value,
                        column: nextTable?.columns[0]?.name ?? "",
                      });
                    }}
                  >
                    <option value="">Selectează tabelul</option>
                    {(schema?.tables ?? []).map((candidate) => (
                      <option
                        key={candidate.name}
                        value={candidate.name}
                        disabled={candidate.identityColumns.length === 0}
                      >
                        {candidate.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Rânduri candidate
                  <select
                    className={fieldClass}
                    value={extractor.rowSource}
                    onChange={(event) => {
                      updateExtractor(extractor.id, {
                        ...extractor,
                        rowSource: event.target
                          .value as MysqlVariableExtractor["rowSource"],
                      });
                    }}
                  >
                    {MYSQL_ROW_SOURCES.map((source) => (
                      <option key={source} value={source}>
                        {source}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Coloană extrasă
                  <select
                    className={fieldClass}
                    value={extractor.column}
                    onChange={(event) => {
                      updateExtractor(extractor.id, {
                        ...extractor,
                        column: event.target.value,
                      });
                    }}
                  >
                    {(table?.columns ?? []).map((column) => (
                      <option key={column.name} value={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={labelClass}>
                  Nume variabilă
                  <input
                    className={fieldClass}
                    value={extractor.output.name}
                    onChange={(event) => {
                      updateExtractor(extractor.id, {
                        ...extractor,
                        output: {
                          ...extractor.output,
                          name: event.target.value,
                        },
                      });
                    }}
                  />
                </label>
                <label className={labelClass}>
                  Tip
                  <select
                    className={fieldClass}
                    value={extractor.output.type}
                    onChange={(event) => {
                      updateExtractor(extractor.id, {
                        ...extractor,
                        output: {
                          ...extractor.output,
                          type: event.target
                            .value as MysqlVariableExtractor["output"]["type"],
                        },
                      });
                    }}
                  >
                    {SESSION_VARIABLE_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={`${labelClass} flex items-center gap-2 pt-6`}>
                  <input
                    type="checkbox"
                    checked={extractor.output.required}
                    onChange={(event) => {
                      updateExtractor(extractor.id, {
                        ...extractor,
                        output: {
                          ...extractor.output,
                          required: event.target.checked,
                        },
                      });
                    }}
                  />
                  Variabilă obligatorie
                </label>
                <div className="md:col-span-3">
                  <Button
                    variant="danger"
                    onClick={() => {
                      onChange({
                        ...check,
                        extractors: (check.extractors ?? []).filter(
                          ({ id }) => id !== extractor.id,
                        ),
                      });
                    }}
                  >
                    Elimină extractorul
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};

const ImapCheckEditor = ({
  check,
  accounts,
  onChange,
}: {
  check: ExternalCheckStep;
  accounts: ImapAccountSummary[];
  onChange: (check: ExternalCheckStep) => void;
}) => {
  if (check.checkType !== "imap" || !("accountId" in check.config)) {
    return null;
  }
  const config = check.config;
  const extractors = (check.extractors ?? []).filter(
    (item): item is ImapVariableExtractor => item.source === "imap",
  );
  return (
    <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/50 p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <label className={labelClass}>
          Cont IMAP
          <select
            className={fieldClass}
            value={config.accountId}
            onChange={(event) => {
              onChange({
                ...check,
                config: { ...config, accountId: event.target.value },
              });
            }}
          >
            <option value="">Selectează contul</option>
            {accounts.map((account) => (
              <option key={account.id} value={account.id}>
                {account.name}
              </option>
            ))}
          </select>
        </label>
        <label className={labelClass}>
          Mailbox
          <input
            className={fieldClass}
            value={config.mailbox ?? "INBOX"}
            onChange={(event) => {
              onChange({
                ...check,
                config: { ...config, mailbox: event.target.value },
              });
            }}
          />
        </label>
        <label className={labelClass}>
          Subiectul conține
          <input
            className={fieldClass}
            value={config.subjectContains ?? ""}
            onChange={(event) => {
              onChange({
                ...check,
                config: { ...config, subjectContains: event.target.value },
              });
            }}
          />
        </label>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <strong className="text-sm">Valori extrase din email</strong>
        <Button
          variant="secondary"
          onClick={() => {
            const extractor: ImapVariableExtractor = {
              id: createId("imap-extractor"),
              source: "imap",
              field: "link_by_text",
              selector: {
                operator: "equals",
                value: "Plătește acum",
                caseSensitive: false,
              },
              cardinality: "exactly_one",
              output: {
                name: "paymentLink",
                type: "url",
                required: true,
                overwritePolicy: "deny",
              },
            };
            onChange({
              ...check,
              extractors: [...(check.extractors ?? []), extractor],
            });
          }}
        >
          + Extrage link
        </Button>
      </div>
      {extractors.map((extractor) => (
        <div
          key={extractor.id}
          className="mt-3 grid gap-3 rounded-lg border border-violet-200 bg-white p-3 md:grid-cols-3"
        >
          <label className={labelClass}>
            Identifică linkul după
            <select
              className={fieldClass}
              value={extractor.field}
              onChange={(event) => {
                onChange({
                  ...check,
                  extractors: (check.extractors ?? []).map((item) =>
                    item.id === extractor.id
                      ? {
                          ...extractor,
                          field: event.target
                            .value as ImapVariableExtractor["field"],
                        }
                      : item,
                  ),
                });
              }}
            >
              <option value="link_by_text">Textul butonului/linkului</option>
              <option value="link_by_href">Fragment din URL</option>
            </select>
          </label>
          <label className={labelClass}>
            Text sau fragment href
            <input
              className={fieldClass}
              value={extractor.selector?.value ?? ""}
              onChange={(event) => {
                onChange({
                  ...check,
                  extractors: (check.extractors ?? []).map((item) =>
                    item.id === extractor.id
                      ? {
                          ...extractor,
                          selector: {
                            operator: extractor.selector?.operator ?? "equals",
                            value: event.target.value,
                            caseSensitive: false,
                          },
                        }
                      : item,
                  ),
                });
              }}
            />
          </label>
          <label className={labelClass}>
            Salvează ca
            <input
              className={fieldClass}
              value={extractor.output.name}
              onChange={(event) => {
                onChange({
                  ...check,
                  extractors: (check.extractors ?? []).map((item) =>
                    item.id === extractor.id
                      ? {
                          ...extractor,
                          output: {
                            ...extractor.output,
                            name: event.target.value,
                          },
                        }
                      : item,
                  ),
                });
              }}
            />
          </label>
          <div className="md:col-span-3">
            <Button
              variant="danger"
              onClick={() => {
                onChange({
                  ...check,
                  extractors: (check.extractors ?? []).filter(
                    ({ id }) => id !== extractor.id,
                  ),
                });
              }}
            >
              Elimină extractorul
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};

export const TestStagesEditor = ({
  api,
  projectId,
  test,
  onTestSaved,
  section = "all",
}: TestStagesEditorProps) => {
  const [stages, setStages] = useState<TestStage[]>(() => stagesForTest(test));
  const [selectedStageId, setSelectedStageId] = useState(
    () => stagesForTest(test)[0]?.id ?? "",
  );
  const [selectedCheckId, setSelectedCheckId] = useState(
    () => stagesForTest(test)[0]?.postChecks[0]?.id ?? "",
  );
  const [dirty, setDirty] = useState(false);
  const [aiPrompt, setAiPrompt] = useState(
    () => normalizeTestPostRunChecks(test.postRunChecks).aiPrompt,
  );
  const [promptDirty, setPromptDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [message, setMessage] = useState<string>();
  const [schema, setSchema] = useState<MySqlSchemaResult>();
  const [accounts, setAccounts] = useState<ImapAccountSummary[]>([]);

  useEffect(() => {
    const next = stagesForTest(test);
    setStages(next);
    setSelectedStageId((current) =>
      next.some(({ id }) => id === current) ? current : (next[0]?.id ?? ""),
    );
    setAiPrompt(normalizeTestPostRunChecks(test.postRunChecks).aiPrompt);
    setDirty(false);
    setPromptDirty(false);
    setMessage(undefined);
  }, [test]);

  useEffect(() => {
    if (typeof api.loadMySqlSchema === "function") {
      void Promise.resolve(api.loadMySqlSchema(projectId))
        .then(setSchema)
        .catch(() => setSchema(undefined));
    }
    if (typeof api.listImapAccounts === "function") {
      void Promise.resolve(api.listImapAccounts())
        .then(setAccounts)
        .catch(() => setAccounts([]));
    }
  }, [api, projectId]);

  const selectedIndex = Math.max(
    0,
    stages.findIndex(({ id }) => id === selectedStageId),
  );
  const selected = stages[selectedIndex];
  const selectedCheckIndex = Math.max(
    0,
    selected?.postChecks.findIndex(({ id }) => id === selectedCheckId) ?? -1,
  );
  const selectedCheck = selected?.postChecks[selectedCheckIndex];
  const dependencyIssues = useMemo(
    () => validateTestStageDependencies(stages),
    [stages],
  );

  useEffect(() => {
    if (selected === undefined) return;
    setSelectedCheckId((current) =>
      selected.postChecks.some(({ id }) => id === current)
        ? current
        : (selected.postChecks[0]?.id ?? ""),
    );
  }, [selected]);

  const mutate = (next: TestStage[]): void => {
    setStages(next);
    setDirty(true);
    setError(undefined);
    setMessage(undefined);
  };

  const updateStage = (index: number, next: TestStage): void => {
    const result = [...stages];
    result[index] = next;
    mutate(result);
  };

  const save = async (nextStages = stages): Promise<TestDefinition> => {
    if (api.saveTestStages === undefined) {
      throw new Error("Versiunea aplicației nu expune salvarea etapelor.");
    }
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const saved = await api.saveTestStages(projectId, test.id, nextStages);
      setStages(stagesForTest(saved));
      setDirty(false);
      onTestSaved(saved);
      setMessage("Flow-urile și etapele au fost salvate.");
      return saved;
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Etapele nu au putut fi salvate.",
      );
      throw saveError;
    } finally {
      setBusy(false);
    }
  };

  const saveChecks = async (): Promise<void> => {
    if (api.saveTestStages === undefined) {
      setError("Versiunea aplicației nu expune salvarea checks-urilor.");
      return;
    }
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    let saved = test;
    try {
      if (dirty) {
        saved = await api.saveTestStages(projectId, test.id, stages);
        setStages(stagesForTest(saved));
        setDirty(false);
      }
      if (promptDirty) {
        const checks = normalizeTestPostRunChecks(saved.postRunChecks);
        saved = await api.saveTestPostRunChecks(projectId, test.id, {
          ...checks,
          aiPrompt,
        });
        setPromptDirty(false);
      }
      onTestSaved(saved);
      setMessage("Checks și instrucțiunile pentru AI au fost salvate.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Checks-urile nu au putut fi salvate.",
      );
    } finally {
      setBusy(false);
    }
  };

  if (selected === undefined) return null;
  const editorTest = withoutStages(test, selected.flowItems);
  const showFlow = section !== "checks";
  const showChecks = section !== "flow";

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="font-semibold">
            {showFlow ? "Sesiunea de flow-uri" : "Checks"}
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            {showFlow
              ? "Etapele rulează în ordine și împart browserul, dataset-ul și variabilele runtime."
              : "Alege etapa, adaugă sau editează check-urile, apoi apasă «Salvează checks» pentru a salva întreaga secțiune."}
          </p>
          {!showFlow ? (
            <p
              className={`mt-2 text-xs font-semibold ${
                dirty || promptDirty ? "text-amber-700" : "text-emerald-700"
              }`}
            >
              {dirty || promptDirty
                ? "Ai modificări nesalvate."
                : "Toate checks-urile sunt salvate."}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          {showFlow ? (
            <Button
              disabled={
                busy ||
                !dirty ||
                dependencyIssues.length > 0 ||
                stages.length === 0
              }
              onClick={() => void save().catch(() => undefined)}
            >
              {busy ? "Se salvează…" : "Salvează flow-urile"}
            </Button>
          ) : (
            <Button
              disabled={
                busy ||
                (!dirty && !promptDirty) ||
                dependencyIssues.length > 0 ||
                stages.length === 0
              }
              onClick={() => void saveChecks()}
            >
              {busy ? "Se salvează…" : "Salvează checks"}
            </Button>
          )}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-end justify-between gap-3 rounded-xl border border-app-border bg-app-canvas p-3">
        {stages.length > 1 ? (
          <label className={`${labelClass} min-w-60 flex-1 sm:max-w-sm`}>
            Etapa configurată
            <select
              className={fieldClass}
              aria-label="Etapa configurată"
              value={selected.id}
              onChange={(event) => setSelectedStageId(event.target.value)}
            >
              {stages.map((stage, index) => (
                <option key={stage.id} value={stage.id}>
                  {index + 1}. {stage.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <div className="min-w-60 flex-1 sm:max-w-sm">
            <span className={labelClass}>Etapa configurată</span>
            <p className="mt-1 min-h-10 rounded-lg border border-app-border bg-white px-3 py-2 text-sm font-medium text-app-ink">
              {selected.name}
            </p>
          </div>
        )}
        <div className="flex items-center gap-2 pb-0.5">
          <span className="rounded-full border border-app-border bg-white px-2.5 py-1 text-xs font-semibold text-app-muted">
            {selectedIndex + 1}/{stages.length}
          </span>
          {showFlow ? (
            <Dropdown
              align="right"
              compact
              label="Acțiuni etapă"
              items={[
                {
                  id: "add-stage",
                  label: "Adaugă etapă",
                  onSelect: () => {
                    const stage = emptyStage(stages.length);
                    mutate([...stages, stage]);
                    setSelectedStageId(stage.id);
                  },
                },
                {
                  id: "duplicate-stage",
                  label: "Duplică etapa",
                  onSelect: () => {
                    const duplicate = {
                      ...clone(selected),
                      id: createId("stage"),
                      name: `${selected.name} copie`,
                      entry: { type: "continue_current_page" } as const,
                    };
                    const next = [...stages];
                    next.splice(selectedIndex + 1, 0, duplicate);
                    mutate(next);
                    setSelectedStageId(duplicate.id);
                  },
                },
                {
                  id: "move-stage-up",
                  label: "Mută înainte",
                  disabled: selectedIndex === 0,
                  onSelect: () => {
                    const next = [...stages];
                    [next[selectedIndex - 1], next[selectedIndex]] = [
                      next[selectedIndex]!,
                      next[selectedIndex - 1]!,
                    ];
                    mutate(next);
                  },
                },
                {
                  id: "move-stage-down",
                  label: "Mută după",
                  disabled: selectedIndex >= stages.length - 1,
                  onSelect: () => {
                    const next = [...stages];
                    [next[selectedIndex], next[selectedIndex + 1]] = [
                      next[selectedIndex + 1]!,
                      next[selectedIndex]!,
                    ];
                    mutate(next);
                  },
                },
                {
                  id: "delete-stage",
                  label: "Șterge etapa",
                  tone: "danger",
                  disabled: stages.length === 1,
                  onSelect: () => {
                    const next = stages.filter(({ id }) => id !== selected.id);
                    mutate(next);
                    setSelectedStageId(
                      next[Math.max(0, selectedIndex - 1)]?.id ?? "",
                    );
                  },
                },
              ]}
            />
          ) : null}
        </div>
      </div>

      {dependencyIssues.length > 0 ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <strong>Dependențe invalide</strong>
          <ul className="mt-2 list-disc pl-5">
            {dependencyIssues.slice(0, 8).map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>{issue.message}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {error !== undefined ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {message !== undefined ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}

      {showFlow ? (
        <div className="mt-4 grid gap-3 rounded-xl border border-app-border bg-app-canvas p-4 md:grid-cols-3">
          <label className={labelClass}>
            Numele etapei
            <input
              className={fieldClass}
              value={selected.name}
              onChange={(event) =>
                updateStage(selectedIndex, {
                  ...selected,
                  name: event.target.value,
                })
              }
            />
          </label>
          <label className={labelClass}>
            Pornește etapa din
            <select
              className={fieldClass}
              value={selected.entry.type}
              onChange={(event) => {
                const type = event.target.value as TestStage["entry"]["type"];
                const entry: TestStage["entry"] =
                  type === "test_start"
                    ? { type }
                    : type === "continue_current_page"
                      ? { type }
                      : type === "static_url"
                        ? { type, url: test.startUrl }
                        : type === "url_template"
                          ? { type, template: "{{baseUrl}}/order/{{orderId}}" }
                          : { type, variableName: "paymentLink" };
                updateStage(selectedIndex, { ...selected, entry });
              }}
            >
              {selectedIndex === 0 ? (
                <option value="test_start">URL-ul de start al testului</option>
              ) : null}
              <option value="continue_current_page">Pagina curentă</option>
              <option value="static_url">URL fix</option>
              <option value="url_template">URL cu variabile</option>
              <option value="variable_url">URL din variabilă</option>
            </select>
          </label>
          <label className={`${labelClass} flex items-center gap-2 pt-6`}>
            <input
              type="checkbox"
              checked={selected.enabled}
              onChange={(event) =>
                updateStage(selectedIndex, {
                  ...selected,
                  enabled: event.target.checked,
                })
              }
            />
            Etapă activă
          </label>
          {selected.entry.type === "static_url" ? (
            <label className={`${labelClass} md:col-span-3`}>
              URL fix
              <input
                className={fieldClass}
                value={selected.entry.url}
                onChange={(event) =>
                  updateStage(selectedIndex, {
                    ...selected,
                    entry: { type: "static_url", url: event.target.value },
                  })
                }
              />
            </label>
          ) : null}
          {selected.entry.type === "url_template" ? (
            <label className={`${labelClass} md:col-span-3`}>
              Template URL
              <input
                className={fieldClass}
                value={selected.entry.template}
                onChange={(event) =>
                  updateStage(selectedIndex, {
                    ...selected,
                    entry: {
                      type: "url_template",
                      template: event.target.value,
                    },
                  })
                }
              />
            </label>
          ) : null}
          {selected.entry.type === "variable_url" ? (
            <label className={`${labelClass} md:col-span-3`}>
              Variabilă URL obligatorie
              <input
                className={fieldClass}
                value={selected.entry.variableName}
                onChange={(event) =>
                  updateStage(selectedIndex, {
                    ...selected,
                    entry: {
                      type: "variable_url",
                      variableName: event.target.value,
                    },
                  })
                }
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {showFlow ? (
        <TestFlowEditor
          api={api}
          availableVariableNames={stages
            .slice(0, selectedIndex)
            .flatMap((stage) =>
              stage.postChecks.flatMap((check) =>
                (check.extractors ?? []).map(
                  (extractor) => extractor.output.name,
                ),
              ),
            )}
          projectId={projectId}
          test={editorTest}
          onTestSaved={onTestSaved}
          saveFlow={async (flowItems) => {
            const next = stages.map((stage, index) =>
              index === selectedIndex ? { ...stage, flowItems } : stage,
            );
            return save(next);
          }}
        />
      ) : null}

      {showChecks ? (
        <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="font-semibold">Checks după „{selected.name}”</h4>
              <p className="mt-1 text-xs text-app-muted">
                Se execută în ordine; output-urile devin disponibile etapelor
                următoare.
              </p>
            </div>
            <Dropdown
              align="right"
              compact
              label="Adaugă un check"
              items={[
                {
                  id: "add-db-check",
                  label: "Check bază de date",
                  onSelect: () => {
                    const check = emptyMysqlCheck();
                    updateStage(selectedIndex, {
                      ...selected,
                      postChecks: [...selected.postChecks, check],
                    });
                    setSelectedCheckId(check.id);
                  },
                },
                {
                  id: "add-email-check",
                  label: "Check e-mail",
                  onSelect: () => {
                    const check = emptyImapCheck(accounts[0]?.id);
                    updateStage(selectedIndex, {
                      ...selected,
                      postChecks: [...selected.postChecks, check],
                    });
                    setSelectedCheckId(check.id);
                  },
                },
              ]}
            />
          </div>
          <label className="mt-4 block text-sm font-semibold text-app-ink">
            Instrucțiuni pentru AI
            <textarea
              className="mt-1 min-h-28 w-full rounded-lg border border-app-border bg-white px-3 py-2 text-sm font-normal"
              aria-label="Instrucțiuni pentru AI la checks"
              placeholder="Ex.: Verifică dacă schimbările din DB și mesajele e-mail confirmă rezultatul așteptat. Explică orice neconcordanță."
              value={aiPrompt}
              onChange={(event) => {
                setAiPrompt(event.target.value);
                setPromptDirty(true);
                setError(undefined);
                setMessage(undefined);
              }}
            />
            <span className="mt-1 block text-xs font-normal text-app-muted">
              Aceste instrucțiuni sunt folosite după rulare pentru evaluarea cu
              AI a dovezilor produse de toate checks-urile.
            </span>
          </label>
          {selected.postChecks.length === 0 ? (
            <p className="mt-3 text-sm text-app-muted">
              Etapa nu are checks externe.
            </p>
          ) : selectedCheck !== undefined ? (
            <div className="mt-4 grid gap-3">
              {selected.postChecks.length > 1 ? (
                <label className={`${labelClass} max-w-md`}>
                  Check configurat
                  <select
                    className={fieldClass}
                    value={selectedCheck.id}
                    onChange={(event) => setSelectedCheckId(event.target.value)}
                  >
                    {selected.postChecks.map((check, index) => (
                      <option key={check.id} value={check.id}>
                        {index + 1}. {check.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <div className="max-w-md">
                  <span className={labelClass}>Check configurat</span>
                  <p className="mt-1 min-h-10 rounded-lg border border-app-border bg-white px-3 py-2 text-sm font-medium text-app-ink">
                    {selectedCheck.title}
                  </p>
                </div>
              )}
              <article className="rounded-xl border border-app-border bg-white p-4">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <label className={`${labelClass} min-w-64 flex-1`}>
                    Titlu check
                    <input
                      className={fieldClass}
                      value={selectedCheck.title}
                      onChange={(event) => {
                        const postChecks = [...selected.postChecks];
                        postChecks[selectedCheckIndex] = {
                          ...selectedCheck,
                          title: event.target.value,
                        };
                        updateStage(selectedIndex, { ...selected, postChecks });
                      }}
                    />
                  </label>
                  <label className="flex min-h-8 items-center gap-2 text-xs font-semibold text-app-muted">
                    <input
                      type="checkbox"
                      checked={selectedCheck.enabled}
                      onChange={(event) => {
                        const postChecks = [...selected.postChecks];
                        postChecks[selectedCheckIndex] = {
                          ...selectedCheck,
                          enabled: event.target.checked,
                        };
                        updateStage(selectedIndex, { ...selected, postChecks });
                      }}
                    />
                    Activ
                  </label>
                  <label className="flex min-h-8 items-center gap-2 text-xs font-semibold text-app-muted">
                    <input
                      type="checkbox"
                      checked={selectedCheck.required ?? true}
                      onChange={(event) => {
                        const postChecks = [...selected.postChecks];
                        postChecks[selectedCheckIndex] = {
                          ...selectedCheck,
                          required: event.target.checked,
                        };
                        updateStage(selectedIndex, { ...selected, postChecks });
                      }}
                    />
                    Obligatoriu
                  </label>
                  <Button
                    variant="danger"
                    size="compact"
                    onClick={() => {
                      const postChecks = selected.postChecks.filter(
                        ({ id }) => id !== selectedCheck.id,
                      );
                      updateStage(selectedIndex, {
                        ...selected,
                        postChecks,
                      });
                      setSelectedCheckId(
                        postChecks[
                          Math.min(selectedCheckIndex, postChecks.length - 1)
                        ]?.id ?? "",
                      );
                    }}
                  >
                    Elimină check-ul
                  </Button>
                </div>
                {selectedCheck.checkType === "mysql" ? (
                  <MySqlCheckEditor
                    check={selectedCheck}
                    {...(schema ? { schema } : {})}
                    onChange={(nextCheck) => {
                      const postChecks = [...selected.postChecks];
                      postChecks[selectedCheckIndex] = nextCheck;
                      updateStage(selectedIndex, { ...selected, postChecks });
                    }}
                  />
                ) : (
                  <ImapCheckEditor
                    check={selectedCheck}
                    accounts={accounts}
                    onChange={(nextCheck) => {
                      const postChecks = [...selected.postChecks];
                      postChecks[selectedCheckIndex] = nextCheck;
                      updateStage(selectedIndex, { ...selected, postChecks });
                    }}
                  />
                )}
              </article>
            </div>
          ) : null}
        </section>
      ) : null}
    </section>
  );
};
