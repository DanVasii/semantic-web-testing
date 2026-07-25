import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Project, TestDefinition } from "../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { DatasetsService } from "./datasets-service.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
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
  status: "draft",
  version: 1,
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/checkout",
  normalizedStartUrl: "https://example.test/checkout",
  workflowState: "not_recorded",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  flowItems: [],
};

let directory: string;
let database: ApplicationDatabase;
let service: DatasetsService;
let id = 0;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-datasets-service-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  const projects = new ProjectRepository(database.connection);
  const tests = new TestRepository(database.connection);
  const datasets = new DatasetRepository(database.connection);
  projects.create(project);
  tests.create(test);
  id = 0;
  service = new DatasetsService(projects, tests, datasets, {
    createId: () => `generated-${++id}`,
    now: () => new Date("2026-07-25T12:34:56.000Z"),
    random: () => 0.5,
  });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("DatasetsService", () => {
  it("creates, renames, edits, duplicates and deletes datasets per test", () => {
    const created = service.create(project.id, test.id, {
      name: " Client standard ",
    });
    expect(created).toMatchObject({
      id: "generated-1",
      testId: test.id,
      name: "Client standard",
      values: {},
    });

    const saved = service.save(project.id, test.id, created.id, {
      name: "Client valid",
      values: {
        customer_email: {
          type: "generated",
          strategy: "unique_email",
          template: "qa+{{timestamp}}@example.test",
        },
        retries: { type: "fixed", value: 2 },
      },
    });
    expect(saved.name).toBe("Client valid");
    expect(service.list(project.id, test.id)).toEqual([saved]);

    const duplicate = service.duplicate(project.id, test.id, created.id);
    expect(duplicate).toMatchObject({
      id: "generated-2",
      name: "Client valid (copie)",
      values: saved.values,
    });
    expect(duplicate.values).not.toBe(saved.values);

    expect(service.delete(project.id, test.id, created.id)).toBe(true);
    expect(service.list(project.id, test.id)).toEqual([duplicate]);
  });

  it("rejects invalid values and cross-test access", () => {
    const created = service.create(project.id, test.id, { name: "Valid" });
    expect(() =>
      service.save(project.id, test.id, created.id, {
        name: "Invalid",
        values: {
          InvalidField: {
            type: "generated",
            strategy: "random_number",
            min: 10,
            max: 1,
          },
        },
      }),
    ).toThrow("Dataset invalid");
    expect(() => service.list(project.id, "another-test")).toThrow(
      "Testul nu mai există",
    );
  });

  it("previews generated values with injected clock, random and ID", () => {
    expect(
      service.preview(project.id, test.id, {
        value: {
          type: "generated",
          strategy: "random_number",
          min: 10,
          max: 20,
        },
      }),
    ).toBe(15);
    expect(
      service.preview(project.id, test.id, {
        value: {
          type: "generated",
          strategy: "unique_email",
          template: "qa+{{timestamp}}-{{uuid}}@example.test",
        },
      }),
    ).toBe("qa+1784982896000-generated-1@example.test");
  });
});
