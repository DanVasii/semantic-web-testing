import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  Page,
  Project,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
} from "../../shared/persistence.js";
import {
  type ApplicationDatabase,
  openApplicationDatabase,
} from "./database.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./repositories.js";

const NOW = "2026-07-24T10:00:00.000Z";
const LATER = "2026-07-24T11:00:00.000Z";

const project: Project = {
  id: "project-1",
  name: "Magazin demo",
  baseUrl: "https://example.test/?source=codex",
  normalizedBaseUrl: "https://example.test/",
  createdAt: NOW,
  updatedAt: NOW,
  browserConfig: {
    browserType: "chromium",
    sessionMode: "reusable",
    headless: false,
    viewport: { width: 1440, height: 900 },
  },
  aiConfig: { provider: "openai", model: "test-model" },
  mysqlConfig: { host: "127.0.0.1", port: 3306 },
  shortcutConfig: { run: "Ctrl+Enter" },
};

const page: Page = {
  id: "page-1",
  projectId: project.id,
  name: "Rezervare",
  url: "https://example.test/booking?service=10",
  normalizedUrl: "https://example.test/booking",
  createdAt: NOW,
  updatedAt: NOW,
};

const testDefinition: TestDefinition = {
  id: "test-1",
  projectId: project.id,
  name: "Rezervă serviciu",
  description: "Flux semantic principal",
  status: "valid",
  version: 1,
  wipeBeforeRun: true,
  startMode: "base_url",
  startUrl: "https://example.test/booking?service=10",
  normalizedStartUrl: "https://example.test/booking?service=10",
  workflowState: "ready",
  createdAt: NOW,
  updatedAt: NOW,
  flowItems: [{ type: "action", semanticId: "booking_date" }],
};

let temporaryDirectory: string;
let applicationDatabase: ApplicationDatabase;
let database: DatabaseSync;

beforeEach(async () => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "semantic-app-repository-"));
  applicationDatabase = await openApplicationDatabase({
    filePath: join(temporaryDirectory, "application.sqlite"),
  });
  database = applicationDatabase.connection;
});

