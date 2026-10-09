import type {
  DatasetPrimitive,
  DatasetValue,
  FileDatasetValue,
  TestDataset,
} from "./test-model.js";

export interface CreateDatasetInput {
  name: string;
}

export interface SaveDatasetInput {
  name: string;
  values: Record<string, DatasetValue>;
}

export interface PreviewDatasetValueInput {
  value: DatasetValue;
}

export type DatasetPreview = DatasetPrimitive;

export type DatasetFileSelection = FileDatasetValue;

export interface DatasetCrudApi {
  selectDatasetFile?: (
    projectId: string,
    testId: string,
  ) => Promise<DatasetFileSelection | undefined>;
  listDatasets: (projectId: string, testId: string) => Promise<TestDataset[]>;
  createDataset: (
    projectId: string,
    testId: string,
    input: CreateDatasetInput,
  ) => Promise<TestDataset>;
  duplicateDataset: (
    projectId: string,
    testId: string,
    datasetId: string,
  ) => Promise<TestDataset>;
  saveDataset: (
    projectId: string,
    testId: string,
    datasetId: string,
    input: SaveDatasetInput,
  ) => Promise<TestDataset>;
  deleteDataset: (
    projectId: string,
    testId: string,
    datasetId: string,
  ) => Promise<boolean>;
  previewDatasetValue: (
    projectId: string,
    testId: string,
    input: PreviewDatasetValueInput,
  ) => Promise<DatasetPreview>;
}
