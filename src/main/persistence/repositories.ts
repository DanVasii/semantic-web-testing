import type { DatabaseSync } from "node:sqlite";

import type {
  BrowserConfig,
  BrowserType,
  JsonValue,
  Page,
  PageVersion,
  Project,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
  TestStatus,
  TestVersion,
} from "../../shared/persistence.js";
import type { ProjectStatistics } from "../../shared/projects.js";
import type {
  MySqlCleanupLog,
  MySqlRunDiff,
  MySqlRunSnapshot,
  TableIdentityConfig,
} from "../../shared/mysql.js";
import {
  defaultTestPostRunChecks,
  normalizeTestPostRunChecks,
} from "../../shared/post-run-checks.js";

type DatabaseRow = Record<string, unknown>;

const asRows = (rows: unknown[]): DatabaseRow[] => rows as DatabaseRow[];
const asRow = (row: unknown): DatabaseRow | undefined =>
  row as DatabaseRow | undefined;
const text = (row: DatabaseRow, key: string): string => row[key] as string;
const number = (row: DatabaseRow, key: string): number => row[key] as number;
const optionalText = (row: DatabaseRow, key: string): string | undefined => {
  const value = row[key];
  return value === null || value === undefined ? undefined : (value as string);
};
const optionalNumber = (row: DatabaseRow, key: string): number | undefined => {
  const value = row[key];
  return value === null || value === undefined ? undefined : (value as number);
};
const parseJson = <T>(value: string): T => JSON.parse(value) as T;
const json = (value: unknown): string => {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) {
    throw new Error("Valoarea nu poate fi serializată ca JSON.");
  }
  return serialized;
};

const mapProject = (row: DatabaseRow): Project => {
  const mysqlConfig = optionalText(row, "mysql_config_json");

  return {
    id: text(row, "id"),
    name: text(row, "name"),
    baseUrl: text(row, "base_url"),
    normalizedBaseUrl: text(row, "normalized_base_url"),
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    browserConfig: parseJson<BrowserConfig>(text(row, "browser_config_json")),
    aiConfig: parseJson<JsonValue>(text(row, "ai_config_json")),
    ...(mysqlConfig === undefined
      ? {}
      : { mysqlConfig: parseJson<JsonValue>(mysqlConfig) }),
    shortcutConfig: parseJson<JsonValue>(text(row, "shortcut_config_json")),
  };
};

const mapPage = (row: DatabaseRow): Page => ({
  id: text(row, "id"),
  projectId: text(row, "project_id"),
  name: text(row, "name"),
  url: text(row, "url"),
  normalizedUrl: text(row, "normalized_url"),
  createdAt: text(row, "created_at"),
  updatedAt: text(row, "updated_at"),
});

const mapPageVersion = (row: DatabaseRow): PageVersion => ({
  id: text(row, "id"),
  pageId: text(row, "page_id"),
  versionNumber: number(row, "version_number"),
  createdAt: text(row, "created_at"),
  normalizedUrl: text(row, "normalized_url"),
  domFilePath: text(row, "dom_file_path"),
  cssFilePath: text(row, "css_file_path"),
  accessibilityFilePath: text(row, "accessibility_file_path"),
  analysisFilePath: text(row, "analysis_file_path"),
  semanticHash: text(row, "semantic_hash"),
  ...(optionalText(row, "change_json") === undefined
    ? {}
    : {
        change: parseJson<NonNullable<PageVersion["change"]>>(
          optionalText(row, "change_json")!,
        ),
      }),
});

const mapTest = (row: DatabaseRow): TestDefinition => {
  const description = optionalText(row, "description");
  const invalidation = optionalText(row, "invalidation_json");
  const aiGeneration = optionalText(row, "ai_generation_json");
  const stages = optionalText(row, "stages_json");

  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    name: text(row, "name"),
    ...(description === undefined ? {} : { description }),
    status: text(row, "status") as TestStatus,
    version: number(row, "version"),
    testMode: text(row, "test_mode") as TestDefinition["testMode"],
    wipeBeforeRun: number(row, "wipe_before_run") === 1,
    startMode: text(row, "start_mode") as TestDefinition["startMode"],
    startUrl: text(row, "start_url"),
    normalizedStartUrl: text(row, "normalized_start_url"),
    workflowState: text(
      row,
      "workflow_state",
    ) as TestDefinition["workflowState"],
    createdAt: text(row, "created_at"),
    updatedAt: text(row, "updated_at"),
    flowItems: parseJson<TestDefinition["flowItems"]>(
      text(row, "flow_items_json"),
    ),
    ...(stages === undefined
      ? {}
      : { stages: parseJson<NonNullable<TestDefinition["stages"]>>(stages) }),
    postRunChecks: normalizeTestPostRunChecks(
      parseJson<NonNullable<TestDefinition["postRunChecks"]>>(
        text(row, "post_run_checks_json"),
      ),
    ),
    ...(aiGeneration === undefined
      ? {}
      : {
          aiGeneration:
            parseJson<NonNullable<TestDefinition["aiGeneration"]>>(
              aiGeneration,
            ),
        }),
    ...(invalidation === undefined
      ? {}
      : {
          invalidation:
            parseJson<NonNullable<TestDefinition["invalidation"]>>(
              invalidation,
            ),
        }),
  };
};