afterEach(() => {
  applicationDatabase.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

const createProjectAndTest = (): {
  projectRepository: ProjectRepository;
  testRepository: TestRepository;
} => {
  const projectRepository = new ProjectRepository(database);
  const testRepository = new TestRepository(database);
  projectRepository.create(project);
  testRepository.create(testDefinition);
  return { projectRepository, testRepository };
};

describe("ProjectRepository", () => {
  it("creates, reads, lists, updates and deletes projects", () => {
    const repository = new ProjectRepository(database);

    repository.create(project);
    expect(repository.findById(project.id)).toEqual(project);
    expect(repository.list()).toEqual([project]);

    const updated = {
      ...project,
      name: "Magazin semantic",
      updatedAt: LATER,
    };
    repository.update(updated);
    expect(repository.findById(project.id)).toEqual(updated);
    expect(repository.delete(project.id)).toBe(true);
    expect(repository.findById(project.id)).toBeUndefined();
    expect(repository.delete(project.id)).toBe(false);
  });
});

describe("PageRepository", () => {
  it("persists pages and ordered immutable page versions", () => {
    new ProjectRepository(database).create(project);
    const repository = new PageRepository(database);
    repository.create(page);

    repository.createVersion({
      id: "page-version-1",
      pageId: page.id,
      versionNumber: 1,
      createdAt: NOW,
      normalizedUrl: page.normalizedUrl,
      domFilePath: "pages/booking/v1/dom.html",
      cssFilePath: "pages/booking/v1/styles.css",
      accessibilityFilePath: "pages/booking/v1/accessibility.json",
      analysisFilePath: "pages/booking/v1/analysis.json",
      semanticHash: "hash-v1",
    });
    repository.createVersion({
      id: "page-version-2",
      pageId: page.id,
      versionNumber: 2,
      createdAt: LATER,
      normalizedUrl: page.normalizedUrl,
      domFilePath: "pages/booking/v2/dom.html",
      cssFilePath: "pages/booking/v2/styles.css",
      accessibilityFilePath: "pages/booking/v2/accessibility.json",
      analysisFilePath: "pages/booking/v2/analysis.json",
      semanticHash: "hash-v2",
    });

    expect(repository.findById(page.id)).toEqual(page);
    expect(repository.listByProject(project.id)).toEqual([page]);
    expect(
      repository
        .listVersions(page.id)
        .map(({ versionNumber }) => versionNumber),
    ).toEqual([2, 1]);

    const renamed = { ...page, name: "Programare", updatedAt: LATER };
    repository.update(renamed);
    expect(repository.findById(page.id)).toEqual(renamed);
    expect(repository.delete(page.id)).toBe(true);
    expect(repository.listVersions(page.id)).toEqual([]);
  });
});

describe("TestRepository and DatasetRepository", () => {
  it("persists test definitions, versions and typed datasets", () => {
    const { testRepository } = createProjectAndTest();
    const datasetRepository = new DatasetRepository(database);
    const dataset: TestDataset = {
      id: "dataset-1",
      testId: testDefinition.id,
      name: "Client valid",
      values: {
        customer_email: "ana@example.test",
        retry_count: 2,
        newsletter: false,
      },
      createdAt: NOW,
      updatedAt: NOW,
    };

    testRepository.createVersion({
      id: "test-version-1",
      testId: testDefinition.id,
      versionNumber: 1,
      source: "manual",
      createdAt: NOW,
      snapshotFilePath: "tests/test-1/v1.json",
    });
    datasetRepository.create(dataset);

    expect(testRepository.findById(testDefinition.id)).toEqual(testDefinition);
    expect(testRepository.listByProject(project.id)).toEqual([testDefinition]);
    expect(testRepository.listVersions(testDefinition.id)).toHaveLength(1);
    expect(datasetRepository.findById(dataset.id)).toEqual(dataset);
    expect(datasetRepository.listByTest(testDefinition.id)).toEqual([dataset]);

    const updatedDataset = {
      ...dataset,
      name: "Client actualizat",
      updatedAt: LATER,
    };
    datasetRepository.update(updatedDataset);
    expect(datasetRepository.findById(dataset.id)).toEqual(updatedDataset);
    expect(datasetRepository.delete(dataset.id)).toBe(true);
  });
});

describe("RunRepository", () => {
  it("persists run history and detailed step results", () => {
    createProjectAndTest();
    const repository = new RunRepository(database);
    const run: TestRun = {
      id: "run-1",
      projectId: project.id,
      testId: testDefinition.id,
      testVersion: 1,
      startedAt: NOW,
      status: "running",
      browserType: "chromium",
      pageVersionIds: ["page-version-1"],
    };
    const result: StepRunResult = {
      id: "result-1",
      runId: run.id,
      stepId: "step-1",
      status: "passed_with_fallback",
      startedAt: NOW,
      endedAt: LATER,
      locatorUsed: { strategy: "role", value: "button" },
      fallbackIndex: 1,
      logs: [{ level: "info", message: "Fallback locator selected." }],
    };

    repository.create(run);
    repository.createStepResult(result);

    expect(repository.findById(run.id)).toEqual(run);
    expect(repository.listByProject(project.id)).toEqual([run]);
    expect(repository.listStepResults(run.id)).toEqual([result]);
    expect(repository.updateStatus(run.id, "passed", LATER)).toBe(true);
    expect(repository.findById(run.id)).toEqual({
      ...run,
      endedAt: LATER,
      status: "passed",
    });

    expect(repository.delete(run.id)).toBe(true);
    expect(repository.listStepResults(run.id)).toEqual([]);
  });
});

describe("foreign-key integrity", () => {
  it("cascades project removal through related Group C records", () => {
    const { projectRepository } = createProjectAndTest();
    new PageRepository(database).create(page);

    projectRepository.delete(project.id);

    const remaining = database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM pages) AS pages,
          (SELECT COUNT(*) FROM tests) AS tests`,
      )
      .get() as { pages: number; tests: number };
    expect(remaining).toEqual({ pages: 0, tests: 0 });
  });
});
