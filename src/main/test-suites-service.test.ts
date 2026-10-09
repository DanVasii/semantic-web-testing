import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  Project,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import { defaultTestPostRunChecks } from "../shared/post-run-checks.js";
import { BatchRunsService } from "./batch-runs-service.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./persistence/repositories.js";
import {
  BatchRunRepository,
  RunArtifactRepository,
  TestSuiteRepository,
} from "./persistence/suite-repositories.js";
import { TestSuitesService } from "./test-suites-service.js";

const now = new Date("2026-08-31T12:00:00.000Z");
const project: Project = {
  id: "project-1",
  name: "Demo",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};
const test: TestDefinition = {
  id: "test-1",
  projectId: project.id,
  name: "Checkout",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/checkout",
  normalizedStartUrl: "https://example.test/checkout",
  workflowState: "ready",
  createdAt: now.toISOString(),
  updatedAt: now.toISOString(),
  flowItems: [],
  postRunChecks: defaultTestPostRunChecks(),
};

describe("test suites and persistent batch runs", () => {
  let directory: string;
  let applicationDatabase: ApplicationDatabase;
  let ids: number;

  beforeEach(async () => {
    directory = mkdtempSync(join(tmpdir(), "semantic-suites-"));
    applicationDatabase = await openApplicationDatabase({
      filePath: join(directory, "app.sqlite"),
    });
    new ProjectRepository(applicationDatabase.connection).create(project);
    new TestRepository(applicationDatabase.connection).create(test);
    ids = 0;
  });

  afterEach(() => {
    applicationDatabase.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("saves ordered suite settings and records flaky batch results with artifacts", () => {
    const projects = new ProjectRepository(applicationDatabase.connection);
    const tests = new TestRepository(applicationDatabase.connection);
    const suitesRepository = new TestSuiteRepository(
      applicationDatabase.connection,
    );
    const batchesRepository = new BatchRunRepository(
      applicationDatabase.connection,
    );
    const createId = (): string => `id-${++ids}`;
    const suites = new TestSuitesService(
      projects,
      tests,
      new DatasetRepository(applicationDatabase.connection),
      suitesRepository,
      { createId, now: () => now },
    );
    const suite = suites.save(project.id, undefined, {
      name: "Smoke",
      items: [{ testId: test.id }],
      settings: {
        clearSessionBeforeEach: true,
        continueOnFailure: true,
        maxStepRetries: 2,
      },
    });
    expect(suites.list(project.id)).toEqual([suite]);

    const batches = new BatchRunsService(projects, tests, batchesRepository, {
      createId,
      now: () => now,
    });
    const batch = batches.create({
      projectId: project.id,
      suiteId: suite.id,
      name: suite.name,
      settings: suite.settings,
      items: [{ testId: test.id, testName: test.name }],
    });
    const run: TestRun = {
      id: "run-1",
      projectId: project.id,
      testId: test.id,
      testVersion: 1,
      startedAt: now.toISOString(),
      status: "passed",
      browserType: "chromium",
      pageVersionIds: [],
    };
    new RunRepository(applicationDatabase.connection).create(run);
    batches.updateItem(batch.id, {
      itemId: batch.items[0]!.id,
      status: "flaky",
      runId: run.id,
      retryCount: 1,
    });
    batches.complete(batch.id, "passed", "preserved");
    expect(batches.flakyStatistics(project.id)[0]).toMatchObject({
      testId: test.id,
      totalRuns: 1,
      flakyRuns: 1,
      flakyRate: 1,
    });

    const artifacts = new RunArtifactRepository(applicationDatabase.connection);
    artifacts.create({
      id: "artifact-1",
      runId: run.id,
      kind: "screenshot",
      filePath: "runs/run-1/screenshot.png",
      mimeType: "image/png",
      sizeBytes: 123,
      createdAt: now.toISOString(),
    });
    expect(artifacts.listByRun(run.id)).toHaveLength(1);
  });
});
