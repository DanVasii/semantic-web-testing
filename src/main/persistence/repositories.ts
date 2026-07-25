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
});

const mapTest = (row: DatabaseRow): TestDefinition => {
  const description = optionalText(row, "description");

  return {
    id: text(row, "id"),
    projectId: text(row, "project_id"),
    name: text(row, "name"),
    ...(description === undefined ? {} : { description }),
    status: text(row, "status") as TestStatus,
    version: number(row, "version"),
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
  };
};

const mapStepResult = (row: DatabaseRow): StepRunResult => {
  const startedAt = optionalText(row, "started_at");
  const endedAt = optionalText(row, "ended_at");
  const locatorUsed = optionalText(row, "locator_used_json");
  const fallbackIndex = optionalNumber(row, "fallback_index");
  const error = optionalText(row, "error_json");

  return {
    id: text(row, "id"),
    runId: text(row, "run_id"),
    stepId: text(row, "step_id"),
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

export interface ProjectBasicAuthRecord {
  projectId: string;
  origin: string;
  username: string;
  encryptedPassword: string;
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
          analysis_file_path, semantic_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
          id, project_id, name, description, status, version,
          wipe_before_run, start_mode, start_url, normalized_start_url,
          workflow_state, created_at, updated_at, flow_items_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        test.id,
        test.projectId,
        test.name,
        test.description ?? null,
        test.status,
        test.version,
        test.wipeBeforeRun ? 1 : 0,
        test.startMode,
        test.startUrl,
        test.normalizedStartUrl,
        test.workflowState,
        test.createdAt,
        test.updatedAt,
        json(test.flowItems),
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
          wipe_before_run = ?, start_mode = ?, start_url = ?,
          normalized_start_url = ?, workflow_state = ?, updated_at = ?,
          flow_items_json = ?
        WHERE id = ?`,
      )
      .run(
        test.name,
        test.description ?? null,
        test.status,
        test.version,
        test.wipeBeforeRun ? 1 : 0,
        test.startMode,
        test.startUrl,
        test.normalizedStartUrl,
        test.workflowState,
        test.updatedAt,
        json(test.flowItems),
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
          ended_at, status, browser_type, page_version_ids_json, warnings_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  public delete(id: string): boolean {
    return (
      this.database.prepare("DELETE FROM runs WHERE id = ?").run(id).changes > 0
    );
  }

  public createStepResult(result: StepRunResult): StepRunResult {
    this.database
      .prepare(
        `INSERT INTO step_results (
          id, run_id, step_id, status, started_at, ended_at,
          locator_used_json, fallback_index, error_json, logs_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        result.id,
        result.runId,
        result.stepId,
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
