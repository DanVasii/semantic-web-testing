import type {
  MySqlCleanupLog,
  MySqlCleanupPreview,
  MySqlCleanupRowSelection,
  MySqlNormalizedValue,
  MySqlRunDetails,
  MySqlRunDiff,
  MySqlRunSnapshot,
  MySqlSnapshotRow,
  MySqlTableSnapshot,
} from "../../shared/mysql.js";
import type { CheckStep, MysqlCheckConfig } from "../../shared/test-model.js";
import {
  MySqlRunDataRepository,
  RunRepository,
} from "../persistence/repositories.js";
import { compareMySqlSnapshots, mysqlIdentityKey } from "./mysql-diff.js";
import type { MySqlSession } from "./mysql-gateway.js";
import { MySqlService } from "./mysql-service.js";

export interface MySqlSnapshotServiceOptions {
  createId: () => string;
  now: () => Date;
}

interface PendingCleanup {
  preview: MySqlCleanupPreview;
  logId: string;
}

const quoteIdentifier = (value: string): string =>
  `\`${value.replaceAll("`", "``")}\``;

const normalizedValue = (value: unknown): MySqlNormalizedValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new Error("Snapshot-ul MySQL conține un număr nevalid.");
    }
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return `base64:${value.toString("base64")}`;
  throw new Error("Snapshot-ul MySQL conține o valoare SQL nesuportată.");
};

const normalizeRow = (row: Record<string, unknown>): MySqlSnapshotRow =>
  Object.fromEntries(
    Object.entries(row).map(([column, value]) => [
      column,
      normalizedValue(value),
    ]),
  );

const mysqlConfig = (step: CheckStep): MysqlCheckConfig => {
  if (
    step.checkType !== "mysql" ||
    !("tableNames" in step.config) ||
    !("identities" in step.config)
  ) {
    throw new Error("Pasul nu este un check MySQL valid.");
  }
  return step.config;
};

const selectionKey = (selection: MySqlCleanupRowSelection): string =>
  `${selection.tableName}:${JSON.stringify(
    Object.entries(selection.identity)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([column, value]) => [column, value]),
  )}`;

export class MySqlSnapshotService {
  private readonly pendingCleanups = new Map<string, PendingCleanup>();

  public constructor(
    private readonly mysql: MySqlService,
    private readonly repository: MySqlRunDataRepository,
    private readonly runs: RunRepository,
    private readonly options: MySqlSnapshotServiceOptions,
  ) {}

  public async captureBaseline(
    projectId: string,
    runId: string,
    steps: CheckStep[],
  ): Promise<MySqlRunSnapshot | undefined> {
    if (steps.length === 0) return undefined;
    if (this.repository.findBaseline(runId) !== undefined) {
      throw new Error("Baseline-ul MySQL există deja pentru această rulare.");
    }

    const tableIdentities = new Map<string, string[]>();
    for (const step of steps) {
      const config = mysqlConfig(step);
      for (const tableName of config.tableNames) {
        const identity = config.identities.find(
          (candidate) => candidate.tableName === tableName,
        );
        if (identity === undefined) {
          throw new Error(
            `Check-ul MySQL nu definește identitatea tabelei ${tableName}.`,
          );
        }
        const existing = tableIdentities.get(tableName);
        if (
          existing !== undefined &&
          JSON.stringify(existing) !== JSON.stringify(identity.columns)
        ) {
          throw new Error(
            `Tabela ${tableName} folosește identități diferite în același test.`,
          );
        }
        tableIdentities.set(tableName, [...identity.columns]);
      }
    }

    const snapshot: MySqlRunSnapshot = {
      id: this.options.createId(),
      runId,
      kind: "baseline",
      capturedAt: this.options.now().toISOString(),
      tables: await this.captureTables(projectId, tableIdentities),
    };
    return this.repository.createSnapshot(snapshot);
  }

