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
  const [checks, setChecks] = useState<TestPostRunChecks>(
    normalizeTestPostRunChecks(test.postRunChecks),
  );
  const [schema, setSchema] =
    useState<Awaited<ReturnType<SemanticAppApi["loadMySqlSchema"]>>>();
  const [imapAccounts, setImapAccounts] = useState<ImapAccountSummary[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setChecks(normalizeTestPostRunChecks(test.postRunChecks));
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

  const selectAllTables = (): void => {
    setChecks((current) => ({
      ...current,
      mysql: {
        ...current.mysql,
        tableNames: availableTables.map((table) => table.name),
        identities: availableTables.map((table) => ({
          tableName: table.name,
          columns: [...table.identityColumns],
        })),
      },
    }));
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(undefined);
    setMessage(undefined);
    try {
      const updated = await api.saveTestPostRunChecks(
        projectId,
        test.id,
        checks,
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

  return (
    <section
      className="mt-5 rounded-xl border border-app-border bg-app-surface p-4"
      aria-labelledby="test-checks-heading"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 id="test-checks-heading" className="font-semibold">
            Checks după rulare
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Aceste verificări nu sunt pași în flow. Le activezi sau dezactivezi
            direct când pornești testul.
          </p>
        </div>
        <Button disabled={busy} onClick={() => void save()}>
          {busy ? "Se salvează…" : "Salvează checks"}
        </Button>
      </div>

      <div className="mt-4 grid gap-4 xl:grid-cols-2">
        <article className="rounded-xl border border-sky-200 bg-sky-50 p-4">
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
          <p className="mt-2 text-sm text-sky-900">
            Se capturează baseline înaintea acțiunilor și diferența după
            terminarea flow-ului.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="secondary"
              disabled={availableTables.length === 0}
              onClick={selectAllTables}
            >
              Selectează toate tabelele
            </Button>
            <Button
              variant="secondary"
              disabled={checks.mysql.tableNames.length === 0}
              onClick={() => {
                setChecks((current) => ({
                  ...current,
                  mysql: {
                    ...current.mysql,
                    tableNames: [],
                    identities: [],
                  },
                }));
              }}
            >
              Deselectează toate
            </Button>
          </div>
          <div className="mt-3 max-h-56 overflow-auto rounded-lg border border-sky-200 bg-white p-3">
            {schema === undefined ? (
              <p className="text-sm">
                Configurează MySQL în proiect și încarcă schema.
              </p>
            ) : schema.tables.length === 0 ? (
              <p className="text-sm">Schema nu conține tabele.</p>
            ) : (
              <div className="grid gap-2">
                {schema.tables.map((table) => {
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

        <article className="rounded-xl border border-violet-200 bg-violet-50 p-4">
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
          <p className="mt-2 text-sm text-violet-900">
            Sunt luate în calcul numai mesajele primite după pornirea testului.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <fieldset className="rounded-lg border border-violet-200 bg-white p-3">
              <legend className="px-1 text-sm font-semibold text-violet-950">
                Conturi IMAP implicite
              </legend>
              <div className="grid gap-2">
                {imapAccounts.map((account) => (
                  <label
                    key={account.id}
                    className="flex items-center gap-2 text-sm"
                  >
                    <input
                      type="checkbox"
                      checked={checks.imap.accountIds.includes(account.id)}
                      onChange={(event) => {
                        setChecks((current) => ({
                          ...current,
                          imap: {
                            ...current.imap,
                            accountIds: event.target.checked
                              ? [
                                  ...new Set([
                                    ...current.imap.accountIds,
                                    account.id,
                                  ]),
                                ]
                              : current.imap.accountIds.filter(
                                  (accountId) => accountId !== account.id,
                                ),
                          },
                        }));
                      }}
                    />
                    {account.name} · {account.username}
                  </label>
                ))}
                {imapAccounts.length === 0 ? (
                  <p className="text-sm text-app-muted">
                    Configurează conturile în Setările aplicației.
                  </p>
                ) : null}
              </div>
            </fieldset>
            <label className="grid gap-1 text-sm font-semibold text-violet-950">
              Mailbox
              <input
                className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 font-normal"
                value={checks.imap.mailbox}
                onChange={(event) => {
                  setChecks((current) => ({
                    ...current,
                    imap: { ...current.imap, mailbox: event.target.value },
                  }));
                }}
              />
            </label>
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {(
              [
                ["Expeditor exact", "sender"],
                ["Destinatar exact", "recipient"],
                ["Subiect exact", "subjectEquals"],
                ["Subiect conține", "subjectContains"],
              ] as const
            ).map(([label, key]) => (
              <label
                key={key}
                className="grid gap-1 text-sm font-semibold text-violet-950"
              >
                {label}
                <input
                  className="min-h-10 rounded-lg border border-violet-200 bg-white px-3 font-normal"
                  value={checks.imap[key]}
                  onChange={(event) => {
                    setChecks((current) => ({
                      ...current,
                      imap: { ...current.imap, [key]: event.target.value },
                    }));
                  }}
                />
              </label>
            ))}
          </div>
          <label className="mt-3 grid gap-1 text-sm font-semibold text-violet-950">
            Corpul mesajului conține
            <textarea
              className="min-h-20 rounded-lg border border-violet-200 bg-white p-3 font-normal"
              value={checks.imap.bodyContains}
              onChange={(event) => {
                setChecks((current) => ({
                  ...current,
                  imap: { ...current.imap, bodyContains: event.target.value },
                }));
              }}
            />
          </label>
        </article>
      </div>

      <label className="mt-4 grid gap-1 text-sm font-semibold">
        Instrucțiune AI comună pentru MySQL și e-mail
        <textarea
          className="min-h-36 rounded-lg border border-orange-200 bg-orange-50 p-3 font-normal"
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
