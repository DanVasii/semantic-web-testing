import type { SaveTestSuiteInput, TestSuite } from "../shared/test-suites.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { TestSuiteRepository } from "./persistence/suite-repositories.js";

export interface TestSuitesServiceOptions {
  createId: () => string;
  now: () => Date;
}

export class TestSuitesService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly tests: TestRepository,
    private readonly datasets: DatasetRepository,
    private readonly suites: TestSuiteRepository,
    private readonly options: TestSuitesServiceOptions,
  ) {}

  public list(projectId: string): TestSuite[] {
    this.requireProject(projectId);
    return this.suites.listByProject(projectId);
  }

  public save(
    projectId: string,
    suiteId: string | undefined,
    input: SaveTestSuiteInput,
  ): TestSuite {
    this.requireProject(projectId);
    const name = input.name.trim();
    if (name.length === 0 || name.length > 120) {
      throw new Error(
        "Numele suitei trebuie să aibă între 1 și 120 de caractere.",
      );
    }
    if (input.items.length === 0) {
      throw new Error("Suita trebuie să conțină cel puțin un test.");
    }
    if (
      !Number.isInteger(input.settings.maxStepRetries) ||
      input.settings.maxStepRetries < 0 ||
      input.settings.maxStepRetries > 5
    ) {
      throw new Error("Numărul de retry-uri trebuie să fie între 0 și 5.");
    }
    const uniqueTests = new Set<string>();
    for (const item of input.items) {
      const test = this.tests.findById(item.testId);
      if (test === undefined || test.projectId !== projectId) {
        throw new Error("Suita conține un test inexistent.");
      }
      if (uniqueTests.has(item.testId)) {
        throw new Error("Același test nu poate apărea de două ori în suită.");
      }
      uniqueTests.add(item.testId);
      if (item.datasetId !== undefined) {
        const dataset = this.datasets.findById(item.datasetId);
        if (dataset === undefined || dataset.testId !== item.testId) {
          throw new Error("Un dataset selectat nu aparține testului asociat.");
        }
      }
    }
    const existing =
      suiteId === undefined ? undefined : this.suites.findById(suiteId);
    if (existing !== undefined && existing.projectId !== projectId) {
      throw new Error("Suita nu aparține proiectului.");
    }
    const now = this.options.now().toISOString();
    return this.suites.save({
      id: existing?.id ?? this.options.createId(),
      projectId,
      name,
      ...(input.description?.trim()
        ? { description: input.description.trim() }
        : {}),
      items: structuredClone(input.items),
      settings: { ...input.settings },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  }

  public delete(projectId: string, suiteId: string): boolean {
    this.requireProject(projectId);
    return this.suites.delete(projectId, suiteId);
  }

  private requireProject(projectId: string): void {
    if (this.projects.findById(projectId) === undefined) {
      throw new Error("Proiectul nu există.");
    }
  }
}
