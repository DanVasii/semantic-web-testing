import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";

import type {
  ConfirmedTestImport,
  ExportResult,
  PortableDataset,
  PortableDatasetDocument,
  PortableDatasetsDocument,
  PortableTest,
  PortableTestDocument,
  TestImportPreview,
} from "../shared/import-export.js";
import {
  TEST_TRANSFER_SCHEMA_VERSION,
  TRANSFER_SCHEMA_VERSION,
} from "../shared/import-export.js";
import type {
  Page,
  PageVersion,
  Project,
  TestDefinition,
} from "../shared/persistence.js";
import type { TestDataset } from "../shared/test-model.js";
import { stagesForTest } from "../shared/test-stages.js";
import {
  validateDeclarativeTest,
  validateTestDataset,
  type ValidationIssue,
} from "../shared/test-validation.js";
import { hasTestInputErrors, validateTestInput } from "../shared/tests.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { TestsService } from "./tests-service.js";

interface ImportExportServiceOptions {
  artifactRoot: string;
  createId: () => string;
  now: () => Date;
}

interface PendingImport {
  projectId: string;
  document: PortableTestDocument;
}

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const issue = (
  path: string,
  code: ValidationIssue["code"],
  message: string,
): ValidationIssue => ({ path, code, message });

const allowOnly = (
  value: JsonRecord,
  allowed: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      issues.push(
        issue(
          `${path}.${key}`,
          "unknown_property",
          `Câmpul ${key} nu este permis la import.`,
        ),
      );
    }
  }
};

const requireFields = (
  value: JsonRecord,
  fields: readonly string[],
  path: string,
  issues: ValidationIssue[],
): void => {
  for (const field of fields) {
    if (!(field in value)) {
      issues.push(
        issue(
          `${path}.${field}`,
          "missing_property",
          `Câmpul ${field} este obligatoriu.`,
        ),
      );
    }
  }
};

const portableDataset = (
  value: unknown,
  path: string,
  issues: ValidationIssue[],
): PortableDataset | undefined => {
  if (!isRecord(value)) {
    issues.push(
      issue(path, "invalid_type", "Dataset-ul trebuie să fie un obiect."),
    );
    return undefined;
  }
  allowOnly(value, ["name", "values"], path, issues);
  requireFields(value, ["name", "values"], path, issues);
  if (typeof value.name !== "string") {
    issues.push(
      issue(`${path}.name`, "invalid_type", "Numele trebuie să fie text."),
    );
  }
  if (!isRecord(value.values)) {
    issues.push(
      issue(
        `${path}.values`,
        "invalid_type",
        "Valorile dataset-ului trebuie să fie un obiect.",
      ),
    );
  }
  if (typeof value.name !== "string" || !isRecord(value.values)) {
    return undefined;
  }
  return {
    name: value.name,
    values: value.values as PortableDataset["values"],
  };
};

const remapValidationPath = (path: string): string => {
  if (path === "$") return "$.test";
  if (path.startsWith("$.datasets")) return path;
  return `$.test${path.slice(1)}`;
};