const mapTestVersion = (row: DatabaseRow): TestVersion => ({
  id: text(row, "id"),
  testId: text(row, "test_id"),
  versionNumber: number(row, "version_number"),
  source: text(row, "source") as TestVersion["source"],
  createdAt: text(row, "created_at"),
  snapshotFilePath: text(row, "snapshot_file_path"),
});

const mapDataset = (row: DatabaseRow): TestDataset => ({
  id: text(row, "id"),
  testId: text(row, "test_id"),
  name: text(row, "name"),
  values: parseJson<TestDataset["values"]>(text(row, "values_json")),
  createdAt: text(row, "created_at"),
  updatedAt: text(row, "updated_at"),
});

const mapRun = (row: DatabaseRow): TestRun => {
  const datasetId = optionalText(row, "dataset_id");
  const endedAt = optionalText(row, "ended_at");
  const warnings = parseJson<JsonValue[]>(
    optionalText(row, "warnings_json") ?? "[]",
  );
  const datasetSnapshot = optionalText(row, "dataset_snapshot_json");
  const postRunResult = optionalText(row, "post_run_result_json");
  const error = optionalText(row, "error_json");

  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    testId: text(row, "test_id"),
    testVersion: number(row, "test_version"),
    ...(datasetId === undefined ? {} : { datasetId }),
    startedAt: text(row, "started_at"),
    ...(endedAt === undefined ? {} : { endedAt }),
    status: text(row, "status") as TestRun["status"],
    browserType: text(row, "browser_type") as BrowserType,
    pageVersionIds: parseJson<string[]>(text(row, "page_version_ids_json")),
    ...(warnings.length === 0 ? {} : { warnings }),
    ...(datasetSnapshot === undefined
      ? {}
      : { datasetSnapshot: parseJson<JsonValue>(datasetSnapshot) }),
    ...(postRunResult === undefined
      ? {}
      : { postRunResult: parseJson<JsonValue>(postRunResult) }),
    ...(error === undefined ? {} : { error: parseJson<JsonValue>(error) }),
  };
};

const mapStepResult = (row: DatabaseRow): StepRunResult => {
  const startedAt = optionalText(row, "started_at");
  const endedAt = optionalText(row, "ended_at");
  const locatorUsed = optionalText(row, "locator_used_json");
  const fallbackIndex = optionalNumber(row, "fallback_index");
  const error = optionalText(row, "error_json");
  const stageId = optionalText(row, "stage_id");

  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    stepId: text(row, "step_id"),
    ...(stageId === undefined ? {} : { stageId }),
    status: text(row, "status") as StepRunResult["status"],
    ...(startedAt === undefined ? {} : { startedAt }),
    ...(endedAt === undefined ? {} : { endedAt }),
    ...(locatorUsed === undefined
      ? {}
      : { locatorUsed: parseJson<JsonValue>(locatorUsed) }),
    ...(fallbackIndex === undefined ? {} : { fallbackIndex }),
    ...(error === undefined ? {} : { error: parseJson<JsonValue>(error) }),
    logs: parseJson<JsonValue[]>(text(row, "logs_json")),
  };
};

const mapMySqlRunSnapshot = (row: DatabaseRow): MySqlRunSnapshot => {
  const checkStepId = optionalText(row, "check_step_id");
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    kind: text(row, "kind") as MySqlRunSnapshot["kind"],
    ...(checkStepId === undefined ? {} : { checkStepId }),
    capturedAt: text(row, "captured_at"),
    tables: parseJson<MySqlRunSnapshot["tables"]>(text(row, "tables_json")),
  };
};

const mapMySqlRunDiff = (row: DatabaseRow): MySqlRunDiff => ({
  id: text(row, "id"),
  runId: text(row, "run_id"),
  checkStepId: text(row, "check_step_id"),
  baselineSnapshotId: text(row, "baseline_snapshot_id"),
  currentSnapshotId: text(row, "current_snapshot_id"),
  createdAt: text(row, "created_at"),
  tables: parseJson<MySqlRunDiff["tables"]>(text(row, "tables_json")),
});

const mapMySqlCleanupLog = (row: DatabaseRow): MySqlCleanupLog => {
  const endedAt = optionalText(row, "ended_at");
  const error = optionalText(row, "error");
  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    diffId: text(row, "diff_id"),
    previewId: text(row, "preview_id"),
    status: text(row, "status") as MySqlCleanupLog["status"],
    startedAt: text(row, "started_at"),
    ...(endedAt === undefined ? {} : { endedAt }),
    rows: parseJson<MySqlCleanupLog["rows"]>(text(row, "rows_json")),
    affectedRows: number(row, "affected_rows"),
    ...(error === undefined ? {} : { error }),
  };
};

export interface ProjectBasicAuthRecord {
  projectId: string;
  origin: string;
  username: string;
  encryptedPassword: string;
  updatedAt: string;
}

