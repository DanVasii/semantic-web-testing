import type {
  MySqlNormalizedValue,
  MySqlRunDiff,
  MySqlRunSnapshot,
  MySqlSnapshotRow,
} from "../../shared/mysql.js";
import type { MysqlVariableExtractor } from "../../shared/test-stages.js";
import type {
  SessionVariableContext,
  VariablePublication,
} from "./session-variable-context.js";

export class VariableExtractionError extends Error {
  public constructor(
    public readonly variableName: string,
    public readonly reason:
      | "no_rows"
      | "ambiguous_rows"
      | "missing_column"
      | "empty_value"
      | "type_mismatch",
    message: string,
    public readonly candidateCount?: number,
  ) {
    super(message);
    this.name = "VariableExtractionError";
  }
}

const rowsFor = (
  extractor: MysqlVariableExtractor,
  diff: MySqlRunDiff,
  current?: MySqlRunSnapshot,
): MySqlSnapshotRow[] => {
  const table = diff.tables.find(
    (candidate) => candidate.tableName === extractor.tableName,
  );
  if (table === undefined) return [];
  switch (extractor.rowSource) {
    case "inserted":
      return table.inserted.map(({ row }) => row);
    case "deleted":
      return table.deleted.map(({ row }) => row);
    case "updated_before":
      return table.updated.map(({ before }) => before);
    case "updated_after":
      return table.updated.map(({ after }) => after);
    case "current_snapshot":
      return (
        current?.tables.find(
          (candidate) => candidate.tableName === extractor.tableName,
        )?.rows ?? []
      );
  }
};

const equalValue = (
  actual: MySqlNormalizedValue | undefined,
  expected: string,
): boolean => {
  if (actual === null || actual === undefined) return false;
  return String(actual) === expected;
};

const matchesFilters = (
  row: MySqlSnapshotRow,
  extractor: MysqlVariableExtractor,
  variables: SessionVariableContext,
): boolean =>
  extractor.filters.every((filter) => {
    const actual = row[filter.column];
    if (filter.operator === "is_null") return actual === null;
    if (filter.operator === "is_not_null")
      return actual !== null && actual !== undefined;
    const expected = variables.resolveText(filter.valueTemplate ?? "");
    if (filter.operator === "equals") return equalValue(actual, expected);
    if (filter.operator === "not_equals") return !equalValue(actual, expected);
    return actual !== null && actual !== undefined
      ? String(actual).includes(expected)
      : false;
  });

export const extractMysqlVariables = (
  extractors: MysqlVariableExtractor[],
  diff: MySqlRunDiff,
  variables: SessionVariableContext,
  stageId: string,
  producerId: string,
  current?: MySqlRunSnapshot,
): VariablePublication[] =>
  extractors.flatMap((extractor) => {
    const candidates = rowsFor(extractor, diff, current).filter((row) =>
      matchesFilters(row, extractor, variables),
    );
    if (candidates.length === 0) {
      if (!extractor.output.required) return [];
      throw new VariableExtractionError(
        extractor.output.name,
        "no_rows",
        `Extractorul pentru „${extractor.output.name}” nu a găsit niciun rând.`,
        0,
      );
    }
    if (candidates.length !== 1) {
      if (!extractor.output.required) return [];
      throw new VariableExtractionError(
        extractor.output.name,
        "ambiguous_rows",
        `Extractorul pentru „${extractor.output.name}” a găsit ${candidates.length} rânduri.`,
        candidates.length,
      );
    }
    const row = candidates[0]!;
    if (!Object.hasOwn(row, extractor.column)) {
      throw new VariableExtractionError(
        extractor.output.name,
        "missing_column",
        `Coloana „${extractor.column}” nu există în rezultatul MySQL.`,
        1,
      );
    }
    const value = row[extractor.column];
    if (value === null || value === undefined || value === "") {
      if (!extractor.output.required) return [];
      throw new VariableExtractionError(
        extractor.output.name,
        "empty_value",
        `Coloana „${extractor.column}” nu conține o valoare.`,
        1,
      );
    }
    return [
      {
        output: extractor.output,
        value,
        source: "mysql" as const,
        stageId,
        producerId,
      },
    ];
  });