const parsePortableTest = (
  value: unknown,
  project: Project,
): { document?: PortableTestDocument; issues: ValidationIssue[] } => {
  const issues: ValidationIssue[] = [];
  if (!isRecord(value)) {
    return {
      issues: [
        issue("$", "invalid_type", "Documentul JSON trebuie să fie un obiect."),
      ],
    };
  }

  allowOnly(value, ["schemaVersion", "kind", "test", "datasets"], "$", issues);
  requireFields(
    value,
    ["schemaVersion", "kind", "test", "datasets"],
    "$",
    issues,
  );
  if (
    value.schemaVersion !== TRANSFER_SCHEMA_VERSION &&
    value.schemaVersion !== TEST_TRANSFER_SCHEMA_VERSION
  ) {
    issues.push(
      issue(
        "$.schemaVersion",
        "invalid_value",
        `Sunt suportate schemaVersion ${TRANSFER_SCHEMA_VERSION} și ${TEST_TRANSFER_SCHEMA_VERSION}.`,
      ),
    );
  }
  if (value.kind !== "semantic-test") {
    issues.push(
      issue(
        "$.kind",
        "invalid_value",
        "Importul acceptă numai documente semantic-test.",
      ),
    );
  }
  if (!isRecord(value.test)) {
    issues.push(
      issue("$.test", "invalid_type", "Testul trebuie să fie un obiect."),
    );
  }
  if (!Array.isArray(value.datasets)) {
    issues.push(
      issue("$.datasets", "invalid_type", "Datasets trebuie să fie o listă."),
    );
  }
  if (!isRecord(value.test) || !Array.isArray(value.datasets)) {
    return { issues };
  }

  allowOnly(
    value.test,
    [
      "name",
      "description",
      "testMode",
      "wipeBeforeRun",
      "startMode",
      "startUrl",
      "flowItems",
      "stages",
    ],
    "$.test",
    issues,
  );
  requireFields(
    value.test,
    ["name", "testMode", "wipeBeforeRun", "startMode", "startUrl", "flowItems"],
    "$.test",
    issues,
  );

  const datasets = value.datasets
    .map((dataset, index) =>
      portableDataset(dataset, `$.datasets[${index}]`, issues),
    )
    .filter((dataset): dataset is PortableDataset => dataset !== undefined);
  const test = value.test;
  if (
    typeof test.name !== "string" ||
    (test.description !== undefined && typeof test.description !== "string") ||
    (test.testMode !== "recorded" && test.testMode !== "dynamic_ai") ||
    typeof test.wipeBeforeRun !== "boolean" ||
    (test.startMode !== "base_url" && test.startMode !== "current_page") ||
    typeof test.startUrl !== "string" ||
    !Array.isArray(test.flowItems) ||
    (test.stages !== undefined && !Array.isArray(test.stages)) ||
    (value.schemaVersion === TEST_TRANSFER_SCHEMA_VERSION &&
      !Array.isArray(test.stages))
  ) {
    issues.push(
      issue(
        "$.test",
        "invalid_type",
        "Câmpurile testului nu au tipurile declarative așteptate.",
      ),
    );
    return { issues };
  }

  const now = "2026-01-01T00:00:00.000Z";
  const validation = validateDeclarativeTest({
    schemaVersion: value.schemaVersion === TEST_TRANSFER_SCHEMA_VERSION ? 2 : 1,
    id: "import-test",
    projectId: project.id,
    name: test.name,
    ...(test.description === undefined
      ? {}
      : { description: test.description }),
    status: test.flowItems.length === 0 ? "draft" : "valid",
    version: 1,
    wipeBeforeRun: test.wipeBeforeRun,
    startMode: test.startMode,
    startUrl: test.startUrl,
    createdAt: now,
    updatedAt: now,
    flowItems: test.flowItems,
    ...(Array.isArray(test.stages) ? { stages: test.stages } : {}),
    datasets: datasets.map((dataset, index) => ({
      id: `import-dataset-${index + 1}`,
      testId: "import-test",
      name: dataset.name,
      values: dataset.values,
      createdAt: now,
      updatedAt: now,
    })),
  });
  if (!validation.valid) {
    issues.push(
      ...validation.issues.map((validationIssue) => ({
        ...validationIssue,
        path: remapValidationPath(validationIssue.path),
      })),
    );
  }
  const inputErrors = validateTestInput(
    {
      name: test.name,
      ...(test.description === undefined
        ? {}
        : { description: test.description }),
      startUrl: test.startUrl,
      testMode: test.testMode,
      wipeBeforeRun: test.wipeBeforeRun,
    },
    project,
  );
  for (const field of [
    "name",
    "description",
    "startUrl",
    "wipeBeforeRun",
    "testMode",
  ] as const) {
    const message = inputErrors[field];
    if (message !== undefined) {
      issues.push(issue(`$.test.${field}`, "invalid_value", message));
    }
  }
  if (hasTestInputErrors(inputErrors) || issues.length > 0) {
    return { issues };
  }

  return {
    document: {
      schemaVersion:
        value.schemaVersion as PortableTestDocument["schemaVersion"],
      kind: "semantic-test",
      test: {
        name: test.name,
        ...(test.description === undefined
          ? {}
          : { description: test.description }),
        testMode: test.testMode,
        wipeBeforeRun: test.wipeBeforeRun,
        startMode: test.startMode,
        startUrl: test.startUrl,
        flowItems: test.flowItems as PortableTest["flowItems"],
        ...(Array.isArray(test.stages)
          ? { stages: test.stages as NonNullable<PortableTest["stages"]> }
          : {}),
      },
      datasets,
    },
    issues: [],
  };
};