export interface ApplicationAiSettingsRecord {
  provider: "none" | "ollama" | "lm_studio" | "gemini" | "openai";
  ollamaBaseUrl: string;
  ollamaModel: string;
  lmStudioBaseUrl: string;
  lmStudioModel: string;
  geminiModel: string;
  encryptedGeminiApiKey?: string;
  openaiModel: string;
  encryptedOpenaiApiKey?: string;
  updatedAt: string;
}

export interface AiModelPricingRecord {
  provider: "gemini" | "openai";
  model: string;
  source: "litellm" | "manual";
  inputPerMillionUsd?: number;
  outputPerMillionUsd?: number;
  cachedInputPerMillionUsd?: number;
  matchedModelId?: string;
  fetchedAt: string;
  expiresAt: string;
}

export interface ProjectMySqlSettingsRecord {
  projectId: string;
  host: string;
  port: number;
  database: string;
  username: string;
  encryptedPassword: string;
  ssl: boolean;
  identities: TableIdentityConfig[];
  updatedAt: string;
}

export class ProjectRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(project: Project): Project {
    this.database
      .prepare(
        `INSERT INTO projects (
          id, name, base_url, normalized_base_url, created_at, updated_at,
          browser_config_json, ai_config_json, mysql_config_json,
          shortcut_config_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.name,
        project.baseUrl,
        project.normalizedBaseUrl,
        project.createdAt,
        project.updatedAt,
        json(project.browserConfig),
        json(project.aiConfig),
        project.mysqlConfig === undefined ? null : json(project.mysqlConfig),
        json(project.shortcutConfig),
      );
    return project;
  }

  public findById(id: string): Project | undefined {
    const row = asRow(
      this.database.prepare("SELECT * FROM projects WHERE id = ?").get(id),
    );
    return row === undefined ? undefined : mapProject(row);
  }

  public list(): Project[] {
    return asRows(
      this.database
        .prepare("SELECT * FROM projects ORDER BY created_at, id")
        .all(),
    ).map(mapProject);
  }

  public update(project: Project): Project {
    this.database
      .prepare(
        `UPDATE projects SET
          name = ?, base_url = ?, normalized_base_url = ?, updated_at = ?,
          browser_config_json = ?, ai_config_json = ?, mysql_config_json = ?,
          shortcut_config_json = ?
        WHERE id = ?`,
      )
      .run(
        project.name,
        project.baseUrl,
        project.normalizedBaseUrl,
        project.updatedAt,
        json(project.browserConfig),
        json(project.aiConfig),
        project.mysqlConfig === undefined ? null : json(project.mysqlConfig),
        json(project.shortcutConfig),
        project.id,
      );
    return project;
  }

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM projects WHERE id = ?").run(id)
        .changes > 0
    );
  }

  public getStatistics(projectId: string): ProjectStatistics {
    const row = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM pages WHERE project_id = ?) AS page_count,
          (SELECT COUNT(*) FROM tests WHERE project_id = ?) AS test_count,
          (SELECT COUNT(*) FROM runs WHERE project_id = ?) AS run_count,
          (SELECT MAX(started_at) FROM runs WHERE project_id = ?) AS last_run_at`,
      )
      .get(projectId, projectId, projectId, projectId) as DatabaseRow;
    const lastRunAt = optionalText(row, "last_run_at");

    return {
      pageCount: number(row, "page_count"),
      testCount: number(row, "test_count"),
      runCount: number(row, "run_count"),
      ...(lastRunAt === undefined ? {} : { lastRunAt }),
    };
  }
}

