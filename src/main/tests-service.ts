import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { TestDefinition, TestVersion } from "../shared/persistence.js";
import { toDeclarativeTestDefinition } from "../shared/test-editor.js";
import type { TestFlowItem } from "../shared/test-model.js";
import { validateDeclarativeTest } from "../shared/test-validation.js";
import {
  hasTestInputErrors,
  normalizeTestStartUrl,
  type TestInput,
  validateTestInput,
} from "../shared/tests.js";
import {
  ProjectRepository,
  DatasetRepository,
  TestRepository,
} from "./persistence/repositories.js";

export interface TestsServiceOptions {
  createId: () => string;
  now: () => Date;
  snapshotRoot: string;
}

export class TestsService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
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
      wipeBeforeRun: input.wipeBeforeRun ?? false,
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
      wipeBeforeRun: input.wipeBeforeRun ?? existing.wipeBeforeRun,
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

  public async saveFlow(
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
  ): Promise<TestDefinition> {
    const existing = this.get(projectId, testId);
    const now = this.options.now().toISOString();
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      status: flowItems.length === 0 ? "draft" : "valid",
      workflowState: flowItems.length === 0 ? "not_recorded" : "ready",
      updatedAt: now,
      flowItems,
    };
    const snapshot = toDeclarativeTestDefinition(
      updated,
      flowItems,
      this.datasetRepository.listByTest(testId),
    );
    const validation = validateDeclarativeTest(snapshot);
    if (!validation.valid) {
      throw new Error(
        `Flow-ul testului nu este valid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }

    const snapshotPath = join(
      "projects",
      projectId,
      "tests",
      testId,
      `v${updated.version}`,
      "test.json",
    );
    const absolutePath = this.resolveSnapshotPath(snapshotPath);
    const temporaryDirectory = `${dirname(absolutePath)}.tmp-${this.options.createId()}`;
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(
      join(temporaryDirectory, "test.json"),
      `${JSON.stringify(validation.data, null, 2)}\n`,
      "utf8",
    );

    try {
      await mkdir(dirname(dirname(absolutePath)), { recursive: true });
      await rename(temporaryDirectory, dirname(absolutePath));
      this.testRepository.update(updated);
      this.testRepository.createVersion({
        id: this.options.createId(),
        testId,
        versionNumber: updated.version,
        source: "manual",
        createdAt: now,
        snapshotFilePath: snapshotPath.replaceAll("\\", "/"),
      });
      return updated;
    } catch (error) {
      this.testRepository.update(existing);
      await rm(dirname(absolutePath), { force: true, recursive: true });
      await rm(temporaryDirectory, { force: true, recursive: true });
      throw error;
    }
  }

  public listVersions(projectId: string, testId: string): TestVersion[] {
    this.get(projectId, testId);
    return this.testRepository.listVersions(testId);
  }

  private resolveSnapshotPath(portablePath: string): string {
    const root = resolve(this.options.snapshotRoot);
    const target = resolve(root, portablePath);
    const pathFromRoot = relative(root, target);
    if (
      pathFromRoot.startsWith("..") ||
      pathFromRoot.length === 0 ||
      /^[A-Za-z]:/.test(pathFromRoot)
    ) {
      throw new Error("Calea snapshot-ului nu este sigură.");
    }
    return target;
  }

  private requireProject(projectId: string) {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) {
      throw new Error("Proiectul nu mai există.");
    }
    return project;
  }
}
