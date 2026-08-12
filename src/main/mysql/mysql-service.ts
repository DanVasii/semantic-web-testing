import type {
  MySqlColumnSchema,
  MySqlConnectionInput,
  MySqlConnectionTestResult,
  MySqlSchemaResult,
  MySqlSettingsSummary,
  MySqlTableSchema,
  TableIdentityConfig,
} from "../../shared/mysql.js";
import {
  hasMySqlConnectionErrors,
  validateMySqlConnectionInput,
} from "../../shared/mysql.js";
import type { SecretProtector } from "../project-basic-auth-service.js";
import {
  ProjectMySqlSettingsRepository,
  ProjectRepository,
  type ProjectMySqlSettingsRecord,
} from "../persistence/repositories.js";
import type { MySqlGateway, ResolvedMySqlConnection } from "./mysql-gateway.js";

export interface MySqlServiceOptions {
  now: () => Date;
  secrets: SecretProtector;
}

const SCHEMA_QUERY = `
  SELECT
    c.TABLE_NAME,
    c.COLUMN_NAME,
    c.DATA_TYPE,
    c.COLUMN_TYPE,
    c.IS_NULLABLE,
    c.COLUMN_DEFAULT,
    c.EXTRA,
    c.ORDINAL_POSITION,
    CASE WHEN EXISTS (
      SELECT 1
      FROM information_schema.KEY_COLUMN_USAGE k
      WHERE k.TABLE_SCHEMA = c.TABLE_SCHEMA
        AND k.TABLE_NAME = c.TABLE_NAME
        AND k.COLUMN_NAME = c.COLUMN_NAME
        AND k.CONSTRAINT_NAME = 'PRIMARY'
    ) THEN 1 ELSE 0 END AS IS_PRIMARY
  FROM information_schema.COLUMNS c
  INNER JOIN information_schema.TABLES t
    ON t.TABLE_SCHEMA = c.TABLE_SCHEMA
    AND t.TABLE_NAME = c.TABLE_NAME
    AND t.TABLE_TYPE = 'BASE TABLE'
  WHERE c.TABLE_SCHEMA = ?
  ORDER BY c.TABLE_NAME, c.ORDINAL_POSITION
`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requiredText = (row: Record<string, unknown>, key: string): string => {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error("Schema MySQL a returnat metadate invalide.");
  }
  return value;
};

const requiredNumber = (row: Record<string, unknown>, key: string): number => {
  const value = row[key];
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error("Schema MySQL a returnat metadate invalide.");
  }
  return parsed;
};

const optionalScalarText = (value: unknown): string | undefined => {
  if (value === null || value === undefined) return undefined;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "boolean"
  ) {
    return String(value);
  }
  if (Buffer.isBuffer(value)) return value.toString("utf8");
  throw new Error("Schema MySQL a returnat metadate invalide.");
};

const normalizeConnectionInput = (
  input: unknown,
  passwordRequired: boolean,
): MySqlConnectionInput => {
  const errors = validateMySqlConnectionInput(input, passwordRequired);
  if (hasMySqlConnectionErrors(errors) || !isRecord(input)) {
    const first = Object.values(errors).find(
      (message): message is string => message !== undefined,
    );
    throw new Error(first ?? "Configurația MySQL nu este validă.");
  }
  return {
    host: (input.host as string).trim(),
    port: input.port as number,
    database: (input.database as string).trim(),
    username: (input.username as string).trim(),
    ...(input.password === undefined
      ? {}
      : { password: input.password as string }),
    ssl: input.ssl as boolean,
  };
};

const normalizeIdentityConfigs = (input: unknown): TableIdentityConfig[] => {
  if (!Array.isArray(input)) {
    throw new Error("Configurația identity columns trebuie să fie o listă.");
  }
  if (input.length > 200) {
    throw new Error("Sunt permise maximum 200 de configurații de tabele.");
  }
  const seenTables = new Set<string>();
  return input.map((item): TableIdentityConfig => {
    if (!isRecord(item)) {
      throw new Error("Configurația unui tabel trebuie să fie un obiect.");
    }
    const tableName =
      typeof item.tableName === "string" ? item.tableName.trim() : "";
    if (
      tableName.length === 0 ||
      tableName.length > 64 ||
      seenTables.has(tableName)
    ) {
      throw new Error("Numele tabelului pentru identity config nu este valid.");
    }
    seenTables.add(tableName);
    if (
      !Array.isArray(item.columns) ||
      item.columns.length === 0 ||
      item.columns.length > 50
    ) {
      throw new Error(
        `Tabela ${tableName} trebuie să aibă între 1 și 50 de identity columns.`,
      );
    }
    const columns = item.columns.map((column) =>
      typeof column === "string" ? column.trim() : "",
    );
    if (
      columns.some((column) => column.length === 0 || column.length > 64) ||
      new Set(columns).size !== columns.length
    ) {
      throw new Error(
        `Identity columns pentru tabela ${tableName} nu sunt valide.`,
      );
    }
    return { tableName, columns };
  });
};

