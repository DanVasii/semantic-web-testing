import type { JsonValue, TestRun } from "../shared/persistence.js";
import type {
  RunHistoryDetails,
  RunHistoryEntry,
  RunHistoryFilters,
  RunHistoryMutationResult,
  RunHistoryPurgeTarget,
  RunStorageUsage,
} from "../shared/run-history.js";
import {
  DatasetRepository,
  MySqlRunDataRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./persistence/repositories.js";

const asRecord = (
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;

export class RunHistoryService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly tests: TestRepository,
    private readonly datasets: DatasetRepository,
    private readonly runs: RunRepository,
    private readonly mysql: MySqlRunDataRepository,
  ) {}

  public list(
    projectId: string,
    filters: RunHistoryFilters = {},
  ): RunHistoryEntry[] {
    this.requireProject(projectId);
    const statuses = new Set(filters.statuses ?? []);
    return this.runs
      .listByProject(projectId)
      .filter(
        (run) =>
          (filters.testId === undefined || run.testId === filters.testId) &&
          (statuses.size === 0 || statuses.has(run.status)),
      )
      .map((run) => this.entry(run));
  }

  public details(projectId: string, runId: string): RunHistoryDetails {
    this.requireProject(projectId);
    const run = this.requireRun(projectId, runId);
    const steps = this.runs.listStepResults(run.id);
    const snapshot = asRecord(run.datasetSnapshot);
    const values = snapshot?.["values"];
    const dataset =
      snapshot === undefined
        ? undefined
        : {
            ...(typeof snapshot["id"] === "string"
              ? { id: snapshot["id"] }
              : {}),
            ...(typeof snapshot["name"] === "string"
              ? { name: snapshot["name"] }
              : {}),
            values: values ?? {},
          };
    return {
      entry: this.entry(run, steps),
      steps,
      ...(dataset === undefined ? {} : { dataset }),
      mysqlDiffs: this.mysql.listDiffs(run.id),
      imapResults: steps
        .filter(({ stepId }) => stepId.startsWith("post-run:imap:"))
        .map((step) => ({
          stepId: step.stepId,
          status: step.status,
          ...(step.error === undefined ? {} : { error: step.error }),
          logs: structuredClone(step.logs),
        })),
      ...(run.postRunResult === undefined
        ? {}
        : { postRunResult: structuredClone(run.postRunResult) }),
      ...(run.error === undefined ? {} : { error: structuredClone(run.error) }),
    };
  }

  public delete(projectId: string, runIds: string[]): RunHistoryMutationResult {
    this.requireProject(projectId);
    const uniqueIds = [...new Set(runIds)];
    for (const runId of uniqueIds) {
      const run = this.requireRun(projectId, runId);
      if (run.status === "running") {
        throw new Error("O rulare activă nu poate fi ștearsă.");
      }
    }
    const affected = this.runs.deleteMany(projectId, uniqueIds);
    return { affected, storage: this.storage(projectId) };
  }

  public deleteAll(projectId: string): RunHistoryMutationResult {
    this.requireProject(projectId);
    if (
      this.runs
        .listByProject(projectId)
        .some(({ status }) => status === "running")
    ) {
      throw new Error("O rulare activă nu poate fi ștearsă.");
    }
    const affected = this.runs.deleteAllByProject(projectId);
    return { affected, storage: this.storage(projectId) };
  }

  public storage(projectId: string): RunStorageUsage {
    this.requireProject(projectId);
    const usage = this.runs.getStorageUsage(projectId);
    return {
      ...usage,
      totalBytes: usage.metadataBytes + usage.logsBytes + usage.snapshotsBytes,
    };
  }

  public purge(
    projectId: string,
    target: RunHistoryPurgeTarget,
  ): RunHistoryMutationResult {
    this.requireProject(projectId);
    const affected =
      target === "logs"
        ? this.runs.purgeLogs(projectId)
        : target === "snapshots"
          ? this.runs.purgeSnapshots(projectId)
          : 0;
    if (target !== "logs" && target !== "snapshots") {
      throw new Error("Tipul de date pentru curățare nu este valid.");
    }
    return { affected, storage: this.storage(projectId) };
  }

  private entry(
    run: TestRun,
    providedSteps = this.runs.listStepResults(run.id),
  ): RunHistoryEntry {
    const test = this.tests.findById(run.testId);
    const dataset =
      run.datasetId === undefined
        ? undefined
        : this.datasets.findById(run.datasetId);
    const startedAt = Date.parse(run.startedAt);
    const endedAt =
      run.endedAt === undefined ? Number.NaN : Date.parse(run.endedAt);
    return {
      run,
      testName: test?.name ?? "Test șters",
      ...(dataset === undefined ? {} : { datasetName: dataset.name }),
      ...(Number.isFinite(startedAt) && Number.isFinite(endedAt)
        ? { durationMs: Math.max(0, endedAt - startedAt) }
        : {}),
      stepCount: providedSteps.length,
      failedStepCount: providedSteps.filter(({ status }) => status === "failed")
        .length,
      fallbackStepCount: providedSteps.filter(
        ({ status }) => status === "passed_with_fallback",
      ).length,
    };
  }

  private requireProject(projectId: string): void {
    if (this.projects.findById(projectId) === undefined) {
      throw new Error("Proiectul nu mai există.");
    }
  }

  private requireRun(projectId: string, runId: string): TestRun {
    const run = this.runs.findById(runId);
    if (run === undefined || run.projectId !== projectId) {
      throw new Error("Rularea nu există.");
    }
    return run;
  }
}
