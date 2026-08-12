import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  MySqlConnectionErrors,
  MySqlConnectionInput,
  MySqlSchemaResult,
  MySqlSettingsSummary,
  MySqlTableSchema,
  TableIdentityConfig,
} from "../shared/mysql.js";
import {
  hasMySqlConnectionErrors,
  validateMySqlConnectionInput,
} from "../shared/mysql.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";

export interface MySqlSettingsPanelProps {
  api: SemanticAppApi;
  projectId: string;
}

interface ConnectionForm {
  host: string;
  port: string;
  database: string;
  username: string;
  password: string;
  ssl: boolean;
}

const emptyForm: ConnectionForm = {
  host: "localhost",
  port: "3306",
  database: "",
  username: "",
  password: "",
  ssl: false,
};

const toForm = (settings: MySqlSettingsSummary): ConnectionForm => ({
  host: settings.host,
  port: String(settings.port),
  database: settings.database,
  username: settings.username,
  password: "",
  ssl: settings.ssl,
});

const tableSelections = (result: MySqlSchemaResult): Record<string, string[]> =>
  Object.fromEntries(
    result.tables.map((table) => [table.name, table.identityColumns]),
  );

const manualTables = (result: MySqlSchemaResult): Set<string> =>
  new Set(
    result.tables
      .filter((table) => table.identitySource === "manual")
      .map((table) => table.name),
  );

const errorMessage = (error: unknown, fallback: string): string =>
  error instanceof Error && error.message.trim().length > 0
    ? error.message
    : fallback;