export class ProjectBasicAuthRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByProjectId(
    projectId: string,
  ): ProjectBasicAuthRecord | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM project_basic_auth WHERE project_id = ?")
        .get(projectId),
    );
    if (row === undefined) return undefined;
    return {
      projectId: text(row, "project_id"),
      origin: text(row, "origin"),
      username: text(row, "username"),
      encryptedPassword: text(row, "encrypted_password"),
      updatedAt: text(row, "updated_at"),
    };
  }

  public upsert(record: ProjectBasicAuthRecord): ProjectBasicAuthRecord {
    this.database
      .prepare(
        `INSERT INTO project_basic_auth (
          project_id, origin, username, encrypted_password, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          origin = excluded.origin,
          username = excluded.username,
          encrypted_password = excluded.encrypted_password,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.projectId,
        record.origin,
        record.username,
        record.encryptedPassword,
        record.updatedAt,
      );
    return record;
  }

  public delete(projectId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM project_basic_auth WHERE project_id = ?")
        .run(projectId).changes > 0
    );
  }
}

export class ApplicationAiSettingsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public get(): ApplicationAiSettingsRecord | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM application_ai_settings WHERE singleton_id = 1")
        .get(),
    );
    if (row === undefined) return undefined;
    const encryptedGeminiApiKey = optionalText(row, "encrypted_gemini_api_key");
    const encryptedOpenaiApiKey = optionalText(row, "encrypted_openai_api_key");
    return {
      provider: text(
        row,
        "provider",
      ) as ApplicationAiSettingsRecord["provider"],
      ollamaBaseUrl: text(row, "ollama_base_url"),
      ollamaModel: text(row, "ollama_model"),
      lmStudioBaseUrl: text(row, "lm_studio_base_url"),
      lmStudioModel: text(row, "lm_studio_model"),
      geminiModel: text(row, "gemini_model"),
      ...(encryptedGeminiApiKey === undefined ? {} : { encryptedGeminiApiKey }),
      openaiModel: text(row, "openai_model"),
      ...(encryptedOpenaiApiKey === undefined ? {} : { encryptedOpenaiApiKey }),
      updatedAt: text(row, "updated_at"),
    };
  }

  public save(
    settings: ApplicationAiSettingsRecord,
  ): ApplicationAiSettingsRecord {
    this.database
      .prepare(
        `INSERT INTO application_ai_settings (
          singleton_id, provider, ollama_base_url, ollama_model,
          lm_studio_base_url, lm_studio_model, gemini_model,
          encrypted_gemini_api_key, openai_model,
          encrypted_openai_api_key, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(singleton_id) DO UPDATE SET
          provider = excluded.provider,
          ollama_base_url = excluded.ollama_base_url,
          ollama_model = excluded.ollama_model,
          lm_studio_base_url = excluded.lm_studio_base_url,
          lm_studio_model = excluded.lm_studio_model,
          gemini_model = excluded.gemini_model,
          encrypted_gemini_api_key = excluded.encrypted_gemini_api_key,
          openai_model = excluded.openai_model,
          encrypted_openai_api_key = excluded.encrypted_openai_api_key,
          updated_at = excluded.updated_at`,
      )
      .run(
        settings.provider,
        settings.ollamaBaseUrl,
        settings.ollamaModel,
        settings.lmStudioBaseUrl,
        settings.lmStudioModel,
        settings.geminiModel,
        settings.encryptedGeminiApiKey ?? null,
        settings.openaiModel,
        settings.encryptedOpenaiApiKey ?? null,
        settings.updatedAt,
      );
    return settings;
  }

  public getModelPricing(
    provider: AiModelPricingRecord["provider"],
    model: string,
  ): AiModelPricingRecord | undefined {
    const row = asRow(
      this.database
        .prepare(
          `SELECT * FROM ai_model_pricing_cache
           WHERE provider = ? AND model = ?`,
        )
        .get(provider, model),
    );
    if (row === undefined) return undefined;
    const inputPerMillionUsd = optionalNumber(row, "input_per_million_usd");
    const outputPerMillionUsd = optionalNumber(row, "output_per_million_usd");
    const cachedInputPerMillionUsd = optionalNumber(
      row,
      "cached_input_per_million_usd",
    );
    const matchedModelId = optionalText(row, "matched_model_id");
    return {
      provider: text(row, "provider") as AiModelPricingRecord["provider"],
      model: text(row, "model"),
      source: text(row, "source") as AiModelPricingRecord["source"],
      ...(inputPerMillionUsd === undefined ? {} : { inputPerMillionUsd }),
      ...(outputPerMillionUsd === undefined ? {} : { outputPerMillionUsd }),
      ...(cachedInputPerMillionUsd === undefined
        ? {}
        : { cachedInputPerMillionUsd }),
      ...(matchedModelId === undefined ? {} : { matchedModelId }),
      fetchedAt: text(row, "fetched_at"),
      expiresAt: text(row, "expires_at"),
    };
  }

  public saveModelPricing(record: AiModelPricingRecord): AiModelPricingRecord {
    this.database
      .prepare(
        `INSERT INTO ai_model_pricing_cache (
          provider, model, source, input_per_million_usd,
          output_per_million_usd, cached_input_per_million_usd,
          matched_model_id, fetched_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(provider, model) DO UPDATE SET
          source = excluded.source,
          input_per_million_usd = excluded.input_per_million_usd,
          output_per_million_usd = excluded.output_per_million_usd,
          cached_input_per_million_usd = excluded.cached_input_per_million_usd,
          matched_model_id = excluded.matched_model_id,
          fetched_at = excluded.fetched_at,
          expires_at = excluded.expires_at`,
      )
      .run(
        record.provider,
        record.model,
        record.source,
        record.inputPerMillionUsd ?? null,
        record.outputPerMillionUsd ?? null,
        record.cachedInputPerMillionUsd ?? null,
        record.matchedModelId ?? null,
        record.fetchedAt,
        record.expiresAt,
      );
    return record;
  }
}

export interface ImapAccountRecord {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  encryptedPassword: string;
  mailbox: string;
}

const mapImapAccount = (row: DatabaseRow): ImapAccountRecord => ({
  id: text(row, "id"),
  name: text(row, "name"),
  host: text(row, "host"),
  port: number(row, "port"),
  secure: number(row, "secure") === 1,
  username: text(row, "username"),
  encryptedPassword: text(row, "password"),
  mailbox: text(row, "mailbox"),
});

export class ImapAccountRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public list(): ImapAccountRecord[] {
    return asRows(
      this.database
        .prepare("SELECT * FROM global_imap_accounts ORDER BY name, id")
        .all(),
    ).map(mapImapAccount);
  }

  public findById(id: string): ImapAccountRecord | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM global_imap_accounts WHERE id = ?")
        .get(id),
    );
    return row === undefined ? undefined : mapImapAccount(row);
  }

  public save(record: ImapAccountRecord): ImapAccountRecord {
    this.database
      .prepare(
        `INSERT INTO global_imap_accounts (
          id, name, host, port, secure, username, password, mailbox
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          host = excluded.host,
          port = excluded.port,
          secure = excluded.secure,
          username = excluded.username,
          password = excluded.password,
          mailbox = excluded.mailbox`,
      )
      .run(
        record.id,
        record.name,
        record.host,
        record.port,
        record.secure ? 1 : 0,
        record.username,
        record.encryptedPassword,
        record.mailbox,
      );
    return record;
  }

  public delete(id: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM global_imap_accounts WHERE id = ?")
        .run(id).changes > 0
    );
  }
}

export class ProjectMySqlSettingsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public findByProjectId(
    projectId: string,
  ): ProjectMySqlSettingsRecord | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM project_mysql_settings WHERE project_id = ?")
        .get(projectId),
    );
    if (row === undefined) return undefined;
    return {
      projectId: text(row, "project_id"),
      host: text(row, "host"),
      port: number(row, "port"),
      database: text(row, "database_name"),
      username: text(row, "username"),
      encryptedPassword: text(row, "encrypted_password"),
      ssl: number(row, "ssl") === 1,
      identities: parseJson<TableIdentityConfig[]>(
        text(row, "identity_config_json"),
      ),
      updatedAt: text(row, "updated_at"),
    };
  }

  public upsert(
    record: ProjectMySqlSettingsRecord,
  ): ProjectMySqlSettingsRecord {
    this.database
      .prepare(
        `INSERT INTO project_mysql_settings (
          project_id, host, port, database_name, username, encrypted_password,
          ssl, identity_config_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          host = excluded.host,
          port = excluded.port,
          database_name = excluded.database_name,
          username = excluded.username,
          encrypted_password = excluded.encrypted_password,
          ssl = excluded.ssl,
          identity_config_json = excluded.identity_config_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        record.projectId,
        record.host,
        record.port,
        record.database,
        record.username,
        record.encryptedPassword,
        record.ssl ? 1 : 0,
        json(record.identities),
        record.updatedAt,
      );
    return record;
  }

  public delete(projectId: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM project_mysql_settings WHERE project_id = ?")
        .run(projectId).changes > 0
    );
  }
}

export class PageRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(page: Page): Page {
    this.database
      .prepare(
        `INSERT INTO pages (
          id, project_id, name, url, normalized_url, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        page.id,
        page.projectId,
        page.name,
        page.url,
        page.normalizedUrl,
        page.createdAt,
        page.updatedAt,
      );
    return page;
  }

  public findById(id: string): Page | undefined {
    const row = asRow(
      this.database.prepare("SELECT * FROM pages WHERE id = ?").get(id),
    );
    return row === undefined ? undefined : mapPage(row);
  }

  public listByProject(projectId: string): Page[] {
    return asRows(
      this.database
        .prepare(
          "SELECT * FROM pages WHERE project_id = ? ORDER BY created_at, id",
        )
        .all(projectId),
    ).map(mapPage);
  }

  public findByProjectAndNormalizedUrl(
    projectId: string,
    normalizedUrl: string,
  ): Page | undefined {
    const row = asRow(
      this.database
        .prepare(
          `SELECT * FROM pages
           WHERE project_id = ? AND normalized_url = ?
           ORDER BY created_at, id LIMIT 1`,
        )
        .get(projectId, normalizedUrl),
    );
    return row === undefined ? undefined : mapPage(row);
  }

  public update(page: Page): Page {
    this.database
      .prepare(
        `UPDATE pages SET
          name = ?, url = ?, normalized_url = ?, updated_at = ?
        WHERE id = ?`,
      )
      .run(page.name, page.url, page.normalizedUrl, page.updatedAt, page.id);
    return page;
  }

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM pages WHERE id = ?").run(id).changes >
      0
    );
  }

  public createVersion(version: PageVersion): PageVersion {
    this.database
      .prepare(
        `INSERT INTO page_versions (
          id, page_id, version_number, created_at, normalized_url,
          dom_file_path, css_file_path, accessibility_file_path,
          analysis_file_path, semantic_hash, change_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.pageId,
        version.versionNumber,
        version.createdAt,
        version.normalizedUrl,
        version.domFilePath,
        version.cssFilePath,
        version.accessibilityFilePath,
        version.analysisFilePath,
        version.semanticHash,
        version.change === undefined ? null : json(version.change),
      );
    return version;
  }

  public listVersions(pageId: string): PageVersion[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM page_versions
           WHERE page_id = ? ORDER BY version_number DESC`,
        )
        .all(pageId),
    ).map(mapPageVersion);
  }

  public findLatestVersion(pageId: string): PageVersion | undefined {
    const row = asRow(
      this.database
        .prepare(
          `SELECT * FROM page_versions
           WHERE page_id = ? ORDER BY version_number DESC LIMIT 1`,
        )
        .get(pageId),
    );
    return row === undefined ? undefined : mapPageVersion(row);
  }
}

export class TestRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(test: TestDefinition): TestDefinition {
    this.database
      .prepare(
        `INSERT INTO tests (
          id, project_id, name, description, status, version, test_mode,
          wipe_before_run, start_mode, start_url, normalized_start_url,
          workflow_state, created_at, updated_at, flow_items_json,
          post_run_checks_json, invalidation_json, ai_generation_json,
          stages_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        test.id,
        test.projectId,
        test.name,
        test.description ?? null,
        test.status,
        test.version,
        test.testMode,
        test.wipeBeforeRun ? 1 : 0,
        test.startMode,
        test.startUrl,
        test.normalizedStartUrl,
        test.workflowState,
        test.createdAt,
        test.updatedAt,
        json(test.flowItems),
        json(test.postRunChecks ?? defaultTestPostRunChecks()),
        test.invalidation === undefined ? null : json(test.invalidation),
        test.aiGeneration === undefined ? null : json(test.aiGeneration),
        test.stages === undefined ? null : json(test.stages),
      );
    return test;
  }

  public findById(id: string): TestDefinition | undefined {
    const row = asRow(
      this.database.prepare("SELECT * FROM tests WHERE id = ?").get(id),
    );
    return row === undefined ? undefined : mapTest(row);
  }

  public listByProject(projectId: string): TestDefinition[] {
    return asRows(
      this.database
        .prepare(
          "SELECT * FROM tests WHERE project_id = ? ORDER BY created_at, id",
        )
        .all(projectId),
    ).map(mapTest);
  }

  public update(test: TestDefinition): TestDefinition {
    this.database
      .prepare(
        `UPDATE tests SET
          name = ?, description = ?, status = ?, version = ?,
          test_mode = ?, wipe_before_run = ?, start_mode = ?, start_url = ?,
          normalized_start_url = ?, workflow_state = ?, updated_at = ?,
          flow_items_json = ?, post_run_checks_json = ?, invalidation_json = ?,
          ai_generation_json = ?, stages_json = ?
        WHERE id = ?`,
      )
      .run(
        test.name,
        test.description ?? null,
        test.status,
        test.version,
        test.testMode,
        test.wipeBeforeRun ? 1 : 0,
        test.startMode,
        test.startUrl,
        test.normalizedStartUrl,
        test.workflowState,
        test.updatedAt,
        json(test.flowItems),
        json(test.postRunChecks ?? defaultTestPostRunChecks()),
        test.invalidation === undefined ? null : json(test.invalidation),
        test.aiGeneration === undefined ? null : json(test.aiGeneration),
        test.stages === undefined ? null : json(test.stages),
        test.id,
      );
    return test;
  }

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM tests WHERE id = ?").run(id).changes >
      0
    );
  }

  public createVersion(version: TestVersion): TestVersion {
    this.database
      .prepare(
        `INSERT INTO test_versions (
          id, test_id, version_number, source, created_at, snapshot_file_path
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        version.id,
        version.testId,
        version.versionNumber,
        version.source,
        version.createdAt,
        version.snapshotFilePath,
      );
    return version;
  }

  public listVersions(testId: string): TestVersion[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM test_versions
           WHERE test_id = ? ORDER BY version_number DESC`,
        )
        .all(testId),
    ).map(mapTestVersion);
  }
}