  public async check(
    projectId: string,
    runId: string,
    step: CheckStep,
  ): Promise<MySqlRunDiff> {
    const config = mysqlConfig(step);
    const baseline = this.repository.findBaseline(runId);
    if (baseline === undefined) {
      throw new Error("Baseline-ul MySQL al rulării nu există.");
    }
    const selectedTables = new Set(config.tableNames);
    const baselineTables = baseline.tables.filter((table) =>
      selectedTables.has(table.tableName),
    );
    if (baselineTables.length !== selectedTables.size) {
      throw new Error(
        "Baseline-ul MySQL nu conține toate tabelele check-ului.",
      );
    }
    const tableIdentities = new Map(
      baselineTables.map((table) => [
        table.tableName,
        [...table.identityColumns],
      ]),
    );
    const current: MySqlRunSnapshot = {
      id: this.options.createId(),
      runId,
      kind: "current",
      checkStepId: step.id,
      capturedAt: this.options.now().toISOString(),
      tables: await this.captureTables(projectId, tableIdentities),
    };
    this.repository.createSnapshot(current);
    const diff: MySqlRunDiff = {
      id: this.options.createId(),
      runId,
      checkStepId: step.id,
      baselineSnapshotId: baseline.id,
      currentSnapshotId: current.id,
      createdAt: this.options.now().toISOString(),
      tables: compareMySqlSnapshots(
        { ...baseline, tables: baselineTables },
        current,
      ),
    };
    return this.repository.createDiff(diff);
  }

  public getRunDetails(runId: string): MySqlRunDetails {
    const baseline = this.repository.findBaseline(runId);
    return {
      ...(baseline === undefined ? {} : { baselineSnapshotId: baseline.id }),
      diffs: this.repository.listDiffs(runId),
      cleanupLogs: this.repository.listCleanupLogs(runId),
    };
  }

  public previewCleanup(
    runId: string,
    diffId: string,
    selections: MySqlCleanupRowSelection[],
  ): MySqlCleanupPreview {
    const run = this.runs.findById(runId);
    const diff = this.repository.findDiff(diffId);
    if (run === undefined || diff === undefined || diff.runId !== runId) {
      throw new Error("Diff-ul MySQL nu aparține rulării.");
    }
    if (selections.length === 0) {
      throw new Error("Selectează cel puțin un rând inserat.");
    }
    if (new Set(selections.map(selectionKey)).size !== selections.length) {
      throw new Error("Selecția cleanup conține rânduri duplicate.");
    }

    const rows = selections.map((selection) => {
      const table = diff.tables.find(
        (candidate) => candidate.tableName === selection.tableName,
      );
      if (table === undefined) {
        throw new Error(`Tabela ${selection.tableName} nu există în diff.`);
      }
      const selectedKey = mysqlIdentityKey(
        selection.identity,
        table.identityColumns,
      );
      const inserted = table.inserted.find(
        (candidate) =>
          mysqlIdentityKey(candidate.identity, table.identityColumns) ===
          selectedKey,
      );
      if (inserted === undefined) {
        throw new Error(
          "Cleanup-ul permite exclusiv rânduri detectate ca inserate.",
        );
      }
      const conditions = table.identityColumns.map((column) => {
        const value = inserted.identity[column] ?? null;
        return {
          column,
          operator: value === null ? ("<=>" as const) : ("=" as const),
          value,
        };
      });
      const where = conditions
        .map(
          (condition) =>
            `${quoteIdentifier(condition.column)} ${condition.operator} ?`,
        )
        .join(" AND ");
      return {
        tableName: table.tableName,
        identity: structuredClone(inserted.identity),
        conditions,
        sqlPreview: `DELETE FROM ${quoteIdentifier(table.tableName)} WHERE ${where}`,
      };
    });

    const createdAt = this.options.now().toISOString();
    const preview: MySqlCleanupPreview = {
      id: this.options.createId(),
      runId,
      diffId,
      createdAt,
      rows,
    };
    const logId = this.options.createId();
    this.repository.createCleanupLog({
      id: logId,
      runId,
      diffId,
      previewId: preview.id,
      status: "pending",
      startedAt: createdAt,
      rows: structuredClone(rows),
      affectedRows: 0,
    });
    this.pendingCleanups.set(preview.id, { preview, logId });
    return structuredClone(preview);
  }