export const MySqlSettingsPanel = ({
  api,
  projectId,
}: MySqlSettingsPanelProps) => {
  const [settings, setSettings] = useState<MySqlSettingsSummary>();
  const [form, setForm] = useState<ConnectionForm>(emptyForm);
  const [errors, setErrors] = useState<MySqlConnectionErrors>({});
  const [schema, setSchema] = useState<MySqlSchemaResult>();
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [manual, setManual] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<
    "loading" | "saving" | "testing" | "schema" | "identity" | undefined
  >("loading");
  const [message, setMessage] = useState<string>();
  const [failure, setFailure] = useState<string>();

  useEffect(() => {
    let active = true;
    setBusy("loading");
    setFailure(undefined);
    void api
      .getMySqlSettings(projectId)
      .then((loaded) => {
        if (!active) return;
        setSettings(loaded);
        setForm(toForm(loaded));
      })
      .catch((error: unknown) => {
        if (active) {
          setFailure(
            errorMessage(error, "Configurația MySQL nu a putut fi încărcată."),
          );
        }
      })
      .finally(() => {
        if (active) setBusy(undefined);
      });
    return () => {
      active = false;
    };
  }, [api, projectId]);

  const connectionInput = useMemo<MySqlConnectionInput>(
    () => ({
      host: form.host,
      port: Number(form.port),
      database: form.database,
      username: form.username,
      ...(form.password.length === 0 && settings?.passwordConfigured === true
        ? {}
        : { password: form.password }),
      ssl: form.ssl,
    }),
    [form, settings?.passwordConfigured],
  );

  const validate = (): boolean => {
    const nextErrors = validateMySqlConnectionInput(
      connectionInput,
      settings?.passwordConfigured !== true,
    );
    setErrors(nextErrors);
    return !hasMySqlConnectionErrors(nextErrors);
  };

  const updateForm = (patch: Partial<ConnectionForm>): void => {
    setForm((current) => ({ ...current, ...patch }));
    setErrors({});
    setMessage(undefined);
    setFailure(undefined);
    setSchema(undefined);
  };

  const saveSettings = async (): Promise<void> => {
    if (!validate()) return;
    setBusy("saving");
    setFailure(undefined);
    try {
      const saved = await api.saveMySqlSettings(projectId, connectionInput);
      setSettings(saved);
      setForm(toForm(saved));
      setMessage(
        "Configurația MySQL a fost salvată local, iar parola este criptată de sistem.",
      );
    } catch (error) {
      setFailure(
        errorMessage(error, "Configurația MySQL nu a putut fi salvată."),
      );
    } finally {
      setBusy(undefined);
    }
  };

  const testConnection = async (): Promise<void> => {
    if (!validate()) return;
    setBusy("testing");
    setFailure(undefined);
    setMessage(undefined);
    try {
      const result = await api.testMySqlConnection(projectId, connectionInput);
      setMessage(`${result.message} ${result.latencyMs} ms.`);
    } catch (error) {
      setFailure(errorMessage(error, "Conexiunea MySQL a eșuat."));
    } finally {
      setBusy(undefined);
    }
  };

  const applySchema = (result: MySqlSchemaResult): void => {
    setSchema(result);
    setSelections(tableSelections(result));
    setManual(manualTables(result));
  };

  const loadSchema = async (): Promise<void> => {
    if (!validate()) return;
    setBusy("schema");
    setFailure(undefined);
    setMessage(undefined);
    try {
      const result = await api.loadMySqlSchema(projectId, connectionInput);
      applySchema(result);
      setMessage(
        `Schema ${result.database} a fost încărcată: ${result.tables.length} tabele.`,
      );
    } catch (error) {
      setFailure(errorMessage(error, "Schema MySQL nu a putut fi încărcată."));
    } finally {
      setBusy(undefined);
    }
  };

  const toggleIdentityColumn = (
    table: MySqlTableSchema,
    columnName: string,
  ): void => {
    setManual((current) => new Set(current).add(table.name));
    setSelections((current) => {
      const selected = new Set(current[table.name] ?? []);
      if (selected.has(columnName)) {
        selected.delete(columnName);
      } else {
        selected.add(columnName);
      }
      return { ...current, [table.name]: [...selected] };
    });
    setMessage(undefined);
  };

  const usePrimaryKey = (table: MySqlTableSchema): void => {
    setManual((current) => {
      const next = new Set(current);
      next.delete(table.name);
      return next;
    });
    setSelections((current) => ({
      ...current,
      [table.name]: table.primaryKey,
    }));
  };

  const saveIdentities = async (): Promise<void> => {
    if (schema === undefined) return;
    const identities: TableIdentityConfig[] = schema.tables
      .filter((table) => manual.has(table.name))
      .map((table) => ({
        tableName: table.name,
        columns: selections[table.name] ?? [],
      }))
      .filter((identity) => identity.columns.length > 0);
    setBusy("identity");
    setFailure(undefined);
    setMessage(undefined);
    try {
      const result = await api.saveMySqlIdentityConfig(projectId, identities);
      applySchema(result);
      setSettings((current) =>
        current === undefined ? current : { ...current, identities },
      );
      setMessage(
        "Identity columns au fost salvate. Coloanele multiple vor fi combinate cu AND.",
      );
    } catch (error) {
      setFailure(
        errorMessage(error, "Identity columns nu au putut fi salvate."),
      );
    } finally {
      setBusy(undefined);
    }
  };

  const disabled = busy !== undefined;

  return (
    <section
      className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4"
      aria-labelledby="mysql-settings-title"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
            MySQL · V1–V10
          </p>
          <h3 id="mysql-settings-title" className="mt-1 text-lg font-semibold">
            Conexiunea bazei de date
          </h3>
          <p className="mt-1 text-sm text-app-muted">
            Configurație per proiect. Parola nu este trimisă în renderer după
            salvare și nu apare în exporturi ori erori.
          </p>
        </div>
        <span
          className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
            settings?.passwordConfigured === true
              ? "border-emerald-200 bg-emerald-50 text-emerald-800"
              : "border-amber-200 bg-amber-50 text-amber-900"
          }`}
        >
          {settings?.passwordConfigured === true
            ? "Configurație salvată"
            : "Neconfigurat"}
        </span>
      </div>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Input
          label="Host"
          value={form.host}
          disabled={disabled}
          {...(errors.host === undefined ? {} : { error: errors.host })}
          placeholder="localhost"
          onChange={(event) => updateForm({ host: event.target.value })}
        />
        <Input
          label="Port"
          type="number"
          min={1}
          max={65_535}
          value={form.port}
          disabled={disabled}
          {...(errors.port === undefined ? {} : { error: errors.port })}
          onChange={(event) => updateForm({ port: event.target.value })}
        />
        <Input
          label="Bază de date"
          value={form.database}
          disabled={disabled}
          {...(errors.database === undefined ? {} : { error: errors.database })}
          onChange={(event) => updateForm({ database: event.target.value })}
        />
        <Input
          label="Username"
          autoComplete="off"
          value={form.username}
          disabled={disabled}
          {...(errors.username === undefined ? {} : { error: errors.username })}
          onChange={(event) => updateForm({ username: event.target.value })}
        />
        <Input
          label="Parolă"
          type="password"
          autoComplete="new-password"
          value={form.password}
          disabled={disabled}
          {...(errors.password === undefined ? {} : { error: errors.password })}
          hint={
            settings?.passwordConfigured === true
              ? "Lasă gol pentru a păstra parola salvată."
              : "Poate fi goală dacă serverul permite autentificarea fără parolă."
          }
          onChange={(event) => updateForm({ password: event.target.value })}
        />
        <label className="flex min-h-10 items-center gap-2 self-end rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm font-medium">
          <input
            type="checkbox"
            checked={form.ssl}
            disabled={disabled}
            onChange={(event) => updateForm({ ssl: event.target.checked })}
          />
          Conexiune SSL
        </label>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <Button disabled={disabled} onClick={() => void saveSettings()}>
          {busy === "saving" ? "Se salvează..." : "Salvează configurația"}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void testConnection()}
        >
          {busy === "testing" ? "Se testează..." : "Testează conexiunea"}
        </Button>
        <Button
          variant="secondary"
          disabled={disabled}
          onClick={() => void loadSchema()}
        >
          {busy === "schema" ? "Se încarcă..." : "Încarcă schema și tabelele"}
        </Button>
      </div>

      {message ? (
        <p
          className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800"
          role="status"
        >
          {message}
        </p>
      ) : null}
      {failure ? (
        <p
          className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
          role="alert"
        >
          {failure}
        </p>
      ) : null}

      {schema !== undefined ? (
        <section className="mt-5 border-t border-app-border pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="font-semibold">
                Tabele și identity columns · {schema.database}
              </h4>
              <p className="mt-1 text-sm text-app-muted">
                Primary key este folosit implicit. Selecțiile manuale suprascriu
                cheia; mai multe coloane înseamnă condiție AND.
              </p>
            </div>
            <Button
              disabled={disabled || settings?.passwordConfigured !== true}
              onClick={() => void saveIdentities()}
            >
              {busy === "identity"
                ? "Se salvează..."
                : "Salvează identity config"}
            </Button>
          </div>
          {settings?.passwordConfigured !== true ? (
            <p className="mt-2 text-xs text-amber-800">
              Salvează mai întâi configurația conexiunii pentru a persista
              identity columns.
            </p>
          ) : null}
          {schema.tables.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed border-app-border p-4 text-sm">
              Baza de date nu conține tabele obișnuite.
            </p>
          ) : (
            <div className="mt-4 grid gap-3">
              {schema.tables.map((table) => {
                const selected = new Set(selections[table.name] ?? []);
                const isManual = manual.has(table.name);
                return (
                  <details
                    key={table.name}
                    className="rounded-lg border border-app-border bg-app-surface"
                  >
                    <summary className="cursor-pointer px-4 py-3 font-semibold">
                      {table.name} · {table.columns.length} coloane ·{" "}
                      {isManual
                        ? "identity manual"
                        : table.primaryKey.length > 0
                          ? `PK: ${table.primaryKey.join(" AND ")}`
                          : "fără identity"}
                    </summary>
                    <div className="border-t border-app-border p-4">
                      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {table.columns.map((column) => (
                          <label
                            key={column.name}
                            className="flex items-start gap-2 rounded-lg border border-app-border px-3 py-2 text-sm"
                          >
                            <input
                              className="mt-1"
                              type="checkbox"
                              checked={selected.has(column.name)}
                              disabled={disabled}
                              onChange={() =>
                                toggleIdentityColumn(table, column.name)
                              }
                            />
                            <span>
                              <strong>{column.name}</strong>
                              <span className="block text-xs text-app-muted">
                                {column.columnType}
                                {column.nullable ? " · NULL" : " · NOT NULL"}
                                {column.primaryKey ? " · PRIMARY KEY" : ""}
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                      {isManual && table.primaryKey.length > 0 ? (
                        <Button
                          className="mt-3"
                          variant="secondary"
                          disabled={disabled}
                          onClick={() => usePrimaryKey(table)}
                        >
                          Revino la primary key detectat
                        </Button>
                      ) : null}
                    </div>
                  </details>
                );
              })}
            </div>
          )}
        </section>
      ) : null}
    </section>
  );
};
