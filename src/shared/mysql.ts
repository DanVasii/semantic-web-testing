export interface MySqlConnectionInput {
  host: string;
  port: number;
  database: string;
  username: string;
  password?: string;
  ssl: boolean;
}

export interface MySqlConnectionErrors {
  host?: string;
  port?: string;
  database?: string;
  username?: string;
  password?: string;
  ssl?: string;
}

export interface TableIdentityConfig {
  tableName: string;
  columns: string[];
}

export interface MySqlSettingsSummary {
  projectId: string;
  host: string;
  port: number;
  database: string;
  username: string;
  ssl: boolean;
  passwordConfigured: boolean;
  identities: TableIdentityConfig[];
  updatedAt?: string;
}

export interface MySqlConnectionTestResult {
  success: true;
  message: string;
  latencyMs: number;
}

export interface MySqlColumnSchema {
  name: string;
  dataType: string;
  columnType: string;
  nullable: boolean;
  defaultValue?: string;
  extra: string;
  ordinalPosition: number;
  primaryKey: boolean;
}

export interface MySqlTableSchema {
  name: string;
  columns: MySqlColumnSchema[];
  primaryKey: string[];
  identityColumns: string[];
  identitySource: "primary_key" | "manual" | "none";
}

export interface MySqlSchemaResult {
  database: string;
  loadedAt: string;
  tables: MySqlTableSchema[];
}

export type MySqlNormalizedValue = string | number | boolean | null;
export type MySqlSnapshotRow = Record<string, MySqlNormalizedValue>;

export interface MySqlTableSnapshot {
  tableName: string;
  columns: string[];
  identityColumns: string[];
  rows: MySqlSnapshotRow[];
}

export interface MySqlRunSnapshot {
  id: string;
  runId: string;
  kind: "baseline" | "current";
  checkStepId?: string;
  capturedAt: string;
  tables: MySqlTableSnapshot[];
}

export interface MySqlRowChange {
  identity: MySqlSnapshotRow;
  row: MySqlSnapshotRow;
}

export interface MySqlUpdatedRow {
  identity: MySqlSnapshotRow;
  before: MySqlSnapshotRow;
  after: MySqlSnapshotRow;
  changedColumns: string[];
}

export interface MySqlDuplicateIdentity {
  identity: MySqlSnapshotRow;
  beforeRows: MySqlSnapshotRow[];
  afterRows: MySqlSnapshotRow[];
}

export interface MySqlTableDiff {
  tableName: string;
  columns: string[];
  identityColumns: string[];
  inserted: MySqlRowChange[];
  deleted: MySqlRowChange[];
  updated: MySqlUpdatedRow[];
  duplicateIdentities: MySqlDuplicateIdentity[];
}

export interface MySqlRunDiff {
  id: string;
  runId: string;
  checkStepId: string;
  baselineSnapshotId: string;
  currentSnapshotId: string;
  createdAt: string;
  tables: MySqlTableDiff[];
}

export interface MySqlCleanupRowSelection {
  tableName: string;
  identity: MySqlSnapshotRow;
}

export interface MySqlCleanupCondition {
  column: string;
  operator: "=" | "<=>";
  value: MySqlNormalizedValue;
}

export interface MySqlCleanupPreviewRow {
  tableName: string;
  identity: MySqlSnapshotRow;
  conditions: MySqlCleanupCondition[];
  sqlPreview: string;
}

export interface MySqlCleanupPreview {
  id: string;
  runId: string;
  diffId: string;
  createdAt: string;
  rows: MySqlCleanupPreviewRow[];
}

export interface MySqlCleanupLog {
  id: string;
  runId: string;
  diffId: string;
  previewId: string;
  status: "pending" | "completed" | "failed";
  startedAt: string;
  endedAt?: string;
  rows: MySqlCleanupPreviewRow[];
  affectedRows: number;
  error?: string;
}

export interface MySqlRunDetails {
  baselineSnapshotId?: string;
  diffs: MySqlRunDiff[];
  cleanupPreview?: MySqlCleanupPreview;
  cleanupLogs: MySqlCleanupLog[];
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export const validateMySqlConnectionInput = (
  input: unknown,
  passwordRequired: boolean,
): MySqlConnectionErrors => {
  const value = record(input);
  if (value === undefined) {
    return {
      host: "Configurația MySQL trebuie să fie un obiect.",
      port: "Portul MySQL este obligatoriu.",
      database: "Baza de date este obligatorie.",
      username: "Username-ul MySQL este obligatoriu.",
      ...(passwordRequired
        ? { password: "Parola MySQL este obligatorie." }
        : {}),
      ssl: "Opțiunea SSL trebuie să fie booleană.",
    };
  }

  const errors: MySqlConnectionErrors = {};
  const host = typeof value.host === "string" ? value.host.trim() : "";
  if (
    host.length === 0 ||
    host.length > 253 ||
    !/^[A-Za-z0-9._:-]+$/.test(host) ||
    host.includes("://")
  ) {
    errors.host =
      "Host-ul trebuie să fie un hostname sau IP valid, fără protocol ori cale.";
  }

  if (
    typeof value.port !== "number" ||
    !Number.isInteger(value.port) ||
    value.port < 1 ||
    value.port > 65_535
  ) {
    errors.port = "Portul trebuie să fie un număr întreg între 1 și 65535.";
  }

  const database =
    typeof value.database === "string" ? value.database.trim() : "";
  if (
    database.length === 0 ||
    database.length > 64 ||
    database.includes("\0") ||
    /[/\\]/.test(database)
  ) {
    errors.database =
      "Numele bazei de date trebuie să aibă între 1 și 64 de caractere.";
  }

  const username =
    typeof value.username === "string" ? value.username.trim() : "";
  if (username.length === 0 || username.length > 128) {
    errors.username =
      "Username-ul MySQL trebuie să aibă între 1 și 128 de caractere.";
  }

  const password = value.password;
  if (
    password !== undefined &&
    (typeof password !== "string" || password.length > 1024)
  ) {
    errors.password = "Parola poate avea maximum 1024 de caractere.";
  } else if (passwordRequired && password === undefined) {
    errors.password = "Parola MySQL este obligatorie la prima configurare.";
  }

  if (typeof value.ssl !== "boolean") {
    errors.ssl = "Opțiunea SSL trebuie să fie booleană.";
  }
  return errors;
};

export const hasMySqlConnectionErrors = (
  errors: MySqlConnectionErrors,
): boolean => Object.keys(errors).length > 0;
