import type { DatabaseSync } from "node:sqlite";

import type {
  BatchRun,
  BatchRunItem,
  BatchRunItemStatus,
  BatchRunStatus,
  FlakyTestStatistic,
  RunArtifact,
  TestSuite,
} from "../../shared/test-suites.js";

type Row = Record<string, unknown>;
const rows = (value: unknown[]): Row[] => value as Row[];
const row = (value: unknown): Row | undefined => value as Row | undefined;
const text = (value: Row, key: string): string => value[key] as string;
const optionalText = (value: Row, key: string): string | undefined =>
  value[key] === null || value[key] === undefined
    ? undefined
    : (value[key] as string);
const number = (value: Row, key: string): number => value[key] as number;
const json = (value: unknown): string => JSON.stringify(value);

const mapSuite = (value: Row): TestSuite => ({
  id: text(value, "id"),
  projectId: text(value, "project_id"),
  name: text(value, "name"),
  ...(optionalText(value, "description") === undefined
    ? {}
    : { description: optionalText(value, "description")! }),
  items: JSON.parse(text(value, "items_json")) as TestSuite["items"],
  settings: JSON.parse(text(value, "settings_json")) as TestSuite["settings"],
  createdAt: text(value, "created_at"),
  updatedAt: text(value, "updated_at"),
});

const mapBatchItem = (value: Row): BatchRunItem => ({
  id: text(value, "id"),
  batchRunId: text(value, "batch_run_id"),
  testId: text(value, "test_id"),
  testName: text(value, "test_name"),
  position: number(value, "position"),
  ...(optionalText(value, "dataset_id") === undefined
    ? {}
    : { datasetId: optionalText(value, "dataset_id")! }),
  ...(optionalText(value, "run_id") === undefined
    ? {}
    : { runId: optionalText(value, "run_id")! }),
  status: text(value, "status") as BatchRunItemStatus,
  retryCount: number(value, "retry_count"),
  ...(optionalText(value, "error") === undefined
    ? {}
    : { error: optionalText(value, "error")! }),
});

