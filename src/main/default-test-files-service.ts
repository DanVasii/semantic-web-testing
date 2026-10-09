import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";

import type {
  AnalyzedForm,
  AnalyzedFormField,
} from "../shared/form-analysis.js";
import { normalizeAnalyzedPageUrl } from "../shared/page-analysis.js";
import type { TestDefinition } from "../shared/persistence.js";
import type {
  ActionStep,
  DatasetValue,
  FileDatasetValue,
  TestDataset,
} from "../shared/test-model.js";
import type { PageAnalysisService } from "./page-analysis/page-analysis-service.js";
import type {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";

export const DEFAULT_TEST_FILE_NAMES = [
  "default-image.png",
  "default-image.jpg",
  "default-image.svg",
  "default-document.pdf",
  "default-document.docx",
  "default-spreadsheet.xlsx",
  "default-data.csv",
  "default-data.json",
  "default-data.xml",
  "default-text.txt",
  "default-archive.zip",
  "default-file.bin",
] as const;

export type DefaultTestFileName = (typeof DEFAULT_TEST_FILE_NAMES)[number];

export interface DefaultTestFileHint {
  accept?: string;
  name?: string;
  label?: string;
}

export interface DefaultTestFilesServiceOptions {
  sourceRoot: string;
  managedRoot: string;
}

const byExtension = new Map<string, DefaultTestFileName>([
  [".png", "default-image.png"],
  [".jpg", "default-image.jpg"],
  [".jpeg", "default-image.jpg"],
  [".svg", "default-image.svg"],
  [".pdf", "default-document.pdf"],
  [".docx", "default-document.docx"],
  [".xlsx", "default-spreadsheet.xlsx"],
  [".csv", "default-data.csv"],
  [".json", "default-data.json"],
  [".xml", "default-data.xml"],
  [".txt", "default-text.txt"],
  [".zip", "default-archive.zip"],
  [".bin", "default-file.bin"],
]);

const byMimeType = new Map<string, DefaultTestFileName>([
  ["image/png", "default-image.png"],
  ["image/jpeg", "default-image.jpg"],
  ["image/jpg", "default-image.jpg"],
  ["image/svg+xml", "default-image.svg"],
  ["application/pdf", "default-document.pdf"],
  [
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "default-document.docx",
  ],
  ["application/msword", "default-document.docx"],
  [
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "default-spreadsheet.xlsx",
  ],
  ["application/vnd.ms-excel", "default-spreadsheet.xlsx"],
  ["text/csv", "default-data.csv"],
  ["application/csv", "default-data.csv"],
  ["application/json", "default-data.json"],
  ["text/json", "default-data.json"],
  ["application/xml", "default-data.xml"],
  ["text/xml", "default-data.xml"],
  ["text/plain", "default-text.txt"],
  ["application/zip", "default-archive.zip"],
  ["application/x-zip-compressed", "default-archive.zip"],
  ["application/octet-stream", "default-file.bin"],
]);

const fileForAcceptToken = (token: string): DefaultTestFileName | undefined => {
  const normalized = token.trim().toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized.length === 0) return undefined;
  if (normalized.startsWith(".")) return byExtension.get(normalized);
  const exact = byMimeType.get(normalized);
  if (exact !== undefined) return exact;
  if (normalized === "image/*") return "default-image.png";
  if (normalized === "text/*") return "default-text.txt";
  return undefined;
};

export const chooseDefaultTestFileName = (
  hint: DefaultTestFileHint,
): DefaultTestFileName => {
  for (const token of hint.accept?.split(",") ?? []) {
    const match = fileForAcceptToken(token);
    if (match !== undefined) return match;
  }

  const semanticHint = `${hint.name ?? ""} ${hint.label ?? ""}`.toLowerCase();
  if (
    /\b(image|photo|picture|avatar|logo|banner|imagine|poz[ăa]|foto)\b/.test(
      semanticHint,
    )
  ) {
    return "default-image.png";
  }
  if (/\b(word|docx)\b/.test(semanticHint)) return "default-document.docx";
  if (/\b(excel|xlsx|spreadsheet|foaie)\b/.test(semanticHint)) {
    return "default-spreadsheet.xlsx";
  }
  if (
    /\b(pdf|document|invoice|contract|resume|cv|factur[ăa])\b/.test(
      semanticHint,
    )
  ) {
    return "default-document.pdf";
  }
  if (/\bcsv\b/.test(semanticHint)) return "default-data.csv";
  if (/\bjson\b/.test(semanticHint)) return "default-data.json";
  if (/\bxml\b/.test(semanticHint)) return "default-data.xml";
  if (/\b(zip|archive|arhiv[ăa])\b/.test(semanticHint)) {
    return "default-archive.zip";
  }
  return "default-text.txt";
};

