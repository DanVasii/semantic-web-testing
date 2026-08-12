import { useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  MySqlCleanupRowSelection,
  MySqlNormalizedValue,
  MySqlRunDiff,
  MySqlSnapshotRow,
} from "../shared/mysql.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { Button } from "./components/Button.js";

export interface MySqlRunPanelProps {
  api: SemanticAppApi;
  snapshot: RunnerSnapshot;
  onSnapshot: (snapshot: RunnerSnapshot) => void;
}

interface SelectedCleanupRow {
  diffId: string;
  row: MySqlCleanupRowSelection;
}

const rowKey = (
  diffId: string,
  tableName: string,
  identity: MySqlSnapshotRow,
): string => `${diffId}:${tableName}:${JSON.stringify(identity)}`;

const valueText = (value: MySqlNormalizedValue | undefined): string =>
  value === null ? "NULL" : value === undefined ? "—" : String(value);

const UpdatedRows = ({ diff }: { diff: MySqlRunDiff["tables"][number] }) =>
  diff.updated.length === 0 ? null : (
    <div className="mt-3 overflow-auto">
      <p className="text-xs font-semibold tracking-wide uppercase">
        Actualizate ({diff.updated.length})
      </p>
      <table className="mt-2 min-w-full border-collapse text-left text-xs">
        <thead>
          <tr>
            <th className="border border-app-border p-2">Identitate</th>
            {diff.columns.map((column) => (
              <th key={column} className="border border-app-border p-2">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {diff.updated.map((row) => (
            <tr key={JSON.stringify(row.identity)}>
              <td className="border border-app-border p-2 font-mono">
                {JSON.stringify(row.identity)}
              </td>
              {diff.columns.map((column) => {
                const changed = row.changedColumns.includes(column);
                return (
                  <td
                    key={column}
                    className={`border border-app-border p-2 ${
                      changed ? "bg-amber-100 text-amber-950" : ""
                    }`}
                  >
                    {changed ? (
                      <>
                        <span className="block line-through opacity-60">
                          {valueText(row.before[column])}
                        </span>
                        <strong className="block">
                          {valueText(row.after[column])}
                        </strong>
                      </>
                    ) : (
                      valueText(row.after[column])
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

export const MySqlRunPanel = ({
  api,
  snapshot,
  onSnapshot,
}: MySqlRunPanelProps) => {
  const [selected, setSelected] = useState<Record<string, SelectedCleanupRow>>(
    {},
  );
  const [busy, setBusy] = useState<"preview" | "confirm">();
  const [error, setError] = useState<string>();
  const details = snapshot.mysql;
  const selections = useMemo(() => Object.values(selected), [selected]);

  if (details === undefined) return null;

  const preview = details.cleanupPreview;
  const previewCleanup = async (
    diffId: string,
    explicitRows?: MySqlCleanupRowSelection[],
  ): Promise<void> => {
    if (snapshot.run === undefined) return;
    const rows =
      explicitRows ??
      selections
        .filter((selection) => selection.diffId === diffId)
        .map((selection) => selection.row);
    setBusy("preview");
    setError(undefined);
    try {
      onSnapshot(await api.previewMySqlCleanup(snapshot.run.id, diffId, rows));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Preview-ul cleanup MySQL a eșuat.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const confirmCleanup = async (): Promise<void> => {
    if (snapshot.run === undefined || preview === undefined) return;
    setBusy("confirm");
    setError(undefined);
    try {
      onSnapshot(await api.confirmMySqlCleanup(snapshot.run.id, preview.id));
      setSelected({});
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Cleanup-ul MySQL a eșuat.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <section
      className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-4"
      aria-label="Diff MySQL"
    >
      <p className="text-xs font-semibold tracking-wide text-sky-800 uppercase">
        MySQL · W1–W14 / X1–X10
      </p>
      <h4 className="mt-1 font-semibold text-sky-950">
        Snapshot-uri și modificări ale bazei de date
      </h4>
      <p className="mt-1 text-sm text-sky-900">
        Baseline: {details.baselineSnapshotId ?? "în curs"} ·{" "}
        {details.diffs.length} check-uri capturate
      </p>

      {details.diffs.map((diff) => (
        <article
          key={diff.id}
          className="mt-4 rounded-lg border border-sky-200 bg-white p-3"
        >
          <p className="text-xs font-mono text-app-muted">{diff.id}</p>
          {diff.tables.some((table) => table.inserted.length > 0) ? (
            <div className="mt-3 flex flex-wrap gap-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
              <Button
                variant="danger"
                disabled={busy !== undefined}
                onClick={() => {
                  const rows = diff.tables.flatMap((table) =>
                    table.inserted.map((row) => ({
                      tableName: table.tableName,
                      identity: row.identity,
                    })),
                  );
                  void previewCleanup(diff.id, rows);
                }}
              >
                Preview cleanup toate tabelele
              </Button>
              <span className="self-center text-xs text-emerald-900">
                Include toate cele{" "}
                {diff.tables.reduce(
                  (total, table) => total + table.inserted.length,
                  0,
                )}{" "}
                rânduri noi. Confirmarea rămâne obligatorie.
              </span>
            </div>
          ) : null}
          {diff.tables.map((table) => (
            <section key={table.tableName} className="mt-3">
              <h5 className="font-semibold">{table.tableName}</h5>
              <p className="text-xs text-app-muted">
                Identitate AND: {table.identityColumns.join(" + ")}
              </p>

              {table.inserted.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-emerald-800 uppercase">
                    Inserate ({table.inserted.length})
                  </p>
                  <ul className="mt-2 grid gap-2">
                    {table.inserted.map((row) => {
                      const key = rowKey(
                        diff.id,
                        table.tableName,
                        row.identity,
                      );
                      return (
                        <li
                          key={key}
                          className="rounded border border-emerald-200 bg-emerald-50 p-2"
                        >
                          <label className="flex items-start gap-2">
                            <input
                              type="checkbox"
                              checked={selected[key] !== undefined}
                              onChange={(event) => {
                                setSelected((current) => {
                                  const next = { ...current };
                                  if (event.target.checked) {
                                    next[key] = {
                                      diffId: diff.id,
                                      row: {
                                        tableName: table.tableName,
                                        identity: row.identity,
                                      },
                                    };
                                  } else {
                                    delete next[key];
                                  }
                                  return next;
                                });
                              }}
                            />
                            <code className="text-xs">
                              {JSON.stringify(row.row)}
                            </code>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  <Button
                    className="mt-2"
                    variant="secondary"
                    disabled={
                      busy !== undefined ||
                      !selections.some(
                        (selection) => selection.diffId === diff.id,
                      )
                    }
                    onClick={() => void previewCleanup(diff.id)}
                  >
                    {busy === "preview"
                      ? "Se generează..."
                      : "Preview cleanup rânduri selectate"}
                  </Button>
                  <Button
                    className="mt-2 ml-2"
                    variant="danger"
                    disabled={busy !== undefined}
                    onClick={() => {
                      void previewCleanup(
                        diff.id,
                        table.inserted.map((row) => ({
                          tableName: table.tableName,
                          identity: row.identity,
                        })),
                      );
                    }}
                  >
                    Preview cleanup tot tabelul
                  </Button>
                </div>
              ) : null}

              {table.deleted.length > 0 ? (
                <div className="mt-3">
                  <p className="text-xs font-semibold tracking-wide text-red-800 uppercase">
                    Șterse ({table.deleted.length})
                  </p>
                  <pre className="mt-2 overflow-auto rounded bg-red-50 p-2 text-xs">
                    {JSON.stringify(
                      table.deleted.map((row) => row.row),
                      null,
                      2,
                    )}
                  </pre>
                </div>
              ) : null}

              <UpdatedRows diff={table} />

              {table.duplicateIdentities.length > 0 ? (
                <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
                  {table.duplicateIdentities.length} identități duplicate nu au
                  fost comparate sau incluse în cleanup.
                </p>
              ) : null}
            </section>
          ))}
        </article>
      ))}

      {preview !== undefined ? (
        <section className="mt-4 rounded-lg border border-red-300 bg-red-50 p-3">
          <h5 className="font-semibold text-red-950">
            Confirmare cleanup MySQL
          </h5>
          <p className="mt-1 text-sm text-red-900">
            Vor fi șterse exclusiv cele {preview.rows.length} rânduri inserate
            de mai jos, într-o singură tranzacție.
          </p>
          <ul className="mt-2 grid gap-2 text-xs">
            {preview.rows.map((row) => (
              <li
                key={`${row.tableName}-${JSON.stringify(row.identity)}`}
                className="rounded bg-white p-2"
              >
                <code>{row.sqlPreview}</code>
                <span className="mt-1 block">
                  {row.conditions
                    .map(
                      (condition) =>
                        `${condition.column} ${condition.operator} ${valueText(condition.value)}`,
                    )
                    .join(" AND ")}
                </span>
              </li>
            ))}
          </ul>
          <Button
            className="mt-3"
            variant="danger"
            disabled={busy !== undefined}
            onClick={() => void confirmCleanup()}
          >
            {busy === "confirm"
              ? "Se șterge tranzacțional..."
              : "Confirmă ștergerea rândurilor inserate"}
          </Button>
        </section>
      ) : null}

      {details.cleanupLogs.length > 0 ? (
        <ul className="mt-3 grid gap-1 text-xs">
          {details.cleanupLogs.map((log) => (
            <li key={log.id}>
              Cleanup {log.status} · {log.affectedRows} rânduri · {log.id}
            </li>
          ))}
        </ul>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
};
