import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { PortableTestDocument } from "../shared/import-export.js";
import type { Page, PageVersion, Project } from "../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { TestsService } from "./tests-service.js";
import { ImportExportService } from "./import-export-service.js";

const project: Project = {
  id: "project-1",
  name: "Clinică demo",
  baseUrl: "https://clinic.example.test",
  normalizedBaseUrl: "https://clinic.example.test/",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: { apiKey: "SECRET-GEMINI" },
  mysqlConfig: { password: "SECRET-MYSQL" },
  shortcutConfig: {},
};

const portableDocument = (): PortableTestDocument => ({
  schemaVersion: 1,
  kind: "semantic-test",
  test: {
    name: "Programare tratament",
    description: "Selectează un tratament și continuă.",
    testMode: "recorded",
    wipeBeforeRun: false,
    startMode: "base_url",
    startUrl: "https://clinic.example.test/booking",
    flowItems: [
      {
        id: "click-treatment",
        type: "action",
        actionType: "click",
        title: "Alege tratamentul",
        humanDescription: "Apasă Teen Skin Ritual.",
        whyExplanation: "Tratamentul trebuie selectat.",
        target: {
          primary: {
            type: "text",
            operator: "equals",
            value: "TEEN SKIN RITUAL",
          },
        },
        fallbacks: [],
        enabled: true,
      },
    ],
  },
  datasets: [
    {
      name: "Client demo",
      values: { customer_email: "client@example.test" },
    },
  ],
});

