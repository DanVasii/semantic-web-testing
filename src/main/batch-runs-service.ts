import type {
  BatchRun,
  BatchRunStatus,
  CreateBatchRunInput,
  FlakyTestStatistic,
  UpdateBatchRunItemInput,
} from "../shared/test-suites.js";
import {
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { BatchRunRepository } from "./persistence/suite-repositories.js";

export interface BatchRunsServiceOptions {
  createId: () => string;
  now: () => Date;
}

export class BatchRunsService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly tests: TestRepository,
    private readonly batches: BatchRunRepository,
    private readonly options: BatchRunsServiceOptions,
  ) {}

  public create(input: CreateBatchRunInput): BatchRun {
    this.requireProject(input.projectId);
    if (input.items.length === 0) throw new Error("Batch-ul nu conține teste.");
    const id = this.options.createId();
    const batch: BatchRun = {
      id,
      projectId: input.projectId,
      ...(input.suiteId === undefined ? {} : { suiteId: input.suiteId }),
      name: input.name.trim() || "Run all tests",
      status: "running",
      settings: { ...input.settings },
      startedAt: this.options.now().toISOString(),
      items: input.items.map((item, position) => {
        const test = this.tests.findById(item.testId);
        if (test === undefined || test.projectId !== input.projectId) {
          throw new Error("Batch-ul conține un test inexistent.");
        }
        return {
          id: this.options.createId(),
          batchRunId: id,
          testId: item.testId,
          testName: item.testName,
          position,
          ...(item.datasetId === undefined
            ? {}
            : { datasetId: item.datasetId }),
          status: "queued" as const,
          retryCount: 0,
        };
      }),
    };
    return this.batches.create(batch);
  }

  public updateItem(batchId: string, input: UpdateBatchRunItemInput): BatchRun {
    const batch = this.requireBatch(batchId);
    const item = batch.items.find(({ id }) => id === input.itemId);
    if (item === undefined) throw new Error("Elementul batch-ului nu există.");
    this.batches.updateItem({
      ...item,
      status: input.status,
      retryCount: input.retryCount,
      ...(input.runId === undefined ? {} : { runId: input.runId }),
      ...(input.error === undefined ? {} : { error: input.error }),
    });
    return this.requireBatch(batchId);
  }

  public complete(
    batchId: string,
    status: BatchRunStatus,
    cleanupStatus?: BatchRun["cleanupStatus"],
  ): BatchRun {
    this.requireBatch(batchId);
    this.batches.complete(
      batchId,
      status,
      this.options.now().toISOString(),
      cleanupStatus,
    );
    return this.requireBatch(batchId);
  }

  public list(projectId: string): BatchRun[] {
    this.requireProject(projectId);
    return this.batches.listByProject(projectId);
  }

  public get(projectId: string, batchId: string): BatchRun {
    this.requireProject(projectId);
    const batch = this.requireBatch(batchId);
    if (batch.projectId !== projectId)
      throw new Error("Batch-ul nu aparține proiectului.");
    return batch;
  }

  public flakyStatistics(projectId: string): FlakyTestStatistic[] {
    this.requireProject(projectId);
    return this.batches.flakyStatistics(projectId);
  }

  private requireProject(projectId: string): void {
    if (this.projects.findById(projectId) === undefined) {
      throw new Error("Proiectul nu există.");
    }
  }

  private requireBatch(batchId: string): BatchRun {
    const batch = this.batches.findById(batchId);
    if (batch === undefined) throw new Error("Batch-ul nu există.");
    return batch;
  }
}