export class DatasetRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(dataset: TestDataset): TestDataset {
    this.database
      .prepare(
        `INSERT INTO datasets (
          id, test_id, name, values_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        dataset.id,
        dataset.testId,
        dataset.name,
        json(dataset.values),
        dataset.createdAt,
        dataset.updatedAt,
      );
    return dataset;
  }

  public findById(id: string): TestDataset | undefined {
    const row = asRow(
      this.database.prepare("SELECT * FROM datasets WHERE id = ?").get(id),
    );
    return row === undefined ? undefined : mapDataset(row);
  }

  public listByTest(testId: string): TestDataset[] {
    return asRows(
      this.database
        .prepare(
          "SELECT * FROM datasets WHERE test_id = ? ORDER BY created_at, id",
        )
        .all(testId),
    ).map(mapDataset);
  }

  public update(dataset: TestDataset): TestDataset {
    this.database
      .prepare(
        `UPDATE datasets SET name = ?, values_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(dataset.name, json(dataset.values), dataset.updatedAt, dataset.id);
    return dataset;
  }

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM datasets WHERE id = ?").run(id)
        .changes > 0
    );
  }
}

export class RunRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(run: TestRun): TestRun {
    this.database
      .prepare(
        `INSERT INTO runs (
          id, project_id, test_id, test_version, dataset_id, started_at,
          ended_at, status, browser_type, page_version_ids_json, warnings_json,
          dataset_snapshot_json, post_run_result_json, error_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.projectId,
        run.testId,
        run.testVersion,
        run.datasetId ?? null,
        run.startedAt,
        run.endedAt ?? null,
        run.status,
        run.browserType,
        json(run.pageVersionIds),
        json(run.warnings ?? []),
        run.datasetSnapshot === undefined ? null : json(run.datasetSnapshot),
        run.postRunResult === undefined ? null : json(run.postRunResult),
        run.error === undefined ? null : json(run.error),
      );
    return run;
  }

  public findById(id: string): TestRun | undefined {
    const row = asRow(
      this.database.prepare("SELECT * FROM runs WHERE id = ?").get(id),
    );
    return row === undefined ? undefined : mapRun(row);
  }

  public assignDataset(runId: string, datasetId: string): boolean {
    return (
      this.database
        .prepare("UPDATE runs SET dataset_id = ? WHERE id = ?")
        .run(datasetId, runId).changes > 0
    );
  }

  public listByProject(projectId: string): TestRun[] {
    return asRows(
      this.database
        .prepare(
          "SELECT * FROM runs WHERE project_id = ? ORDER BY started_at DESC, id",
        )
        .all(projectId),
    ).map(mapRun);
  }

  public updateStatus(
    id: string,
    status: TestRun["status"],
    endedAt?: string,
  ): boolean {
    return (
      this.database
        .prepare("UPDATE runs SET status = ?, ended_at = ? WHERE id = ?")
        .run(status, endedAt ?? null, id).changes > 0
    );
  }

  public addWarning(id: string, warning: JsonValue): TestRun {
    const run = this.findById(id);
    if (run === undefined) {
      throw new Error("Rularea nu există.");
    }
    const warnings = [...(run.warnings ?? []), warning];
    this.database
      .prepare("UPDATE runs SET warnings_json = ? WHERE id = ?")
      .run(json(warnings), id);
    return { ...run, warnings };
  }

  public updateDatasetSnapshot(id: string, snapshot: JsonValue): boolean {
    return (
      this.database
        .prepare("UPDATE runs SET dataset_snapshot_json = ? WHERE id = ?")
        .run(json(snapshot), id).changes > 0
    );
  }

  public updatePostRunResult(id: string, result: JsonValue): boolean {
    return (
      this.database
        .prepare("UPDATE runs SET post_run_result_json = ? WHERE id = ?")
        .run(json(result), id).changes > 0
    );
  }

  public updateError(id: string, error: JsonValue | undefined): boolean {
    return (
      this.database
        .prepare("UPDATE runs SET error_json = ? WHERE id = ?")
        .run(error === undefined ? null : json(error), id).changes > 0
    );
  }

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM runs WHERE id = ?").run(id).changes > 0
    );
  }

  public deleteMany(projectId: string, runIds: string[]): number {
    const uniqueIds = [...new Set(runIds)].filter((id) => id.length > 0);
    if (uniqueIds.length === 0) return 0;
    const placeholders = uniqueIds.map(() => "?").join(", ");
    return Number(
      this.database
        .prepare(
          `DELETE FROM runs
           WHERE project_id = ? AND id IN (${placeholders})`,
        )
        .run(projectId, ...uniqueIds).changes,
    );
  }

  public deleteAllByProject(projectId: string): number {
    return Number(
      this.database
        .prepare("DELETE FROM runs WHERE project_id = ?")
        .run(projectId).changes,
    );
  }

  public getStorageUsage(projectId: string): {
    metadataBytes: number;
    logsBytes: number;
    snapshotsBytes: number;
    runCount: number;
  } {
    const metadata = this.database
      .prepare(
        `SELECT
          COUNT(*) AS run_count,
          COALESCE(SUM(
            LENGTH(page_version_ids_json) + LENGTH(warnings_json) +
            LENGTH(COALESCE(dataset_snapshot_json, '')) +
            LENGTH(COALESCE(post_run_result_json, '')) +
            LENGTH(COALESCE(error_json, ''))
          ), 0) AS bytes
         FROM runs WHERE project_id = ?`,
      )
      .get(projectId) as DatabaseRow;
    const logs = this.database
      .prepare(
        `SELECT COALESCE(SUM(LENGTH(step_results.logs_json)), 0) AS bytes
         FROM step_results
         JOIN runs ON runs.id = step_results.run_id
         WHERE runs.project_id = ?`,
      )
      .get(projectId) as DatabaseRow;
    const snapshots = this.database
      .prepare(
        `SELECT
          COALESCE((
            SELECT SUM(LENGTH(mysql_run_snapshots.tables_json))
            FROM mysql_run_snapshots
            JOIN runs ON runs.id = mysql_run_snapshots.run_id
            WHERE runs.project_id = ?
          ), 0) +
          COALESCE((
            SELECT SUM(LENGTH(mysql_run_diffs.tables_json))
            FROM mysql_run_diffs
            JOIN runs ON runs.id = mysql_run_diffs.run_id
            WHERE runs.project_id = ?
          ), 0) AS bytes`,
      )
      .get(projectId, projectId) as DatabaseRow;
    return {
      metadataBytes: number(metadata, "bytes"),
      logsBytes: number(logs, "bytes"),
      snapshotsBytes: number(snapshots, "bytes"),
      runCount: number(metadata, "run_count"),
    };
  }

  public purgeLogs(projectId: string): number {
    return Number(
      this.database
        .prepare(
          `UPDATE step_results SET logs_json = '[]'
           WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)
             AND logs_json <> '[]'`,
        )
        .run(projectId).changes,
    );
  }

  public purgeSnapshots(projectId: string): number {
    const snapshotCount = number(
      this.database
        .prepare(
          `SELECT COUNT(*) AS count FROM mysql_run_snapshots
           WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)`,
        )
        .get(projectId) as DatabaseRow,
      "count",
    );
    this.database
      .prepare(
        `DELETE FROM mysql_run_snapshots
         WHERE run_id IN (SELECT id FROM runs WHERE project_id = ?)`,
      )
      .run(projectId);
    this.database
      .prepare(
        `UPDATE runs SET page_version_ids_json = '[]'
         WHERE project_id = ? AND page_version_ids_json <> '[]'`,
      )
      .run(projectId);
    return snapshotCount;
  }

  public createStepResult(result: StepRunResult): StepRunResult {
    this.database
      .prepare(
        `INSERT INTO step_results (
          id, run_id, step_id, stage_id, status, started_at, ended_at,
          locator_used_json, fallback_index, error_json, logs_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.id,
        result.runId,
        result.stepId,
        result.stageId ?? null,
        result.status,
        result.startedAt ?? null,
        result.endedAt ?? null,
        result.locatorUsed === undefined ? null : json(result.locatorUsed),
        result.fallbackIndex ?? null,
        result.error === undefined ? null : json(result.error),
        json(result.logs),
      );
    return result;
  }

  public listStepResults(runId: string): StepRunResult[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM step_results
           WHERE run_id = ? ORDER BY COALESCE(started_at, ''), id`,
        )
        .all(runId),
    ).map(mapStepResult);
  }
}

export class MySqlRunDataRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public createSnapshot(snapshot: MySqlRunSnapshot): MySqlRunSnapshot {
    this.database
      .prepare(
        `INSERT INTO mysql_run_snapshots (
          id, run_id, kind, check_step_id, captured_at, tables_json
        ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        snapshot.id,
        snapshot.runId,
        snapshot.kind,
        snapshot.checkStepId ?? null,
        snapshot.capturedAt,
        json(snapshot.tables),
      );
    return structuredClone(snapshot);
  }

  public findBaseline(
    runId: string,
    baselineKey?: string,
  ): MySqlRunSnapshot | undefined {
    const row = asRow(
      this.database
        .prepare(
          `SELECT * FROM mysql_run_snapshots
           WHERE run_id = ? AND kind = 'baseline'
             AND ${baselineKey === undefined ? "check_step_id IS NULL" : "check_step_id = ?"}`,
        )
        .get(...(baselineKey === undefined ? [runId] : [runId, baselineKey])),
    );
    return row === undefined ? undefined : mapMySqlRunSnapshot(row);
  }

  public listBaselines(runId: string): MySqlRunSnapshot[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM mysql_run_snapshots
           WHERE run_id = ? AND kind = 'baseline'
           ORDER BY captured_at, id`,
        )
        .all(runId),
    ).map(mapMySqlRunSnapshot);
  }

  public findSnapshot(id: string): MySqlRunSnapshot | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM mysql_run_snapshots WHERE id = ?")
        .get(id),
    );
    return row === undefined ? undefined : mapMySqlRunSnapshot(row);
  }

  public createDiff(diff: MySqlRunDiff): MySqlRunDiff {
    this.database
      .prepare(
        `INSERT INTO mysql_run_diffs (
          id, run_id, check_step_id, baseline_snapshot_id,
          current_snapshot_id, created_at, tables_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        diff.id,
        diff.runId,
        diff.checkStepId,
        diff.baselineSnapshotId,
        diff.currentSnapshotId,
        diff.createdAt,
        json(diff.tables),
      );
    return structuredClone(diff);
  }

  public findDiff(id: string): MySqlRunDiff | undefined {
    const row = asRow(
      this.database
        .prepare("SELECT * FROM mysql_run_diffs WHERE id = ?")
        .get(id),
    );
    return row === undefined ? undefined : mapMySqlRunDiff(row);
  }

  public listDiffs(runId: string): MySqlRunDiff[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM mysql_run_diffs
           WHERE run_id = ? ORDER BY created_at, id`,
        )
        .all(runId),
    ).map(mapMySqlRunDiff);
  }

  public createCleanupLog(log: MySqlCleanupLog): MySqlCleanupLog {
    this.database
      .prepare(
        `INSERT INTO mysql_cleanup_logs (
          id, run_id, diff_id, preview_id, status, started_at, ended_at,
          rows_json, affected_rows, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        log.id,
        log.runId,
        log.diffId,
        log.previewId,
        log.status,
        log.startedAt,
        log.endedAt ?? null,
        json(log.rows),
        log.affectedRows,
        log.error ?? null,
      );
    return structuredClone(log);
  }

  public updateCleanupLog(log: MySqlCleanupLog): MySqlCleanupLog {
    const result = this.database
      .prepare(
        `UPDATE mysql_cleanup_logs
         SET status = ?, ended_at = ?, affected_rows = ?, error = ?
         WHERE id = ?`,
      )
      .run(
        log.status,
        log.endedAt ?? null,
        log.affectedRows,
        log.error ?? null,
        log.id,
      );
    if (result.changes !== 1) {
      throw new Error("Jurnalul cleanup MySQL nu există.");
    }
    return structuredClone(log);
  }

  public listCleanupLogs(runId: string): MySqlCleanupLog[] {
    return asRows(
      this.database
        .prepare(
          `SELECT * FROM mysql_cleanup_logs
           WHERE run_id = ? ORDER BY started_at, id`,
        )
        .all(runId),
    ).map(mapMySqlCleanupLog);
  }
}