  public async confirmCleanup(
    projectId: string,
    runId: string,
    previewId: string,
  ): Promise<MySqlCleanupLog> {
    const pending = this.pendingCleanups.get(previewId);
    const run = this.runs.findById(runId);
    if (
      pending === undefined ||
      pending.preview.runId !== runId ||
      run === undefined ||
      run.projectId !== projectId
    ) {
      throw new Error("Preview-ul cleanup nu este valid sau a expirat.");
    }

    let affectedRows = 0;
    try {
      await this.mysql.withSavedSession(projectId, async (session) => {
        await session.beginTransaction();
        try {
          for (const row of pending.preview.rows) {
            const count = await this.countMatchingRows(session, row);
            if (count !== 1) {
              throw new Error(
                `Identitatea din ${row.tableName} corespunde la ${count} rânduri.`,
              );
            }
            const result = await session.execute(
              row.sqlPreview,
              row.conditions.map((condition) => condition.value),
            );
            if (result.affectedRows !== 1) {
              throw new Error(
                `Ștergerea din ${row.tableName} nu a afectat exact un rând.`,
              );
            }
            affectedRows += result.affectedRows;
          }
          for (const row of pending.preview.rows) {
            if ((await this.countMatchingRows(session, row)) !== 0) {
              throw new Error(
                `Rândul din ${row.tableName} există încă după cleanup.`,
              );
            }
          }
          await session.commit();
        } catch (error) {
          await session.rollback();
          throw error;
        }
      });
      const completed: MySqlCleanupLog = {
        id: pending.logId,
        runId,
        diffId: pending.preview.diffId,
        previewId,
        status: "completed",
        startedAt: pending.preview.createdAt,
        endedAt: this.options.now().toISOString(),
        rows: structuredClone(pending.preview.rows),
        affectedRows,
      };
      this.pendingCleanups.delete(previewId);
      return this.repository.updateCleanupLog(completed);
    } catch {
      const failed: MySqlCleanupLog = {
        id: pending.logId,
        runId,
        diffId: pending.preview.diffId,
        previewId,
        status: "failed",
        startedAt: pending.preview.createdAt,
        endedAt: this.options.now().toISOString(),
        rows: structuredClone(pending.preview.rows),
        affectedRows: 0,
        error: "Cleanup-ul MySQL a eșuat și tranzacția a fost anulată.",
      };
      this.pendingCleanups.delete(previewId);
      this.repository.updateCleanupLog(failed);
      throw new Error(failed.error);
    }
  }

  private async captureTables(
    projectId: string,
    tableIdentities: Map<string, string[]>,
  ): Promise<MySqlTableSnapshot[]> {
    const schema = await this.mysql.loadSchema(projectId);
    const schemaByName = new Map(
      schema.tables.map((table) => [table.name, table]),
    );
    for (const [tableName, identities] of tableIdentities) {
      const table = schemaByName.get(tableName);
      if (table === undefined) {
        throw new Error(`Tabela ${tableName} nu există în schema MySQL.`);
      }
      const columns = new Set(table.columns.map((column) => column.name));
      if (
        identities.length === 0 ||
        identities.some((identity) => !columns.has(identity))
      ) {
        throw new Error(
          `Identity columns pentru tabela ${tableName} nu sunt valide.`,
        );
      }
    }

    return this.mysql.withSavedSession(projectId, async (session) => {
      const tables: MySqlTableSnapshot[] = [];
      for (const [tableName, identityColumns] of tableIdentities) {
        const table = schemaByName.get(tableName);
        if (table === undefined) continue;
        const rows = await session.query(
          `SELECT * FROM ${quoteIdentifier(tableName)}`,
        );
        tables.push({
          tableName,
          columns: table.columns.map((column) => column.name),
          identityColumns: [...identityColumns],
          rows: rows.map(normalizeRow),
        });
      }
      return tables;
    });
  }

  private async countMatchingRows(
    session: MySqlSession,
    row: MySqlCleanupPreview["rows"][number],
  ): Promise<number> {
    const where = row.conditions
      .map(
        (condition) =>
          `${quoteIdentifier(condition.column)} ${condition.operator} ?`,
      )
      .join(" AND ");
    const result = await session.query(
      `SELECT COUNT(*) AS row_count FROM ${quoteIdentifier(row.tableName)} WHERE ${where}`,
      row.conditions.map((condition) => condition.value),
    );
    return Number(result[0]?.row_count ?? Number.NaN);
  }
}