export class TestSuiteRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public save(suite: TestSuite): TestSuite {
    this.database
      .prepare(
        `INSERT INTO test_suites (
          id, project_id, name, description, items_json, settings_json,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          name = excluded.name,
          description = excluded.description,
          items_json = excluded.items_json,
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        suite.id,
        suite.projectId,
        suite.name,
        suite.description ?? null,
        json(suite.items),
        json(suite.settings),
        suite.createdAt,
        suite.updatedAt,
      );
    return suite;
  }

  public findById(id: string): TestSuite | undefined {
    const value = row(
      this.database.prepare("SELECT * FROM test_suites WHERE id = ?").get(id),
    );
    return value === undefined ? undefined : mapSuite(value);
  }

  public listByProject(projectId: string): TestSuite[] {
    return rows(
      this.database
        .prepare(
          "SELECT * FROM test_suites WHERE project_id = ? ORDER BY name COLLATE NOCASE, id",
        )
        .all(projectId),
    ).map(mapSuite);
  }

  public delete(projectId: string, id: string): boolean {
    return (
      this.database
        .prepare("DELETE FROM test_suites WHERE project_id = ? AND id = ?")
        .run(projectId, id).changes > 0
    );
  }
}

export class BatchRunRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(batch: BatchRun): BatchRun {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.database
        .prepare(
          `INSERT INTO batch_runs (
            id, project_id, suite_id, name, status, settings_json,
            started_at, ended_at, cleanup_status
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          batch.id,
          batch.projectId,
          batch.suiteId ?? null,
          batch.name,
          batch.status,
          json(batch.settings),
          batch.startedAt,
          batch.endedAt ?? null,
          batch.cleanupStatus ?? null,
        );
      const statement = this.database.prepare(
        `INSERT INTO batch_run_items (
          id, batch_run_id, test_id, test_name, position, dataset_id,
          run_id, status, retry_count, error
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const item of batch.items) {
        statement.run(
          item.id,
          batch.id,
          item.testId,
          item.testName,
          item.position,
          item.datasetId ?? null,
          item.runId ?? null,
          item.status,
          item.retryCount,
          item.error ?? null,
        );
      }
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return batch;
  }

  public findById(id: string): BatchRun | undefined {
    const value = row(
      this.database.prepare("SELECT * FROM batch_runs WHERE id = ?").get(id),
    );
    if (value === undefined) return undefined;
    return this.mapBatch(value);
  }

  public listByProject(projectId: string): BatchRun[] {
    return rows(
      this.database
        .prepare(
          "SELECT * FROM batch_runs WHERE project_id = ? ORDER BY started_at DESC, id",
        )
        .all(projectId),
    ).map((value) => this.mapBatch(value));
  }

  public updateItem(item: BatchRunItem): boolean {
    return (
      this.database
        .prepare(
          `UPDATE batch_run_items SET
            run_id = ?, status = ?, retry_count = ?, error = ?
           WHERE id = ? AND batch_run_id = ?`,
        )
        .run(
          item.runId ?? null,
          item.status,
          item.retryCount,
          item.error ?? null,
          item.id,
          item.batchRunId,
        ).changes > 0
    );
  }

  public complete(
    id: string,
    status: BatchRunStatus,
    endedAt: string,
    cleanupStatus?: BatchRun["cleanupStatus"],
  ): boolean {
    return (
      this.database
        .prepare(
          `UPDATE batch_runs SET status = ?, ended_at = ?, cleanup_status = ?
           WHERE id = ?`,
        )
        .run(status, endedAt, cleanupStatus ?? null, id).changes > 0
    );
  }

  public flakyStatistics(projectId: string): FlakyTestStatistic[] {
    return rows(
      this.database
        .prepare(
          `SELECT i.test_id, MAX(i.test_name) AS test_name,
            COUNT(*) AS total_runs,
            SUM(CASE WHEN i.status = 'flaky' THEN 1 ELSE 0 END) AS flaky_runs,
            SUM(CASE WHEN i.status = 'failed' THEN 1 ELSE 0 END) AS failed_runs
           FROM batch_run_items i
           JOIN batch_runs b ON b.id = i.batch_run_id
           WHERE b.project_id = ? AND i.status IN ('passed','flaky','failed')
           GROUP BY i.test_id
           ORDER BY flaky_runs DESC, failed_runs DESC, test_name COLLATE NOCASE`,
        )
        .all(projectId),
    ).map((value) => {
      const totalRuns = number(value, "total_runs");
      const flakyRuns = number(value, "flaky_runs");
      return {
        testId: text(value, "test_id"),
        testName: text(value, "test_name"),
        totalRuns,
        flakyRuns,
        failedRuns: number(value, "failed_runs"),
        flakyRate: totalRuns === 0 ? 0 : flakyRuns / totalRuns,
      };
    });
  }

  private mapBatch(value: Row): BatchRun {
    const id = text(value, "id");
    const items = rows(
      this.database
        .prepare(
          "SELECT * FROM batch_run_items WHERE batch_run_id = ? ORDER BY position, id",
        )
        .all(id),
    ).map(mapBatchItem);
    return {
      id,
      projectId: text(value, "project_id"),
      ...(optionalText(value, "suite_id") === undefined
        ? {}
        : { suiteId: optionalText(value, "suite_id")! }),
      name: text(value, "name"),
      status: text(value, "status") as BatchRunStatus,
      settings: JSON.parse(
        text(value, "settings_json"),
      ) as BatchRun["settings"],
      startedAt: text(value, "started_at"),
      ...(optionalText(value, "ended_at") === undefined
        ? {}
        : { endedAt: optionalText(value, "ended_at")! }),
      ...(optionalText(value, "cleanup_status") === undefined
        ? {}
        : {
            cleanupStatus: optionalText(value, "cleanup_status") as NonNullable<
              BatchRun["cleanupStatus"]
            >,
          }),
      items,
    };
  }
}

export class RunArtifactRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public create(artifact: RunArtifact): RunArtifact {
    this.database
      .prepare(
        `INSERT INTO run_artifacts (
          id, run_id, kind, file_path, mime_type, size_bytes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        artifact.id,
        artifact.runId,
        artifact.kind,
        artifact.filePath,
        artifact.mimeType,
        artifact.sizeBytes,
        artifact.createdAt,
      );
    return artifact;
  }

  public listByRun(runId: string): RunArtifact[] {
    return rows(
      this.database
        .prepare(
          "SELECT * FROM run_artifacts WHERE run_id = ? ORDER BY created_at, id",
        )
        .all(runId),
    ).map((value) => ({
      id: text(value, "id"),
      runId: text(value, "run_id"),
      kind: text(value, "kind") as RunArtifact["kind"],
      filePath: text(value, "file_path"),
      mimeType: text(value, "mime_type"),
      sizeBytes: number(value, "size_bytes"),
      createdAt: text(value, "created_at"),
    }));
  }
}
