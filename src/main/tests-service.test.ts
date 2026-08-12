import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../shared/persistence.js";
import type { TestFlowItem } from "../shared/test-model.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { TestsService } from "./tests-service.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

let directory: string;
let database: ApplicationDatabase;
let projectRepository: ProjectRepository;
let testRepository: TestRepository;
let datasetRepository: DatasetRepository;
let service: TestsService;
let idCounter: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-tests-service-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  projectRepository = new ProjectRepository(database.connection);
  testRepository = new TestRepository(database.connection);
  datasetRepository = new DatasetRepository(database.connection);
  projectRepository.create(project);
  idCounter = 0;
  service = new TestsService(
    projectRepository,
    testRepository,
    datasetRepository,
    {
      createId: () => {
        idCounter += 1;
        return idCounter === 1 ? "test-1" : `generated-${idCounter}`;
      },
      now: () => new Date("2026-07-24T12:00:00.000Z"),
      snapshotRoot: join(directory, "versions"),
    },
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("TestsService", () => {
  it("creates an unrecorded test with its own start URL", () => {
    const created = service.create(project.id, {
      name: " Cumpără produs ",
      description: " Produse până la checkout ",
      startUrl: "https://example.test/products?category=10#list",
      wipeBeforeRun: true,
    });

    expect(created).toMatchObject({
      id: "test-1",
      projectId: project.id,
      name: "Cumpără produs",
      description: "Produse până la checkout",
      startUrl: "https://example.test/products?category=10#list",
      normalizedStartUrl: "https://example.test/products?category=10#list",
      testMode: "recorded",
      wipeBeforeRun: true,
      workflowState: "not_recorded",
      flowItems: [],
    });
    expect(service.list(project.id)).toEqual([created]);
    expect(service.get(project.id, created.id)).toEqual(created);
    expect(projectRepository.getStatistics(project.id).testCount).toBe(1);
  });

  it("rejects start URLs outside the project site", () => {
    expect(() =>
      service.create(project.id, {
        name: "Test extern",
        startUrl: "https://other.test",
      }),
    ).toThrow("Datele testului nu sunt valide.");
  });

  it("persists the dynamic AI test type selected by the user", () => {
    const created = service.create(project.id, {
      name: "Calendar dinamic",
      startUrl: "https://example.test/booking",
      testMode: "dynamic_ai",
    });

    expect(created.testMode).toBe("dynamic_ai");
    expect(service.get(project.id, created.id).testMode).toBe("dynamic_ai");
  });

  it("invalidates a recorded flow when the start URL changes", () => {
    const created = service.create(project.id, {
      name: "Checkout",
      startUrl: "https://example.test/products",
    });
    testRepository.update({
      ...created,
      status: "valid",
      workflowState: "ready",
      flowItems: [
        {
          id: "step-1",
          type: "action",
          actionType: "click",
          title: "Deschide checkout",
          humanDescription: "Apasă butonul de checkout.",
          whyExplanation: "Butonul continuă scenariul de cumpărare.",
          target: {
            primary: {
              type: "css",
              operator: "equals",
              value: "#checkout",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    });

    const updated = service.update(project.id, created.id, {
      name: "Checkout rapid",
      startUrl: "https://example.test/cart?coupon=10#summary",
      wipeBeforeRun: true,
    });

    expect(updated).toMatchObject({
      name: "Checkout rapid",
      normalizedStartUrl: "https://example.test/cart?coupon=10#summary",
      status: "draft",
      workflowState: "not_recorded",
      flowItems: [],
      wipeBeforeRun: true,
      version: 2,
    });
  });

  it("deletes only tests belonging to the requested project", () => {
    const created = service.create(project.id, {
      name: "Temporar",
      startUrl: project.normalizedBaseUrl,
    });

    expect(service.delete(project.id, created.id)).toBe(true);
    expect(service.list(project.id)).toEqual([]);
  });

  it("saves a validated flow, creates a version and writes its snapshot", async () => {
    const created = service.create(project.id, {
      name: "Checkout",
      startUrl: "https://example.test/products",
    });
    const flowItems = [
      {
        id: "step-1",
        type: "action" as const,
        actionType: "click" as const,
        title: "Deschide checkout",
        humanDescription: "Apasă butonul de checkout.",
        whyExplanation: "Continuă flow-ul de cumpărare.",
        target: {
          primary: {
            type: "css" as const,
            operator: "equals" as const,
            value: "#checkout",
          },
        },
        fallbacks: [],
        enabled: true,
      },
    ];

    const saved = await service.saveFlow(project.id, created.id, flowItems);

    expect(saved).toMatchObject({
      version: 2,
      status: "valid",
      workflowState: "ready",
      flowItems,
    });
    const versions = service.listVersions(project.id, created.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]).toMatchObject({
      versionNumber: 2,
      source: "manual",
      snapshotFilePath: "projects/project-1/tests/test-1/v2/test.json",
    });
    const snapshotPath = join(
      directory,
      "versions",
      versions[0]?.snapshotFilePath ?? "",
    );
    expect(existsSync(snapshotPath)).toBe(true);
    expect(JSON.parse(readFileSync(snapshotPath, "utf8"))).toMatchObject({
      schemaVersion: 1,
      version: 2,
      flowItems,
      datasets: [],
    });
  });

  it("rejects an invalid flow without creating a version", async () => {
    const created = service.create(project.id, {
      name: "Checkout",
      startUrl: "https://example.test/products",
    });

    await expect(
      service.saveFlow(project.id, created.id, [
        {
          id: "step-1",
          type: "action",
          actionType: "click",
          title: "",
          humanDescription: "",
          whyExplanation: "",
          fallbacks: [],
          enabled: true,
        },
      ]),
    ).rejects.toThrow("Flow-ul testului nu este valid");
    expect(service.get(project.id, created.id)).toEqual(created);
    expect(service.listVersions(project.id, created.id)).toEqual([]);
  });

  it("creates an AI version and restores the prior snapshot with Undo AI", async () => {
    const created = service.create(project.id, {
      name: "Calendar",
      startUrl: "https://example.test/booking",
    });
    const originalStep: TestFlowItem = {
      id: "step-1",
      type: "action",
      actionType: "click",
      title: "Alege ziua",
      humanDescription: "Apasă ziua disponibilă.",
      whyExplanation: "Selectează data programării.",
      target: {
        primary: {
          type: "data_attribute",
          operator: "equals",
          value: "calendar-day-15",
          attribute: "data-testid",
        },
      },
      fallbacks: [],
      enabled: true,
    };
    const originalFlow = [originalStep];
    const manual = await service.saveFlow(project.id, created.id, originalFlow);
    const ai = await service.saveAiFlow(project.id, created.id, [
      {
        ...originalStep,
        title: "Alege ziua 15 din calendar",
      },
    ]);

    expect(ai.version).toBe(manual.version + 1);
    expect(service.listVersions(project.id, created.id)[0]).toMatchObject({
      versionNumber: ai.version,
      source: "ai",
    });

    const restored = await service.undoAiFlow(
      project.id,
      created.id,
      ai.version,
    );

    expect(restored.version).toBe(ai.version + 1);
    expect(restored.flowItems).toEqual(originalFlow);
    expect(service.listVersions(project.id, created.id)[0]).toMatchObject({
      versionNumber: restored.version,
      source: "manual",
    });
  });

  it("revalidates an invalidated test without changing its flow version", () => {
    const created = service.create(project.id, {
      name: "Checkout",
      startUrl: "https://example.test/products",
    });
    testRepository.update({
      ...created,
      status: "invalidated",
      workflowState: "ready",
      invalidation: {
        pageId: "page-1",
        pageVersionId: "page-version-2",
        detectedAt: "2026-07-27T10:00:00.000Z",
        score: 0.45,
        threshold: 0.3,
      },
    });

    const revalidated = service.revalidate(project.id, created.id);

    expect(revalidated.status).toBe("valid");
    expect(revalidated.invalidation).toBeUndefined();
    expect(revalidated.version).toBe(created.version);
    expect(testRepository.findById(created.id)).toEqual(revalidated);
  });
});