describe("ImportExportService", () => {
  let root = "";
  let database: ApplicationDatabase;
  let projects: ProjectRepository;
  let tests: TestRepository;
  let datasets: DatasetRepository;
  let pages: PageRepository;
  let service: ImportExportService;
  let sequence = 0;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "semantic-transfer-"));
    database = await openApplicationDatabase({
      filePath: join(root, "application.sqlite"),
    });
    projects = new ProjectRepository(database.connection);
    tests = new TestRepository(database.connection);
    datasets = new DatasetRepository(database.connection);
    pages = new PageRepository(database.connection);
    projects.create(project);
    const createId = (): string => `generated-${++sequence}`;
    const testsService = new TestsService(projects, tests, datasets, {
      createId,
      now: () => new Date("2026-07-25T12:00:00.000Z"),
      snapshotRoot: join(root, "test-versions"),
    });
    service = new ImportExportService(
      projects,
      tests,
      datasets,
      pages,
      testsService,
      {
        artifactRoot: join(root, "artifacts"),
        createId,
        now: () => new Date("2026-07-25T12:00:00.000Z"),
      },
    );
  });

  afterEach(() => {
    database.close();
    rmSync(root, { recursive: true, force: true });
  });

  it("previews without side effects and creates the test only after confirmation", async () => {
    const filePath = join(root, "import.json");
    writeFileSync(filePath, JSON.stringify(portableDocument()), "utf8");

    const preview = await service.previewImport(project.id, filePath);
    expect(preview).toMatchObject({
      valid: true,
      test: { name: "Programare tratament", flowItemCount: 1 },
      datasets: [{ name: "Client demo", valueCount: 1 }],
    });
    expect(tests.listByProject(project.id)).toHaveLength(0);

    const imported = await service.confirmImport(
      project.id,
      preview.previewId ?? "",
    );
    expect(imported.test).toMatchObject({
      projectId: project.id,
      name: "Programare tratament",
      status: "valid",
      workflowState: "ready",
      flowItems: [{ id: "click-treatment" }],
    });
    expect(imported.datasets).toHaveLength(1);
    expect(tests.listVersions(imported.test.id)[0]).toMatchObject({
      source: "import",
    });
    expect(projects.findById(project.id)).toEqual(project);
  });

  it("reports invalid JSON and forbidden project or connection fields by path", async () => {
    const invalidPath = join(root, "broken.json");
    writeFileSync(invalidPath, "{ invalid", "utf8");
    const invalid = await service.previewImport(project.id, invalidPath);
    expect(invalid).toMatchObject({
      valid: false,
      issues: [{ path: "$", code: "invalid_json" }],
    });

    const forbiddenPath = join(root, "forbidden.json");
    writeFileSync(
      forbiddenPath,
      JSON.stringify({
        ...portableDocument(),
        projectId: "other-project",
        mysqlConfig: { host: "db", password: "secret" },
      }),
      "utf8",
    );
    const forbidden = await service.previewImport(project.id, forbiddenPath);
    expect(forbidden.valid).toBe(false);
    expect(forbidden.issues.map(({ path }) => path)).toEqual(
      expect.arrayContaining(["$.projectId", "$.mysqlConfig"]),
    );
    expect(tests.listByProject(project.id)).toHaveLength(0);
  });

  it("exports a reimportable test and a credential-free analysis bundle", async () => {
    const importPath = join(root, "source.json");
    writeFileSync(importPath, JSON.stringify(portableDocument()), "utf8");
    const preview = await service.previewImport(project.id, importPath);
    const imported = await service.confirmImport(
      project.id,
      preview.previewId ?? "",
    );

    const page: Page = {
      id: "page-1",
      projectId: project.id,
      name: "Booking",
      url: "https://clinic.example.test/booking",
      normalizedUrl: "https://clinic.example.test/booking",
      createdAt: "2026-07-25T10:00:00.000Z",
      updatedAt: "2026-07-25T10:00:00.000Z",
    };
    const artifactDirectory = join(
      root,
      "artifacts",
      "projects",
      project.id,
      "pages",
      page.id,
      "v1",
    );
    mkdirSync(artifactDirectory, { recursive: true });
    for (const [fileName, contents] of [
      ["dom.html", "<html><body>Booking</body></html>"],
      ["styles.css", "body { color: black; }"],
      ["accessibility.json", '{"schemaVersion":1}'],
      ["analysis.json", '{"schemaVersion":2,"title":"Booking"}'],
      ["semantic-analysis.json", '{"schemaVersion":1,"elements":[]}'],
    ] as const) {
      writeFileSync(join(artifactDirectory, fileName), contents, "utf8");
    }
    pages.create(page);
    const version: PageVersion = {
      id: "page-version-1",
      pageId: page.id,
      versionNumber: 1,
      createdAt: "2026-07-25T10:00:00.000Z",
      normalizedUrl: page.normalizedUrl,
      domFilePath: `projects/${project.id}/pages/${page.id}/v1/dom.html`,
      cssFilePath: `projects/${project.id}/pages/${page.id}/v1/styles.css`,
      accessibilityFilePath: `projects/${project.id}/pages/${page.id}/v1/accessibility.json`,
      analysisFilePath: `projects/${project.id}/pages/${page.id}/v1/analysis.json`,
      semanticHash: "hash",
    };
    pages.createVersion(version);

    const testExportPath = join(root, "test-export.json");
    await service.exportTest(project.id, imported.test.id, testExportPath);
    const reimportPreview = await service.previewImport(
      project.id,
      testExportPath,
    );
    expect(reimportPreview.valid).toBe(true);

    const exportDirectory = join(root, "exports");
    mkdirSync(exportDirectory, { recursive: true });
    const bundle = await service.exportAnalysisBundle(
      project.id,
      exportDirectory,
    );
    expect(existsSync(join(bundle.path, "project.json"))).toBe(true);
    expect(existsSync(join(bundle.path, "schema", "test.schema.json"))).toBe(
      true,
    );
    const projectExport = readFileSync(
      join(bundle.path, "project.json"),
      "utf8",
    );
    expect(projectExport).not.toContain("SECRET-GEMINI");
    expect(projectExport).not.toContain("SECRET-MYSQL");
    expect(projectExport).not.toContain("browserConfig");
    expect(readFileSync(testExportPath, "utf8")).toContain(
      '"schemaVersion": 2',
    );
  });
});
