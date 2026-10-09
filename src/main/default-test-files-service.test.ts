import { mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalyzedForm } from "../shared/form-analysis.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { TestDataset } from "../shared/test-model.js";
import {
  chooseDefaultTestFileName,
  DEFAULT_TEST_FILE_NAMES,
  DefaultTestFilesService,
  repairTestFileInputs,
} from "./default-test-files-service.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

const testDefinition = (
  actionType: "fill" | "upload_file",
): TestDefinition => ({
  id: "test-1",
  projectId: "project-1",
  name: "Upload avatar",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/profile",
  normalizedStartUrl: "https://example.test/profile",
  workflowState: "ready",
  createdAt: "2026-09-03T08:00:00.000Z",
  updatedAt: "2026-09-03T08:00:00.000Z",
  flowItems: [
    {
      id: "step-1",
      type: "action",
      actionType,
      title: "Completează avatar",
      humanDescription: "Completează câmpul avatar.",
      whyExplanation: "Pas existent.",
      target: {
        primary: { type: "css", operator: "equals", value: "#avatar" },
      },
      inputFieldId: "avatar_file",
      valueKey: "avatar_file",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    },
  ],
});

const form: AnalyzedForm = {
  id: "form-profile",
  pageId: "page-1",
  pageVersionId: "page-version-1",
  pageTitle: "Profil",
  pageUrl: "https://example.test/profile",
  title: "Profil",
  method: "post",
  action: "/profile",
  locator: { type: "css", operator: "equals", value: "#profile" },
  fields: [
    {
      id: "field-avatar",
      name: "avatar",
      label: "Imagine profil",
      tag: "input",
      inputType: "file",
      semanticType: "unknown",
      required: true,
      disabled: false,
      locator: { type: "css", operator: "equals", value: "#avatar" },
      accept: "image/jpeg",
      options: [],
    },
  ],
};

const service = (root: string): DefaultTestFilesService =>
  new DefaultTestFilesService({ sourceRoot: root, managedRoot: root });

describe("default test files", () => {
  it("copies every bundled fixture into the managed directory", async () => {
    const managedRoot = mkdtempSync(join(tmpdir(), "managed-default-files-"));
    temporaryDirectories.push(managedRoot);
    const files = new DefaultTestFilesService({
      sourceRoot: join(process.cwd(), "fixtures", "default-files"),
      managedRoot,
    });

    await files.initialize();

    for (const name of DEFAULT_TEST_FILE_NAMES) {
      expect(statSync(join(managedRoot, name)).size).toBeGreaterThan(0);
    }
  });

  it("chooses by accept before using the semantic fallback", () => {
    expect(
      chooseDefaultTestFileName({
        accept: ".pdf,image/png",
        label: "Imagine profil",
      }),
    ).toBe("default-document.pdf");
    expect(chooseDefaultTestFileName({ accept: "image/*" })).toBe(
      "default-image.png",
    );
    expect(chooseDefaultTestFileName({ label: "Avatar utilizator" })).toBe(
      "default-image.png",
    );
    expect(chooseDefaultTestFileName({ label: "Fișier atașat" })).toBe(
      "default-text.txt",
    );
  });

  it("converts analyzed file inputs recorded as fill and assigns a matching fixture", () => {
    const root = mkdtempSync(join(tmpdir(), "default-files-"));
    temporaryDirectories.push(root);
    const dataset: TestDataset = {
      id: "dataset-1",
      testId: "test-1",
      name: "Date",
      values: {},
      createdAt: "2026-09-03T08:00:00.000Z",
      updatedAt: "2026-09-03T08:00:00.000Z",
    };

    const result = repairTestFileInputs(
      testDefinition("fill"),
      [dataset],
      [form],
      service(root),
      {
        createId: () => "dataset-new",
        now: () => new Date("2026-09-03T09:00:00.000Z"),
      },
    );

    expect(result.convertedStepCount).toBe(1);
    expect(result.test?.flowItems[0]).toMatchObject({
      type: "action",
      actionType: "upload_file",
      valueStrategy: "dataset",
    });
    expect(result.datasetsToUpdate[0]?.values.avatar_file).toEqual({
      type: "file",
      path: join(root, "default-image.jpg"),
      name: "default-image.jpg",
    });
  });

  it("preserves a usable user file and creates a dataset only when none exists", () => {
    const root = mkdtempSync(join(tmpdir(), "default-files-"));
    temporaryDirectories.push(root);
    const selected = join(root, "selected-by-user.pdf");
    writeFileSync(selected, "user file");
    const dataset: TestDataset = {
      id: "dataset-1",
      testId: "test-1",
      name: "Date",
      values: {
        avatar_file: {
          type: "file",
          path: selected,
          name: "selected-by-user.pdf",
        },
      },
      createdAt: "2026-09-03T08:00:00.000Z",
      updatedAt: "2026-09-03T08:00:00.000Z",
    };
    const options = {
      createId: () => "dataset-new",
      now: () => new Date("2026-09-03T09:00:00.000Z"),
    };

    const preserved = repairTestFileInputs(
      testDefinition("upload_file"),
      [dataset],
      [form],
      service(root),
      options,
    );
    expect(preserved.datasetsToUpdate).toEqual([]);

    const created = repairTestFileInputs(
      testDefinition("upload_file"),
      [],
      [form],
      service(root),
      options,
    );
    expect(created.datasetsToCreate).toHaveLength(1);
    expect(created.datasetsToCreate[0]?.values.avatar_file).toMatchObject({
      type: "file",
      name: "default-image.jpg",
    });
  });
});
