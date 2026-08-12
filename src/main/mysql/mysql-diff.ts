import type {
  MySqlDuplicateIdentity,
  MySqlNormalizedValue,
  MySqlRunSnapshot,
  MySqlSnapshotRow,
  MySqlTableDiff,
  MySqlTableSnapshot,
} from "../../shared/mysql.js";

const valueKey = (value: MySqlNormalizedValue): string =>
  value === null ? "null" : `${typeof value}:${JSON.stringify(value)}`;

export const mysqlIdentityKey = (
  row: MySqlSnapshotRow,
  identityColumns: string[],
): string => {
  if (identityColumns.length === 0) {
    throw new Error("Tabela MySQL nu are coloane de identitate.");
  }
  return JSON.stringify(
    identityColumns.map((column) => {
      if (!(column in row)) {
        throw new Error(`Coloana de identitate ${column} lipsește din rând.`);
      }
      return [column, valueKey(row[column] ?? null)];
    }),
  );
};

const identityOf = (
  row: MySqlSnapshotRow,
  identityColumns: string[],
): MySqlSnapshotRow =>
  Object.fromEntries(
    identityColumns.map((column) => [column, row[column] ?? null]),
  );

const groupByIdentity = (
  table: MySqlTableSnapshot,
): Map<string, MySqlSnapshotRow[]> => {
  const groups = new Map<string, MySqlSnapshotRow[]>();
  for (const row of table.rows) {
    const key = mysqlIdentityKey(row, table.identityColumns);
    const rows = groups.get(key) ?? [];
    rows.push(row);
    groups.set(key, rows);
  }
  return groups;
};

const rowsEqual = (
  before: MySqlSnapshotRow,
  after: MySqlSnapshotRow,
  columns: string[],
): string[] =>
  columns.filter(
    (column) =>
      valueKey(before[column] ?? null) !== valueKey(after[column] ?? null),
  );

export const compareMySqlTableSnapshots = (
  baseline: MySqlTableSnapshot,
  current: MySqlTableSnapshot,
): MySqlTableDiff => {
  if (baseline.tableName !== current.tableName) {
    throw new Error("Snapshot-urile MySQL aparțin unor tabele diferite.");
  }
  if (
    JSON.stringify(baseline.identityColumns) !==
    JSON.stringify(current.identityColumns)
  ) {
    throw new Error(
      `Identity columns s-au schimbat pentru tabela ${baseline.tableName}.`,
    );
  }

  const columns = [...new Set([...baseline.columns, ...current.columns])];
  const beforeGroups = groupByIdentity(baseline);
  const afterGroups = groupByIdentity(current);
  const keys = new Set([...beforeGroups.keys(), ...afterGroups.keys()]);
  const inserted: MySqlTableDiff["inserted"] = [];
  const deleted: MySqlTableDiff["deleted"] = [];
  const updated: MySqlTableDiff["updated"] = [];
  const duplicateIdentities: MySqlDuplicateIdentity[] = [];

  for (const key of keys) {
    const beforeRows = beforeGroups.get(key) ?? [];
    const afterRows = afterGroups.get(key) ?? [];
    const representative = beforeRows[0] ?? afterRows[0];
    if (representative === undefined) continue;
    const identity = identityOf(representative, baseline.identityColumns);

    if (beforeRows.length > 1 || afterRows.length > 1) {
      duplicateIdentities.push({
        identity,
        beforeRows: structuredClone(beforeRows),
        afterRows: structuredClone(afterRows),
      });
      continue;
    }
    const before = beforeRows[0];
    const after = afterRows[0];
    if (before === undefined && after !== undefined) {
      inserted.push({ identity, row: structuredClone(after) });
      continue;
    }
    if (before !== undefined && after === undefined) {
      deleted.push({ identity, row: structuredClone(before) });
      continue;
    }
    if (before !== undefined && after !== undefined) {
      const changedColumns = rowsEqual(before, after, columns);
      if (changedColumns.length > 0) {
        updated.push({
          identity,
          before: structuredClone(before),
          after: structuredClone(after),
          changedColumns,
        });
      }
    }
  }

  return {
    tableName: baseline.tableName,
    columns,
    identityColumns: [...baseline.identityColumns],
    inserted,
    deleted,
    updated,
    duplicateIdentities,
  };
};

export const compareMySqlSnapshots = (
  baseline: MySqlRunSnapshot,
  current: MySqlRunSnapshot,
): MySqlTableDiff[] => {
  if (baseline.runId !== current.runId || baseline.kind !== "baseline") {
    throw new Error("Baseline-ul MySQL nu corespunde rulării curente.");
  }
  const currentByName = new Map(
    current.tables.map((table) => [table.tableName, table]),
  );
  return baseline.tables.map((table) => {
    const currentTable = currentByName.get(table.tableName);
    if (currentTable === undefined) {
      throw new Error(
        `Snapshot-ul curent nu conține tabela ${table.tableName}.`,
      );
    }
    return compareMySqlTableSnapshots(table, currentTable);
  });
};
