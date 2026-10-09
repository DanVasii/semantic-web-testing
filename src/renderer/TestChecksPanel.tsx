import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { ImapAccountSummary } from "../shared/imap.js";
import {
  normalizeTestPostRunChecks,
  type TestPostRunChecks,
} from "../shared/post-run-checks.js";
import { Button } from "./components/Button.js";

export interface TestChecksPanelProps {
  api: SemanticAppApi;
  projectId: string;
  test: TestDefinition;
  onTestUpdated: (test: TestDefinition) => void;
}

export const TestChecksPanel = ({
  api,
  onTestUpdated,
  projectId,
  test,
}: TestChecksPanelProps) => {
  const initialChecks = normalizeTestPostRunChecks(test.postRunChecks);
  const [checks, setChecks] = useState<TestPostRunChecks>(initialChecks);
  const [selectedInboxId, setSelectedInboxId] = useState<string | undefined>(
    initialChecks.imap.inboxes[0]?.id,
  );
  const [schema, setSchema] =
    useState<Awaited<ReturnType<SemanticAppApi["loadMySqlSchema"]>>>();
  const [imapAccounts, setImapAccounts] = useState<ImapAccountSummary[]>([]);
  const [tableSearch, setTableSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    const normalized = normalizeTestPostRunChecks(test.postRunChecks);
    setChecks(normalized);
    setSelectedInboxId(normalized.imap.inboxes[0]?.id);
    setTableSearch("");
  }, [test.id, test.postRunChecks]);

  useEffect(() => {
    let active = true;
    void Promise.resolve(api.loadMySqlSchema(projectId))
      .then((value) => {
        if (active) setSchema(value);
      })
      .catch(() => {
        if (active) setSchema(undefined);
      });
    return () => {
      active = false;
    };
  }, [api, projectId]);

  useEffect(() => {
    let active = true;
    void Promise.resolve(api.listImapAccounts())
      .then((accounts) => {
        if (active) setImapAccounts(accounts ?? []);
      })
      .catch(() => {
        if (active) setImapAccounts([]);
      });
    return () => {
      active = false;
    };
  }, [api]);

  const availableTables = useMemo(
    () =>
      (schema?.tables ?? []).filter(
        (table) => table.identityColumns.length > 0,
      ),
    [schema],
  );
  const normalizedTableSearch = tableSearch.trim().toLocaleLowerCase();
  const filteredTables = useMemo(
    () =>
      (schema?.tables ?? []).filter(
        (table) =>
          normalizedTableSearch.length === 0 ||
          table.name.toLocaleLowerCase().includes(normalizedTableSearch),
      ),
    [normalizedTableSearch, schema],
  );
  const filteredAvailableTables = useMemo(
    () => filteredTables.filter((table) => table.identityColumns.length > 0),
    [filteredTables],
  );

  const toggleTable = (tableName: string, enabled: boolean): void => {
    const table = schema?.tables.find(
      (candidate) => candidate.name === tableName,
    );
    if (table === undefined || table.identityColumns.length === 0) return;
    setChecks((current) => ({
      ...current,
      mysql: {
        ...current.mysql,
        tableNames: enabled
          ? [...new Set([...current.mysql.tableNames, tableName])]
          : current.mysql.tableNames.filter((name) => name !== tableName),
        identities: enabled
          ? [
              ...current.mysql.identities.filter(
                (identity) => identity.tableName !== tableName,
              ),
              {
                tableName,
                columns: [...table.identityColumns],
              },
            ]
          : current.mysql.identities.filter(
              (identity) => identity.tableName !== tableName,
            ),
      },
    }));
  };

  const selectVisibleTables = (): void => {
    setChecks((current) => ({
      ...current,
      mysql: {
        ...current.mysql,
        tableNames:
          normalizedTableSearch.length === 0
            ? availableTables.map((table) => table.name)
            : [
                ...new Set([
                  ...current.mysql.tableNames,
                  ...filteredAvailableTables.map((table) => table.name),
                ]),
              ],
        identities:
          normalizedTableSearch.length === 0
            ? availableTables.map((table) => ({
                tableName: table.name,
                columns: [...table.identityColumns],
              }))
            : [
                ...current.mysql.identities.filter(
                  (identity) =>
                    !filteredAvailableTables.some(
                      (table) => table.name === identity.tableName,
                    ),
                ),
                ...filteredAvailableTables.map((table) => ({
                  tableName: table.name,
                  columns: [...table.identityColumns],
                })),
              ],
      },
    }));
  };

  const deselectVisibleTables = (): void => {
    const names = new Set(
      (normalizedTableSearch.length === 0
        ? availableTables
        : filteredAvailableTables
      ).map((table) => table.name),
    );
    setChecks((current) => ({
      ...current,
      mysql: {
        ...current.mysql,
        tableNames: current.mysql.tableNames.filter(
          (tableName) => !names.has(tableName),
        ),
        identities: current.mysql.identities.filter(
          (identity) => !names.has(identity.tableName),
        ),
      },
    }));
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const checksWithoutRecipient: TestPostRunChecks = {
        ...checks,
        imap: {
          ...checks.imap,
          recipient: "",
          inboxes: checks.imap.inboxes.map((inbox) => ({
            ...inbox,
            recipient: "",
          })),
        },
      };
      const updated = await api.saveTestPostRunChecks(
        projectId,
        test.id,
        checksWithoutRecipient,
      );
      onTestUpdated(updated);
      setMessage("Verificările post-run au fost salvate.");
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Verificările post-run nu au putut fi salvate.",
      );
    } finally {
      setBusy(false);
    }
  };

  const selectedInbox =
    checks.imap.inboxes.find(({ id }) => id === selectedInboxId) ??
    checks.imap.inboxes[0];

  return (
    <section
      className="mt-5 rounded-xl border border-app-border bg-app-surface p-3"
      aria-labelledby="test-checks-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="test-checks-heading" className="font-semibold">
            Checks după rulare
          </h3>
          <p className="mt-1 text-xs text-app-muted">
            Aceste verificări nu sunt pași în flow. Le activezi sau dezactivezi
            direct când pornești testul.
          </p>
        </div>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Se salvează…" : "Salvează checks"}
        </Button>
      </div>

      <div className="mt-3 grid items-stretch gap-3 xl:grid-cols-2">
        <article className="rounded-xl border border-sky-200 bg-sky-50 p-3">
          <label className="flex items-center gap-2 font-semibold text-sky-950">
            <input
              type="checkbox"
              checked={checks.mysql.enabled}
              onChange={(event) => {
                setChecks((current) => ({
                  ...current,
                  mysql: { ...current.mysql, enabled: event.target.checked },
                }));
              }}
            />
            MySQL snapshot implicit la rulare
          </label>
          <p className="mt-1 text-xs text-sky-900">
            Se capturează baseline înaintea acțiunilor și diferența după
            terminarea flow-ului.
          </p>
          <label className="mt-2 grid gap-1 text-xs font-semibold text-sky-950">
            Caută tabel MySQL
            <div className="relative">
              <input
                className="min-h-10 w-full rounded-lg border border-sky-200 bg-white px-3 pr-10 font-normal outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200"
                type="search"
                placeholder="Ex.: wp_wc_orders"
                value={tableSearch}
                onChange={(event) => setTableSearch(event.target.value)}
              />
              {tableSearch.length > 0 ? (
                <button
                  type="button"
                  className="absolute inset-y-0 right-0 px-3 text-sky-700 hover:text-sky-950"
                  aria-label="Șterge căutarea tabelelor"
                  onClick={() => setTableSearch("")}
                >
                  ×
                </button>
              ) : null}
            </div>
            {schema !== undefined ? (
              <span className="font-normal text-sky-800">
                {filteredTables.length} din {schema.tables.length} tabele
              </span>
            ) : null}
          </label>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={filteredAvailableTables.length === 0}
              onClick={selectVisibleTables}
            >
              {normalizedTableSearch.length === 0
                ? "Selectează toate tabelele"
                : "Selectează rezultatele"}
            </Button>
            <Button
              variant="secondary"
              disabled={
                !filteredAvailableTables.some((table) =>
                  checks.mysql.tableNames.includes(table.name),
                )
              }
              onClick={deselectVisibleTables}
            >
              {normalizedTableSearch.length === 0
                ? "Deselectează toate"
                : "Deselectează rezultatele"}
            </Button>
          </div>
          <div className="mt-2 max-h-44 overflow-auto rounded-lg border border-sky-200 bg-white p-2">
            {schema === undefined ? (
              <p className="text-sm">
                Configurează MySQL în proiect și încarcă schema.
              </p>
            ) : schema.tables.length === 0 ? (
              <p className="text-sm">Schema nu conține tabele.</p>
            ) : filteredTables.length === 0 ? (
              <p className="text-sm">
                Niciun tabel nu corespunde căutării „{tableSearch.trim()}”.
              </p>
            ) : (
              <div className="grid gap-1.5 text-sm">
                {filteredTables.map((table) => {
                  const unavailable = table.identityColumns.length === 0;
                  return (
                    <label key={table.name} className="flex items-start gap-2">
                      <input
                        className="mt-1"
                        type="checkbox"
                        disabled={unavailable}
                        checked={checks.mysql.tableNames.includes(table.name)}
                        onChange={(event) => {
                          toggleTable(table.name, event.target.checked);
                        }}
                      />
                      <span>
                        <strong>{table.name}</strong>
                        <span className="block text-xs text-app-muted">
                          {unavailable
                            ? "Lipsesc identity columns."
                            : `Identitate: ${table.identityColumns.join(" AND ")}`}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </article>

        <article className="rounded-xl border border-violet-200 bg-violet-50 p-3">
          <label className="flex items-center gap-2 font-semibold text-violet-950">
            <input
              type="checkbox"
              checked={checks.imap.enabled}
              onChange={(event) => {
                setChecks((current) => ({
                  ...current,
                  imap: { ...current.imap, enabled: event.target.checked },
                }));
              }}
            />
            Ascultare e-mail implicită la rulare
          </label>
          <p className="mt-1 text-xs text-violet-900">
            Sunt luate în calcul numai mesajele primite după pornirea testului.
          </p>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <strong className="text-sm text-violet-950">
              Check-uri per inbox
            </strong>
            <Button
              variant="secondary"
              disabled={imapAccounts.length === 0}
              onClick={() => {
                const account = imapAccounts[0];
                if (account === undefined) return;
                const inboxId =
                  globalThis.crypto?.randomUUID?.() ?? `imap-${Date.now()}`;
                setChecks((current) => {
                  const inboxes = [
                    ...current.imap.inboxes,
                    {
                      id: inboxId,
                      accountId: account.id,
                      mailbox: account.mailbox || "INBOX",
                      sender: "",
                      recipient: "",
                      subjectEquals: "",
                      subjectContains: "",
                      bodyContains: "",
                    },
                  ];
                  return {
                    ...current,
                    imap: {
                      ...current.imap,
                      inboxes,
                      accountIds: inboxes.map(({ accountId }) => accountId),
                    },
                  };
                });
                setSelectedInboxId(inboxId);
              }}
            >
              + Adaugă check e-mail
            </Button>
          </div>
          {imapAccounts.length === 0 ? (
            <p className="mt-3 text-sm text-app-muted">
              Configurează conturile în Setările aplicației.
            </p>
          ) : null}
          {checks.imap.inboxes.length > 0 ? (
            <div
              className="mt-2 flex gap-1 overflow-x-auto pb-1"
              role="tablist"
            >
              {checks.imap.inboxes.map((inbox, index) => (
                <button
                  key={inbox.id}
                  type="button"
                  role="tab"
                  aria-selected={inbox.id === selectedInbox?.id}
                  className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                    inbox.id === selectedInbox?.id
                      ? "border-violet-500 bg-white text-violet-950"
                      : "border-violet-200 bg-violet-100 text-violet-800"
                  }`}
                  onClick={() => setSelectedInboxId(inbox.id)}
                >
                  E-mail {index + 1}
                </button>
              ))}
            </div>
          ) : null}
          <div className="mt-2">
            {selectedInbox === undefined
              ? null
              : (() => {
                  const inbox = selectedInbox;
                  const index = checks.imap.inboxes.findIndex(
                    ({ id }) => id === inbox.id,
                  );
                  const updateInbox = (patch: Partial<typeof inbox>): void => {
                    setChecks((current) => {
                      const inboxes = current.imap.inboxes.map((candidate) =>
                        candidate.id === inbox.id
                          ? { ...candidate, ...patch }
                          : candidate,
                      );
                      return {
                        ...current,
                        imap: {
                          ...current.imap,
                          inboxes,
                          accountIds: inboxes.map(({ accountId }) => accountId),
                        },
                      };
                    });
                  };
                  return (
                    <fieldset
                      key={inbox.id}
                      className="rounded-lg border border-violet-200 bg-white p-2.5"
                    >
                      <legend className="sr-only">
                        Check e-mail {index + 1}
                      </legend>
                      <div className="grid gap-2 sm:grid-cols-2">
                        <label className="grid gap-1 text-xs font-semibold text-violet-950">
                          Inbox / cont IMAP
                          <select
                            className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 font-normal"
                            value={inbox.accountId}
                            onChange={(event) => {
                              const account = imapAccounts.find(
                                ({ id }) => id === event.target.value,
                              );
                              updateInbox({
                                accountId: event.target.value,
                                ...(account === undefined
                                  ? {}
                                  : { mailbox: account.mailbox }),
                              });
                            }}
                          >
                            {imapAccounts.map((account) => (
                              <option key={account.id} value={account.id}>
                                {account.name} · {account.username}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-xs font-semibold text-violet-950">
                          Mailbox
                          <input
                            className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 font-normal"
                            value={inbox.mailbox}
                            onChange={(event) =>
                              updateInbox({ mailbox: event.target.value })
                            }
                          />
                        </label>
                        {(
                          [
                            ["Expeditor exact", "sender"],
                            ["Subiect exact", "subjectEquals"],
                            ["Subiect conține", "subjectContains"],
                          ] as const
                        ).map(([label, key]) => (
                          <label
                            key={key}
                            className="grid gap-1 text-xs font-semibold text-violet-950"
                          >
                            {label}
                            <input
                              className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 font-normal"
                              value={inbox[key]}
                              onChange={(event) =>
                                updateInbox({ [key]: event.target.value })
                              }
                            />
                          </label>
                        ))}
                      </div>
                      <label className="mt-2 grid gap-1 text-xs font-semibold text-violet-950 sm:col-span-2">
                        Corpul mesajului conține
                        <textarea
                          className="min-h-14 rounded-lg border border-violet-200 bg-white p-2 font-normal"
                          rows={2}
                          value={inbox.bodyContains}
                          onChange={(event) =>
                            updateInbox({ bodyContains: event.target.value })
                          }
                        />
                      </label>
                      <div className="mt-2 flex justify-end">
                        <Button
                          variant="danger"
                          onClick={() => {
                            const nextInbox = checks.imap.inboxes.find(
                              ({ id }) => id !== inbox.id,
                            );
                            setSelectedInboxId(nextInbox?.id);
                            setChecks((current) => {
                              const inboxes = current.imap.inboxes.filter(
                                ({ id }) => id !== inbox.id,
                              );
                              return {
                                ...current,
                                imap: {
                                  ...current.imap,
                                  inboxes,
                                  accountIds: inboxes.map(
                                    ({ accountId }) => accountId,
                                  ),
                                },
                              };
                            });
                          }}
                        >
                          Elimină check-ul
                        </Button>
                      </div>
                    </fieldset>
                  );
                })()}
          </div>
        </article>
      </div>

      <label className="mt-3 grid gap-1 text-sm font-semibold">
        Instrucțiune AI comună pentru MySQL și e-mail
        <textarea
          className="min-h-20 rounded-lg border border-orange-200 bg-orange-50 p-3 font-normal"
          rows={3}
          placeholder="Ex.: verifică în MySQL programarea creată cu valorile din dataset și confirmă că e-mailul primit conține același nume, aceeași dată și mesajul de mulțumire."
          value={checks.aiPrompt}
          onChange={(event) => {
            setChecks((current) => ({
              ...current,
              aiPrompt: event.target.value,
            }));
          }}
        />
        <span className="font-normal text-app-muted">
          AI primește împreună diferențele MySQL, mesajele IMAP și valorile
          efective ale datasetului folosit la rulare.
        </span>
      </label>

      {message ? (
        <p className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">
          {message}
        </p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">
          {error}
        </p>
      ) : null}
    </section>
  );
};
