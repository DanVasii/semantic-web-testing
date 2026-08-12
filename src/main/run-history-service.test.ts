import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type {
  Project,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  MySqlRunDataRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { RunHistoryService } from "./run-history-service.js";

const project: Project = {
  id: "project-1",
  name: "Fixture",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-27T10:00:00.000Z",
  updatedAt: "2026-07-27T10:00:00.000Z",
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
  startUrl: project.baseUrl,
  normalizedStartUrl: project.normalizedBaseUrl,
  workflowState: "ready",
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  flowItems: [],
};
const run = (id: string, status: TestRun["status"]): TestRun => ({
  id,
  projectId: project.id,
  testId: test.id,
  testVersion: 1,
  startedAt: "2026-07-27T10:00:00.000Z",
  endedAt: "2026-07-27T10:00:02.500Z",
  status,
  browserType: "chromium",
  pageVersionIds: ["page-version-1"],
  datasetSnapshot: {
    id: "dataset-1",
    name: "Client",
    values: { email: "ana@example.test" },
  },
});

let directory: string;
let database: ApplicationDatabase;
let runs: RunRepository;
let service: RunHistoryService;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-run-history-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  const projects = new ProjectRepository(database.connection);
  const tests = new TestRepository(database.connection);
  const datasets = new DatasetRepository(database.connection);
  runs = new RunRepository(database.connection);
  projects.create(project);
  tests.create(test);
  service = new RunHistoryService(
    projects,
    tests,
    datasets,
    runs,
    new MySqlRunDataRepository(database.connection),
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("RunHistoryService", () => {
  it("lists and filters cross-test history with aggregate counts", () => {
    runs.create(run("run-passed", "passed"));
    runs.create(run("run-failed", "failed"));
    runs.createStepResult({
      id: "step-result-1",
      runId: "run-failed",
      stepId: "click-submit",
      status: "failed",
      error: { code: "locator_not_found" },
      logs: [{ message: "Nu a fost găsit." }],
    });

    expect(service.list(project.id)).toHaveLength(2);
    expect(service.list(project.id, { statuses: ["failed"] })[0]).toMatchObject(
      {
        testName: "Checkout",
        durationMs: 2500,
        failedStepCount: 1,
      },
    );
  });

  it("returns run details with the effective dataset and IMAP result", () => {
    runs.create({
      ...run("run-details", "passed"),
      postRunResult: { ai: { status: "passed" } },
    });
    runs.createStepResult({
      id: "imap-result",
      runId: "run-details",
      stepId: "post-run:imap:test-1:1",
      status: "passed",
      logs: [{ message: "Mesaj găsit." }],
    });

    expect(service.details(project.id, "run-details")).toMatchObject({
      dataset: {
        id: "dataset-1",
        name: "Client",
        values: { email: "ana@example.test" },
      },
      imapResults: [{ status: "passed" }],
      postRunResult: { ai: { status: "passed" } },
    });
  });

  it("deletes selected runs and purges logs separately", () => {
    runs.create(run("run-1", "passed"));
    runs.create(run("run-2", "failed"));
    runs.createStepResult({
      id: "step-result",
      runId: "run-2",
      stepId: "step-1",
      status: "failed",
      logs: [{ message: "Detaliu tehnic" }],
    });

    expect(service.storage(project.id).logsBytes).toBeGreaterThan(0);
    expect(service.purge(project.id, "logs").affected).toBe(1);
    expect(service.storage(project.id).logsBytes).toBe(2);
    expect(service.delete(project.id, ["run-1"]).affected).toBe(1);
    expect(service.list(project.id).map(({ run }) => run.id)).toEqual([
      "run-2",
    ]);
    expect(service.deleteAll(project.id).affected).toBe(1);
  });
});