export class DefaultTestFilesService {
  public constructor(
    private readonly options: DefaultTestFilesServiceOptions,
  ) {}

  public async initialize(): Promise<void> {
    await mkdir(this.options.managedRoot, { recursive: true });
    await Promise.all(
      DEFAULT_TEST_FILE_NAMES.map((name) =>
        copyFile(
          join(this.options.sourceRoot, name),
          join(this.options.managedRoot, name),
        ),
      ),
    );
  }

  public forField(hint: DefaultTestFileHint): FileDatasetValue {
    const name = chooseDefaultTestFileName(hint);
    return {
      type: "file",
      path: join(this.options.managedRoot, name),
      name,
    };
  }
}

interface AnalyzedFileField {
  pageUrl: string;
  field: AnalyzedFormField;
}

interface FileRequirement {
  key: string;
  hint: DefaultTestFileHint;
}

export interface FileInputRepairOptions {
  createId: () => string;
  now: () => Date;
}

export interface FileInputRepairResult {
  test?: TestDefinition;
  datasetsToCreate: TestDataset[];
  datasetsToUpdate: TestDataset[];
  convertedStepCount: number;
  assignedValueCount: number;
}

const locatorKey = (step: ActionStep): string | undefined =>
  step.target === undefined ? undefined : JSON.stringify(step.target.primary);

const normalizedUrl = (value: string): string | undefined => {
  try {
    return normalizeAnalyzedPageUrl(value);
  } catch {
    return undefined;
  }
};

const matchedAnalyzedField = (
  test: TestDefinition,
  step: ActionStep,
  fields: AnalyzedFileField[],
): AnalyzedFormField | undefined => {
  const key = locatorKey(step);
  if (key === undefined) return undefined;
  const candidates = fields.filter(
    ({ field }) => JSON.stringify(field.locator) === key,
  );
  const testUrl = normalizedUrl(test.startUrl);
  return (
    candidates.find(({ pageUrl }) => normalizedUrl(pageUrl) === testUrl)
      ?.field ?? (candidates.length === 1 ? candidates[0]?.field : undefined)
  );
};

const hasUsableLocalFile = (value: DatasetValue | undefined): boolean => {
  if (typeof value === "string") return value.length > 0 && existsSync(value);
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "file" &&
    "path" in value &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    existsSync(value.path)
  );
};