const safeSegment = (value: string, fallback: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return normalized.length === 0 ? fallback : normalized;
};

const testDocument = (
  test: TestDefinition,
  datasets: TestDataset[] = [],
): PortableTestDocument => ({
  schemaVersion: TEST_TRANSFER_SCHEMA_VERSION,
  kind: "semantic-test",
  test: {
    name: test.name,
    ...(test.description === undefined
      ? {}
      : { description: test.description }),
    testMode: test.testMode,
    wipeBeforeRun: test.wipeBeforeRun,
    startMode: test.startMode,
    startUrl: test.startUrl,
    flowItems: structuredClone(test.flowItems),
    stages: stagesForTest(test),
  },
  datasets: datasets.map(({ name, values }) => ({
    name,
    values: structuredClone(values),
  })),
});

const datasetDocument = (dataset: TestDataset): PortableDatasetDocument => ({
  schemaVersion: TRANSFER_SCHEMA_VERSION,
  kind: "semantic-dataset",
  dataset: {
    name: dataset.name,
    values: structuredClone(dataset.values),
  },
});

const testSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Semantic test transfer",
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "kind", "test", "datasets"],
  properties: {
    schemaVersion: { const: TEST_TRANSFER_SCHEMA_VERSION },
    kind: { const: "semantic-test" },
    test: {
      type: "object",
      additionalProperties: false,
      required: [
        "name",
        "testMode",
        "wipeBeforeRun",
        "startMode",
        "startUrl",
        "flowItems",
        "stages",
      ],
    },
    datasets: { type: "array" },
  },
};

const datasetSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "Semantic dataset transfer",
  type: "object",
  additionalProperties: false,
  required: ["name", "values"],
  properties: {
    name: { type: "string", minLength: 1, maxLength: 120 },
    values: { type: "object" },
  },
};