const mysqlErrorCode = (error: unknown): string | undefined => {
  if (!isRecord(error) || typeof error.code !== "string") return undefined;
  return /^[A-Z0-9_]{2,80}$/.test(error.code) ? error.code : undefined;
};

export class MySqlService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly settingsRepository: ProjectMySqlSettingsRepository,
    private readonly gateway: MySqlGateway,
    private readonly options: MySqlServiceOptions,
  ) {}

  public get(projectId: string): MySqlSettingsSummary {
    this.requireProject(projectId);
    const record = this.settingsRepository.findByProjectId(projectId);
    if (record === undefined) {
      return {
        projectId,
        host: "localhost",
        port: 3306,
        database: "",
        username: "",
        ssl: false,
        passwordConfigured: false,
        identities: [],
      };
    }
    return this.toSummary(record);
  }

  public save(projectId: string, input: unknown): MySqlSettingsSummary {
    this.requireProject(projectId);
    const existing = this.settingsRepository.findByProjectId(projectId);
    const value = normalizeConnectionInput(input, existing === undefined);
    const updatedAt = this.options.now().toISOString();
    const saved = this.settingsRepository.upsert({
      projectId,
      host: value.host,
      port: value.port,
      database: value.database,
      username: value.username,
      encryptedPassword:
        value.password === undefined
          ? (existing?.encryptedPassword ?? "")
          : this.options.secrets.encrypt(value.password),
      ssl: value.ssl,
      identities:
        existing?.database === value.database ? existing.identities : [],
      updatedAt,
    });
    return this.toSummary(saved);
  }

  public async testConnection(
    projectId: string,
    input: unknown,
  ): Promise<MySqlConnectionTestResult> {
    const config = this.resolveConnection(projectId, input);
    const startedAt = Date.now();
    await this.withSession(config, async (session) => {
      await session.query("SELECT 1 AS connection_test");
    });
    return {
      success: true,
      message: "Conexiunea MySQL este disponibilă.",
      latencyMs: Math.max(0, Date.now() - startedAt),
    };
  }

  public async loadSchema(
    projectId: string,
    input?: unknown,
  ): Promise<MySqlSchemaResult> {
    const config =
      input === undefined
        ? this.resolveSavedConnection(projectId)
        : this.resolveConnection(projectId, input);
    const saved = this.settingsRepository.findByProjectId(projectId);
    const identities =
      saved?.database === config.database ? saved.identities : [];
    const rows = await this.withSession(config, (session) =>
      session.query(SCHEMA_QUERY, [config.database]),
    );
    return {
      database: config.database,
      loadedAt: this.options.now().toISOString(),
      tables: this.mapTables(rows, identities),
    };
  }

  public async saveIdentityConfig(
    projectId: string,
    input: unknown,
  ): Promise<MySqlSchemaResult> {
    const configs = normalizeIdentityConfigs(input);
    const saved = this.requireSavedSettings(projectId);
    const config = this.resolveSavedConnection(projectId);
    const rows = await this.withSession(config, (session) =>
      session.query(SCHEMA_QUERY, [config.database]),
    );
    const rawTables = this.mapTables(rows, []);
    const byName = new Map(rawTables.map((table) => [table.name, table]));
    for (const identity of configs) {
      const table = byName.get(identity.tableName);
      if (table === undefined) {
        throw new Error(`Tabela ${identity.tableName} nu există în schemă.`);
      }
      const columns = new Set(table.columns.map((column) => column.name));
      const missing = identity.columns.find((column) => !columns.has(column));
      if (missing !== undefined) {
        throw new Error(
          `Coloana ${missing} nu există în tabela ${identity.tableName}.`,
        );
      }
    }
    this.settingsRepository.upsert({
      ...saved,
      identities: configs,
      updatedAt: this.options.now().toISOString(),
    });
    return {
      database: config.database,
      loadedAt: this.options.now().toISOString(),
      tables: this.mapTables(rows, configs),
    };
  }

  public withSavedSession<T>(
    projectId: string,
    operation: (
      session: Awaited<ReturnType<MySqlGateway["connect"]>>,
    ) => Promise<T>,
  ): Promise<T> {
    return this.withSession(this.resolveSavedConnection(projectId), operation);
  }

  private mapTables(
    rows: Record<string, unknown>[],
    identities: TableIdentityConfig[],
  ): MySqlTableSchema[] {
    const manualByTable = new Map(
      identities.map((identity) => [identity.tableName, identity.columns]),
    );
    const tables = new Map<string, MySqlColumnSchema[]>();
    for (const row of rows) {
      const tableName = requiredText(row, "TABLE_NAME");
      const defaultValue = optionalScalarText(row.COLUMN_DEFAULT);
      const column: MySqlColumnSchema = {
        name: requiredText(row, "COLUMN_NAME"),
        dataType: requiredText(row, "DATA_TYPE"),
        columnType: requiredText(row, "COLUMN_TYPE"),
        nullable: requiredText(row, "IS_NULLABLE") === "YES",
        ...(defaultValue === undefined ? {} : { defaultValue }),
        extra: requiredText(row, "EXTRA"),
        ordinalPosition: requiredNumber(row, "ORDINAL_POSITION"),
        primaryKey: requiredNumber(row, "IS_PRIMARY") === 1,
      };
      const columns = tables.get(tableName) ?? [];
      columns.push(column);
      tables.set(tableName, columns);
    }
    return [...tables.entries()].map(([name, columns]) => {
      const primaryKey = columns
        .filter((column) => column.primaryKey)
        .map((column) => column.name);
      const manual = manualByTable.get(name);
      return {
        name,
        columns,
        primaryKey,
        identityColumns: manual ?? primaryKey,
        identitySource:
          manual !== undefined
            ? "manual"
            : primaryKey.length > 0
              ? "primary_key"
              : "none",
      };
    });
  }

  private resolveConnection(
    projectId: string,
    input: unknown,
  ): ResolvedMySqlConnection {
    this.requireProject(projectId);
    const existing = this.settingsRepository.findByProjectId(projectId);
    const value = normalizeConnectionInput(input, existing === undefined);
    return {
      host: value.host,
      port: value.port,
      database: value.database,
      username: value.username,
      password:
        value.password ??
        (existing === undefined
          ? ""
          : this.options.secrets.decrypt(existing.encryptedPassword)),
      ssl: value.ssl,
    };
  }

  private resolveSavedConnection(projectId: string): ResolvedMySqlConnection {
    const saved = this.requireSavedSettings(projectId);
    return {
      host: saved.host,
      port: saved.port,
      database: saved.database,
      username: saved.username,
      password: this.options.secrets.decrypt(saved.encryptedPassword),
      ssl: saved.ssl,
    };
  }

  private async withSession<T>(
    config: ResolvedMySqlConnection,
    operation: (
      session: Awaited<ReturnType<MySqlGateway["connect"]>>,
    ) => Promise<T>,
  ): Promise<T> {
    let session: Awaited<ReturnType<MySqlGateway["connect"]>> | undefined;
    try {
      session = await this.gateway.connect(config);
      return await operation(session);
    } catch (error) {
      const code = mysqlErrorCode(error);
      // Driver errors may contain credentials; never attach the raw cause.
      // eslint-disable-next-line preserve-caught-error
      throw new Error(
        code === undefined
          ? "Conexiunea MySQL a eșuat."
          : `Conexiunea MySQL a eșuat (${code}).`,
      );
    } finally {
      await session?.close().catch(() => undefined);
    }
  }

  private toSummary(record: ProjectMySqlSettingsRecord): MySqlSettingsSummary {
    return {
      projectId: record.projectId,
      host: record.host,
      port: record.port,
      database: record.database,
      username: record.username,
      ssl: record.ssl,
      passwordConfigured: true,
      identities: structuredClone(record.identities),
      updatedAt: record.updatedAt,
    };
  }

  private requireSavedSettings(projectId: string): ProjectMySqlSettingsRecord {
    this.requireProject(projectId);
    const record = this.settingsRepository.findByProjectId(projectId);
    if (record === undefined) {
      throw new Error("Configurația MySQL trebuie salvată mai întâi.");
    }
    return record;
  }

  private requireProject(projectId: string): void {
    if (this.projectRepository.findById(projectId) === undefined) {
      throw new Error("Proiectul nu există.");
    }
  }
}
