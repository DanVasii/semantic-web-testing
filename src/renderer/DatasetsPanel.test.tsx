// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDataset } from "../shared/test-model.js";
import { DatasetsPanel } from "./DatasetsPanel.js";

const dataset: TestDataset = {
  id: "dataset-1",
  testId: "test-1",
  name: "Client standard",
  values: {
    customer_email: { type: "fixed", value: "ana@example.test" },
  },
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
};

const createApi = (overrides: Record<string, unknown> = {}) =>
  ({
    listDatasets: vi.fn().mockResolvedValue([dataset]),
    createDataset: vi.fn(),
    duplicateDataset: vi.fn(),
    saveDataset: vi
      .fn()
      .mockImplementation(
        (
          _projectId: string,
          _testId: string,
          _datasetId: string,
          input: { name: string; values: TestDataset["values"] },
        ) => ({
          ...dataset,
          ...input,
          updatedAt: "2026-07-25T12:00:00.000Z",
        }),
      ),
    deleteDataset: vi.fn(),
    previewDatasetValue: vi.fn().mockResolvedValue("generated-id"),
    ...overrides,
  }) as unknown as SemanticAppApi;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("DatasetsPanel", () => {
  it("keeps JSON and visual editors synchronized, validates and saves", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(<DatasetsPanel api={api} projectId="project-1" testId="test-1" />);

    expect(await screen.findByDisplayValue("Client standard")).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: "JSON raw" }));
    const editor = screen.getByRole("textbox", {
      name: "JSON raw al datasetului",
    });

    fireEvent.change(editor, { target: { value: "{" } });
    expect(screen.getByText(/Dataset-ul nu este valid/)).not.toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Salvează datasetul",
      }).disabled,
    ).toBe(true);

    const changed = {
      ...dataset,
      name: "Client JSON",
      values: {
        reference_id: { type: "generated", strategy: "uuid" },
      },
    };
    fireEvent.change(editor, {
      target: { value: JSON.stringify(changed, null, 2) },
    });
    await user.click(screen.getByRole("tab", { name: "Editor vizual" }));

    expect(screen.getByDisplayValue("Client JSON")).not.toBeNull();
    expect(
      screen.getByRole<HTMLSelectElement>("combobox", {
        name: "Strategie pentru reference_id",
      }).value,
    ).toBe("uuid");

    await user.click(
      screen.getByRole("button", { name: "Previzualizează valoarea" }),
    );
    expect(await screen.findByText('"generated-id"')).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Salvează datasetul" }),
    );

    await waitFor(() => {
      expect(api.saveDataset).toHaveBeenCalledWith(
        "project-1",
        "test-1",
        "dataset-1",
        {
          name: "Client JSON",
          values: changed.values,
        },
      );
    });
  });

  it("creates, duplicates and deletes a dataset", async () => {
    const user = userEvent.setup();
    const created = { ...dataset, id: "dataset-new", name: "Nou" };
    const duplicate = {
      ...created,
      id: "dataset-copy",
      name: "Nou (copie)",
    };
    const api = createApi({
      listDatasets: vi.fn().mockResolvedValue([]),
      createDataset: vi.fn().mockResolvedValue(created),
      duplicateDataset: vi.fn().mockResolvedValue(duplicate),
      deleteDataset: vi.fn().mockResolvedValue(true),
    });
    render(<DatasetsPanel api={api} projectId="project-1" testId="test-1" />);

    expect(
      await screen.findByText("Nu există încă niciun dataset."),
    ).not.toBeNull();
    await user.type(screen.getByLabelText("Dataset nou"), "Nou");
    await user.click(screen.getByRole("button", { name: "Creează dataset" }));
    expect(await screen.findByDisplayValue("Nou")).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "Duplică" }));
    expect(await screen.findByDisplayValue("Nou (copie)")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Șterge" }));
    await user.click(screen.getByRole("button", { name: "Șterge datasetul" }));

    await waitFor(() => {
      expect(api.deleteDataset).toHaveBeenCalledWith(
        "project-1",
        "test-1",
        "dataset-copy",
      );
    });
  });

  it("shows a compact key list and edits only the selected value", async () => {
    const user = userEvent.setup();
    const multipleValues: TestDataset = {
      ...dataset,
      values: {
        customer_email: { type: "fixed", value: "ana@example.test" },
        order_id: { type: "generated", strategy: "uuid" },
        retry_count: 3,
      },
    };
    const api = createApi({
      listDatasets: vi.fn().mockResolvedValue([multipleValues]),
    });

    render(<DatasetsPanel api={api} projectId="project-1" testId="test-1" />);

    expect(
      await screen.findByRole("navigation", { name: "Cheile datasetului" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("combobox", {
        name: "Strategie pentru customer_email",
      }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("combobox", { name: "Strategie pentru order_id" }),
    ).toBeNull();

    await user.click(screen.getByRole("button", { name: /^order_id/i }));

    expect(
      screen.getByRole("combobox", { name: "Strategie pentru order_id" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("combobox", {
        name: "Strategie pentru customer_email",
      }),
    ).toBeNull();
  });
});
