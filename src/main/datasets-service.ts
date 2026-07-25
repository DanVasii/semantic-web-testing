import type {
  CreateDatasetInput,
  DatasetPreview,
  PreviewDatasetValueInput,
  SaveDatasetInput,
} from "../shared/datasets.js";
import type { TestDataset } from "../shared/test-model.js";
import { validateTestDataset } from "../shared/test-validation.js";
import {
  DatasetRepository,
  ProjectRepository,
  TestRepository,
} from "./persistence/repositories.js";
import { materializeDatasetValue } from "./runner/dataset-values.js";

export interface DatasetsServiceOptions {
  createId: () => string;
  now: () => Date;
  random: () => number;
}

const copyName = (name: string, existingNames: Set<string>): string => {
  const firstCopy = `${name} (copie)`;
  if (!existingNames.has(firstCopy)) {
    return firstCopy;
  }

  let index = 2;
  while (existingNames.has(`${name} (copie ${index})`)) {
    index += 1;
  }
  return `${name} (copie ${index})`;
};

export class DatasetsService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly options: DatasetsServiceOptions,
  ) {}

  public list(projectId: string, testId: string): TestDataset[] {
    this.requireTest(projectId, testId);
    return this.datasetRepository.listByTest(testId);
  }

  public create(
    projectId: string,
    testId: string,
    input: CreateDatasetInput,
  ): TestDataset {
    this.requireTest(projectId, testId);
    const timestamp = this.options.now().toISOString();
    const dataset: TestDataset = {
      id: this.options.createId(),
      testId,
      name: input.name.trim(),
      values: {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.assertValid(dataset);
    return this.datasetRepository.create(dataset);
  }

  public duplicate(
    projectId: string,
    testId: string,
    datasetId: string,
  ): TestDataset {
    const source = this.requireDataset(projectId, testId, datasetId);
    const timestamp = this.options.now().toISOString();
    const names = new Set(
      this.datasetRepository.listByTest(testId).map(({ name }) => name),
    );
    const duplicate: TestDataset = {
      id: this.options.createId(),
      testId,
      name: copyName(source.name, names),
      values: structuredClone(source.values),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.assertValid(duplicate);
    return this.datasetRepository.create(duplicate);
  }

  public save(
    projectId: string,
    testId: string,
    datasetId: string,
    input: SaveDatasetInput,
  ): TestDataset {
    const existing = this.requireDataset(projectId, testId, datasetId);
    const updated: TestDataset = {
      ...existing,
      name: input.name.trim(),
      values: structuredClone(input.values),
      updatedAt: this.options.now().toISOString(),
    };
    this.assertValid(updated);
    return this.datasetRepository.update(updated);
  }

  public delete(projectId: string, testId: string, datasetId: string): boolean {
    this.requireDataset(projectId, testId, datasetId);
    return this.datasetRepository.delete(datasetId);
  }

  public preview(
    projectId: string,
    testId: string,
    input: PreviewDatasetValueInput,
  ): DatasetPreview {
    this.requireTest(projectId, testId);
    const timestamp = this.options.now().toISOString();
    const candidate: TestDataset = {
      id: "dataset-preview",
      testId,
      name: "Preview",
      values: { preview_value: input.value },
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    this.assertValid(candidate);
    return materializeDatasetValue(input.value, this.options);
  }

  private assertValid(dataset: TestDataset): void {
    const validation = validateTestDataset(dataset);
    if (!validation.valid) {
      const issue = validation.issues[0];
      throw new Error(
        `Dataset invalid la ${issue?.path ?? "$"}: ${issue?.message ?? "eroare necunoscută"}`,
      );
    }
  }

  private requireTest(projectId: string, testId: string): void {
    if (this.projectRepository.findById(projectId) === undefined) {
      throw new Error("Proiectul nu mai există.");
    }
    const test = this.testRepository.findById(testId);
    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu mai există.");
    }
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
}