export const repairTestFileInputs = (
  test: TestDefinition,
  datasets: TestDataset[],
  forms: AnalyzedForm[],
  defaultFiles: DefaultTestFilesService,
  options: FileInputRepairOptions,
): FileInputRepairResult => {
  const analyzedFields = forms.flatMap((form) =>
    form.fields
      .filter(({ inputType }) => inputType === "file")
      .map((field) => ({ pageUrl: form.pageUrl, field })),
  );
  let convertedStepCount = 0;
  let testChanged = false;
  const requirements: FileRequirement[] = [];
  const nextFlowItems = test.flowItems.map((item, index) => {
    if (item.type !== "action") return structuredClone(item);
    const matchedField = matchedAnalyzedField(test, item, analyzedFields);
    if (
      item.actionType !== "upload_file" &&
      !(item.actionType === "fill" && matchedField)
    ) {
      return structuredClone(item);
    }

    const key =
      item.valueKey ??
      item.inputFieldId ??
      item.target?.fieldId ??
      `upload_file_${index + 1}`;
    const next = structuredClone(item);
    if (next.actionType !== "upload_file") {
      next.actionType = "upload_file";
      next.title = `Încarcă un fișier în „${matchedField?.label ?? item.title}”.`;
      next.humanDescription = next.title;
      next.whyExplanation =
        "Câmpul a fost recunoscut ca input type=file din analiza paginii.";
      convertedStepCount += 1;
    }
    if (
      next.valueKey !== key ||
      next.inputFieldId !== key ||
      next.valueStrategy !== "dataset"
    ) {
      next.valueKey = key;
      next.inputFieldId = key;
      next.valueStrategy = "dataset";
    }
    if (JSON.stringify(next) !== JSON.stringify(item)) testChanged = true;
    requirements.push({
      key,
      hint:
        matchedField ??
        ({
          name: `${item.inputFieldId ?? ""} ${item.valueKey ?? ""}`,
          label: `${item.title} ${item.humanDescription}`,
        } satisfies DefaultTestFileHint),
    });
    return next;
  });

  if (requirements.length === 0) {
    return {
      datasetsToCreate: [],
      datasetsToUpdate: [],
      convertedStepCount: 0,
      assignedValueCount: 0,
    };
  }

  const timestamp = options.now().toISOString();
  let assignedValueCount = 0;
  const applyRequirements = (dataset: TestDataset): TestDataset | undefined => {
    const values = structuredClone(dataset.values);
    let changed = false;
    for (const requirement of requirements) {
      if (hasUsableLocalFile(values[requirement.key])) continue;
      values[requirement.key] = defaultFiles.forField(requirement.hint);
      changed = true;
      assignedValueCount += 1;
    }
    return changed ? { ...dataset, values, updatedAt: timestamp } : undefined;
  };

  const datasetsToUpdate = datasets
    .map(applyRequirements)
    .filter((dataset): dataset is TestDataset => dataset !== undefined);
  const datasetsToCreate =
    datasets.length > 0
      ? []
      : [
          {
            id: options.createId(),
            testId: test.id,
            name: "Fișiere implicite",
            values: Object.fromEntries(
              requirements.map(({ key, hint }) => [
                key,
                defaultFiles.forField(hint),
              ]),
            ),
            createdAt: timestamp,
            updatedAt: timestamp,
          },
        ];
  if (datasetsToCreate.length > 0) assignedValueCount += requirements.length;

  return {
    ...(testChanged
      ? { test: { ...test, flowItems: nextFlowItems, updatedAt: timestamp } }
      : {}),
    datasetsToCreate,
    datasetsToUpdate,
    convertedStepCount,
    assignedValueCount,
  };
};

export interface ExistingFileInputsMigrationResult {
  updatedTests: number;
  updatedDatasets: number;
  createdDatasets: number;
  convertedSteps: number;
  assignedValues: number;
}

export class ExistingFileInputsMigrationService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly pages: PageRepository,
    private readonly tests: TestRepository,
    private readonly datasets: DatasetRepository,
    private readonly pageAnalysis: PageAnalysisService,
    private readonly defaultFiles: DefaultTestFilesService,
    private readonly options: FileInputRepairOptions,
  ) {}

  public async migrate(): Promise<ExistingFileInputsMigrationResult> {
    const result: ExistingFileInputsMigrationResult = {
      updatedTests: 0,
      updatedDatasets: 0,
      createdDatasets: 0,
      convertedSteps: 0,
      assignedValues: 0,
    };
    for (const project of this.projects.list()) {
      const forms: AnalyzedForm[] = [];
      for (const page of this.pages.listByProject(project.id)) {
        try {
          forms.push(
            ...(await this.pageAnalysis.listForms(project.id, page.id)),
          );
        } catch {
          // A damaged/old page artifact must not block application startup.
        }
      }
      for (const test of this.tests.listByProject(project.id)) {
        const repair = repairTestFileInputs(
          test,
          this.datasets.listByTest(test.id),
          forms,
          this.defaultFiles,
          this.options,
        );
        if (repair.test !== undefined) {
          this.tests.update(repair.test);
          result.updatedTests += 1;
        }
        for (const dataset of repair.datasetsToUpdate) {
          this.datasets.update(dataset);
          result.updatedDatasets += 1;
        }
        for (const dataset of repair.datasetsToCreate) {
          this.datasets.create(dataset);
          result.createdDatasets += 1;
        }
        result.convertedSteps += repair.convertedStepCount;
        result.assignedValues += repair.assignedValueCount;
      }
    }
    return result;
  }
}

export const fileExtensionForDefault = (name: DefaultTestFileName): string =>
  extname(name);
