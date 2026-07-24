import type { TestDefinition } from "../shared/persistence.js";
import {
  hasTestInputErrors,
  normalizeTestStartUrl,
  type TestInput,
  validateTestInput,
} from "../shared/tests.js";
import {
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";

export interface TestsServiceOptions {
  createId: () => string;
  now: () => Date;
}

export class TestsService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly options: TestsServiceOptions,
  ) {}

  public list(projectId: string): TestDefinition[] {
    this.requireProject(projectId);
    return this.testRepository.listByProject(projectId);
  }

  public get(projectId: string, testId: string): TestDefinition {
    this.requireProject(projectId);
    const test = this.testRepository.findById(testId);

    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu mai există.");
    }

    return test;
  }

  public create(projectId: string, input: TestInput): TestDefinition {
    const project = this.requireProject(projectId);
    const errors = validateTestInput(input, project);

    if (hasTestInputErrors(errors)) {
      throw new Error("Datele testului nu sunt valide.");
    }

    const now = this.options.now().toISOString();
    const description = input.description?.trim();
    const startUrl = input.startUrl.trim();
    const test: TestDefinition = {
      id: this.options.createId(),
      projectId,
      name: input.name.trim(),
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      status: "draft",
      version: 1,
      wipeBeforeRun: false,
      startMode: "base_url",
      startUrl,
      normalizedStartUrl: normalizeTestStartUrl(startUrl),
      workflowState: "not_recorded",
      createdAt: now,
      updatedAt: now,
      flowItems: [],
    };
    return this.testRepository.create(test);
  }

  public update(
    projectId: string,
    testId: string,
    input: TestInput,
  ): TestDefinition {
    const project = this.requireProject(projectId);
    const existing = this.get(projectId, testId);
    const errors = validateTestInput(input, project);

    if (hasTestInputErrors(errors)) {
      throw new Error("Datele testului nu sunt valide.");
    }

    const normalizedStartUrl = normalizeTestStartUrl(input.startUrl);
    const startUrlChanged = normalizedStartUrl !== existing.normalizedStartUrl;
    const description = input.description?.trim();
    const updated: TestDefinition = {
      ...existing,
      name: input.name.trim(),
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      status: startUrlChanged ? "draft" : existing.status,
      version: existing.version + 1,
      startUrl: input.startUrl.trim(),
      normalizedStartUrl,
      workflowState: startUrlChanged ? "not_recorded" : existing.workflowState,
      updatedAt: this.options.now().toISOString(),
      flowItems: startUrlChanged ? [] : existing.flowItems,
    };
    if (description === undefined || description.length === 0) {
      delete updated.description;
    }

    return this.testRepository.update(updated);
  }

  public delete(projectId: string, testId: string): boolean {
    this.get(projectId, testId);
    return this.testRepository.delete(testId);
  }

  private requireProject(projectId: string) {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) {
      throw new Error("Proiectul nu mai există.");
    }
    return project;
  }
}