export class ImportExportService {
  private readonly pendingImports = new Map<string, PendingImport>();

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly pageRepository: PageRepository,
    private readonly testsService: TestsService,
    private readonly options: ImportExportServiceOptions,
  ) {}

  public async previewImport(
    projectId: string,
    filePath: string,
  ): Promise<TestImportPreview> {
    const project = this.requireProject(projectId);
    let parsed: unknown;
    try {
      parsed = JSON.parse(await readFile(filePath, "utf8"));
    } catch (error) {
      return {
        fileName: basename(filePath),
        valid: false,
        issues: [
          issue(
            "$",
            "invalid_json",
            error instanceof Error
              ? `JSON invalid: ${error.message}`
              : "Fișierul nu este JSON valid.",
          ),
        ],
        datasets: [],
      };
    }
    const result = parsePortableTest(parsed, project);
    if (result.document === undefined) {
      return {
        fileName: basename(filePath),
        valid: false,
        issues: result.issues,
        datasets: [],
      };
    }
    const previewId = this.options.createId();
    this.pendingImports.set(previewId, {
      projectId,
      document: structuredClone(result.document),
    });
    while (this.pendingImports.size > 20) {
      const oldest = this.pendingImports.keys().next().value;
      if (oldest === undefined) break;
      this.pendingImports.delete(oldest);
    }
    return {
      previewId,
      fileName: basename(filePath),
      valid: true,
      issues: [],
      test: {
        name: result.document.test.name,
        ...(result.document.test.description === undefined
          ? {}
          : { description: result.document.test.description }),
        testMode: result.document.test.testMode,
        startUrl: result.document.test.startUrl,
        flowItemCount: result.document.test.flowItems.length,
        ...(result.document.test.stages === undefined
          ? {}
          : { stageCount: result.document.test.stages.length }),
      },
      datasets: result.document.datasets.map((dataset) => ({
        name: dataset.name,
        valueCount: Object.keys(dataset.values).length,
      })),
    };
  }

  public async confirmImport(
    projectId: string,
    previewId: string,
  ): Promise<ConfirmedTestImport> {
    const pending = this.pendingImports.get(previewId);
    if (pending === undefined || pending.projectId !== projectId) {
      throw new Error("Preview-ul importului nu mai este disponibil.");
    }
    const document = structuredClone(pending.document);
    const revalidation = parsePortableTest(
      document,
      this.requireProject(projectId),
    );
    if (revalidation.document === undefined) {
      throw new Error(
        `Importul nu mai este valid: ${revalidation.issues[0]?.path ?? "$"}.`,
      );
    }
    const test = this.testsService.create(projectId, {
      name: document.test.name,
      ...(document.test.description === undefined
        ? {}
        : { description: document.test.description }),
      startUrl: document.test.startUrl,
      testMode: document.test.testMode,
      wipeBeforeRun: document.test.wipeBeforeRun,
    });
    try {
      this.testRepository.update({
        ...test,
        startMode: document.test.startMode,
      });
      const now = this.options.now().toISOString();
      const datasets = document.datasets.map((portable): TestDataset => {
        const dataset: TestDataset = {
          id: this.options.createId(),
          testId: test.id,
          name: portable.name,
          values: structuredClone(portable.values),
          createdAt: now,
          updatedAt: now,
        };
        const validation = validateTestDataset(dataset);
        if (!validation.valid) {
          throw new Error(
            `Dataset invalid la ${validation.issues[0]?.path ?? "$"}.`,
          );
        }
        return this.datasetRepository.create(dataset);
      });
      const imported =
        document.test.stages === undefined
          ? await this.testsService.importFlow(
              projectId,
              test.id,
              document.test.flowItems,
            )
          : await this.testsService.saveStages(
              projectId,
              test.id,
              document.test.stages,
            );
      this.pendingImports.delete(previewId);
      return { test: imported, datasets };
    } catch (error) {
      this.testsService.delete(projectId, test.id);
      throw error;
    }
  }

  public async exportTest(
    projectId: string,
    testId: string,
    filePath: string,
  ): Promise<ExportResult> {
    const test = this.requireTest(projectId, testId);
    await this.writeJson(filePath, testDocument(test));
    return { path: filePath };
  }

  public async exportDataset(
    projectId: string,
    testId: string,
    datasetId: string,
    filePath: string,
  ): Promise<ExportResult> {
    const dataset = this.requireDataset(projectId, testId, datasetId);
    await this.writeJson(filePath, datasetDocument(dataset));
    return { path: filePath };
  }

  public async exportAllDatasets(
    projectId: string,
    testId: string,
    filePath: string,
  ): Promise<ExportResult> {
    const test = this.requireTest(projectId, testId);
    const document: PortableDatasetsDocument = {
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      kind: "semantic-datasets",
      testName: test.name,
      datasets: this.datasetRepository
        .listByTest(testId)
        .map(({ name, values }): PortableDataset => ({
          name,
          values: structuredClone(values),
        })),
    };
    await this.writeJson(filePath, document);
    return { path: filePath };
  }

  public async exportPageAnalysis(
    projectId: string,
    pageId: string,
    filePath: string,
  ): Promise<ExportResult> {
    const { page, version } = this.requirePageVersion(projectId, pageId);
    const analysis = JSON.parse(
      await readFile(
        this.resolveArtifactPath(version.analysisFilePath),
        "utf8",
      ),
    ) as unknown;
    await this.writeJson(filePath, {
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      kind: "semantic-page-analysis",
      page,
      version,
      analysis,
    });
    return { path: filePath };
  }

  public async exportAnalysisBundle(
    projectId: string,
    parentDirectory: string,
  ): Promise<ExportResult> {
    const project = this.requireProject(projectId);
    const stamp = this.options.now().toISOString().replaceAll(/[:.]/g, "-");
    const bundleDirectory = join(
      parentDirectory,
      `analysis-bundle-${safeSegment(project.name, "project")}-${stamp}`,
    );
    await mkdir(bundleDirectory, { recursive: false });
    await this.writeJson(join(bundleDirectory, "project.json"), {
      schemaVersion: TRANSFER_SCHEMA_VERSION,
      id: project.id,
      name: project.name,
      baseUrl: project.baseUrl,
      normalizedBaseUrl: project.normalizedBaseUrl,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
    });

    const pagesDirectory = join(bundleDirectory, "pages");
    for (const page of this.pageRepository.listByProject(projectId)) {
      const version = this.pageRepository.findLatestVersion(page.id);
      if (version === undefined) continue;
      const directory = join(
        pagesDirectory,
        `${safeSegment(page.name, "page")}-${page.id.slice(0, 8)}`,
      );
      await mkdir(directory, { recursive: true });
      await this.writeJson(join(directory, "page.json"), {
        schemaVersion: TRANSFER_SCHEMA_VERSION,
        page,
        version,
      });
      await Promise.all([
        copyFile(
          this.resolveArtifactPath(version.domFilePath),
          join(directory, "dom.html"),
        ),
        copyFile(
          this.resolveArtifactPath(version.cssFilePath),
          join(directory, "styles.css"),
        ),
        copyFile(
          this.resolveArtifactPath(version.accessibilityFilePath),
          join(directory, "accessibility.json"),
        ),
        copyFile(
          this.resolveArtifactPath(version.analysisFilePath),
          join(directory, "analysis.json"),
        ),
        copyFile(
          this.resolveArtifactPath(
            join(dirname(version.analysisFilePath), "semantic-analysis.json"),
          ),
          join(directory, "semantic-analysis.json"),
        ),
      ]);
    }

    const testsDirectory = join(bundleDirectory, "tests");
    const datasetsDirectory = join(testsDirectory, "datasets");
    for (const test of this.testRepository.listByProject(projectId)) {
      const segment = `${safeSegment(test.name, "test")}-${test.id.slice(0, 8)}`;
      await this.writeJson(
        join(testsDirectory, `${segment}.json`),
        testDocument(test),
      );
      for (const dataset of this.datasetRepository.listByTest(test.id)) {
        await this.writeJson(
          join(
            datasetsDirectory,
            segment,
            `${safeSegment(dataset.name, "dataset")}-${dataset.id.slice(0, 8)}.json`,
          ),
          datasetDocument(dataset),
        );
      }
    }
    await this.writeJson(
      join(bundleDirectory, "schema", "test.schema.json"),
      testSchema,
    );
    await this.writeJson(
      join(bundleDirectory, "schema", "dataset.schema.json"),
      datasetSchema,
    );
    return { path: bundleDirectory };
  }

  private async writeJson(filePath: string, value: unknown): Promise<void> {
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  }

  private resolveArtifactPath(portablePath: string): string {
    const root = resolve(this.options.artifactRoot);
    const target = resolve(root, portablePath);
    const fromRoot = relative(root, target);
    if (
      fromRoot.startsWith("..") ||
      fromRoot.length === 0 ||
      /^[A-Za-z]:/.test(fromRoot)
    ) {
      throw new Error("Calea artefactului nu este sigură.");
    }
    return target;
  }

  private requireProject(projectId: string): Project {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) throw new Error("Proiectul nu mai există.");
    return project;
  }

  private requireTest(projectId: string, testId: string): TestDefinition {
    this.requireProject(projectId);
    const test = this.testRepository.findById(testId);
    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu mai există.");
    }
    return test;
  }

  private requireDataset(
    projectId: string,
    testId: string,
    datasetId: string,
  ): TestDataset {
    this.requireTest(projectId, testId);
    const dataset = this.datasetRepository.findById(datasetId);
    if (dataset === undefined || dataset.testId !== testId) {
      throw new Error("Dataset-ul nu mai există.");
    }
    return dataset;
  }

  private requirePageVersion(
    projectId: string,
    pageId: string,
  ): { page: Page; version: PageVersion } {
    this.requireProject(projectId);
    const page = this.pageRepository.findById(pageId);
    if (page === undefined || page.projectId !== projectId) {
      throw new Error("Pagina analizată nu mai există.");
    }
    const version = this.pageRepository.findLatestVersion(pageId);
    if (version === undefined) {
      throw new Error("Pagina nu are nicio analiză exportabilă.");
    }
    return { page, version };
  }
}
