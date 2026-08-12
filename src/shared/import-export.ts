import type { TestDefinition } from "./persistence.js";
import type { DatasetValue, TestDataset, TestFlowItem } from "./test-model.js";
import type { ValidationIssue } from "./test-validation.js";

export const TRANSFER_SCHEMA_VERSION = 1 as const;

export interface PortableDataset {
  name: string;
  values: Record<string, DatasetValue>;
}

export interface PortableTest {
  name: string;
  description?: string;
  testMode: "recorded" | "dynamic_ai";
  wipeBeforeRun: boolean;
  startMode: "base_url" | "current_page";
  startUrl: string;
  flowItems: TestFlowItem[];
}

export interface PortableTestDocument {
  schemaVersion: typeof TRANSFER_SCHEMA_VERSION;
  kind: "semantic-test";
  test: PortableTest;
  datasets: PortableDataset[];
}

export interface PortableDatasetDocument {
  schemaVersion: typeof TRANSFER_SCHEMA_VERSION;
  kind: "semantic-dataset";
  dataset: PortableDataset;
}

export interface PortableDatasetsDocument {
  schemaVersion: typeof TRANSFER_SCHEMA_VERSION;
  kind: "semantic-datasets";
  testName: string;
  datasets: PortableDataset[];
}

export interface TestImportPreview {
  previewId?: string;
  fileName: string;
  valid: boolean;
  issues: ValidationIssue[];
  test?: {
    name: string;
    description?: string;
    testMode: PortableTest["testMode"];
    startUrl: string;
    flowItemCount: number;
  };
  datasets: {
    name: string;
    valueCount: number;
  }[];
}

export interface ConfirmedTestImport {
  test: TestDefinition;
  datasets: TestDataset[];
}

export interface ExportResult {
  path: string;
}
