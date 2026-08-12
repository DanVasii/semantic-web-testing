// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { TestImportModal } from "./TestImportModal.js";

const importedTest = {
  id: "test-imported",
  projectId: "project-1",
  name: "Programare tratament",
  description: "Flux importat",
  status: "valid",
  version: 2,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://clinic.example.test/booking",
  normalizedStartUrl: "https://clinic.example.test/booking",
  workflowState: "ready",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  flowItems: [],
} satisfies TestDefinition;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("TestImportModal", () => {
  it("shows a side-effect-free preview and imports only after confirmation", async () => {
    const user = userEvent.setup();
    const previewTestImport = vi.fn().mockResolvedValue({
      previewId: "preview-1",
      fileName: "programare.json",
      valid: true,
      issues: [],
      test: {
        name: importedTest.name,
        description: importedTest.description,
        testMode: "recorded",
        startUrl: importedTest.startUrl,
        flowItemCount: 3,
      },
      datasets: [{ name: "Client demo", valueCount: 2 }],
    });
    const confirmTestImport = vi.fn().mockResolvedValue({
      test: importedTest,
      datasets: [],
    });
    const api = {
      previewTestImport,
      confirmTestImport,
    } as unknown as SemanticAppApi;
    const onImported = vi.fn();

    render(
      <TestImportModal
        api={api}
        projectId="project-1"
        onImported={onImported}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Importă JSON/i }));
    expect(
      await screen.findByRole("dialog", { name: /Preview import JSON/i }),
    ).not.toBeNull();
    expect(screen.getByText("Programare tratament")).not.toBeNull();
    expect(screen.getByText(/Client demo/)).not.toBeNull();
    expect(confirmTestImport).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: /Confirmă importul/i }),
    );
    await waitFor(() => {
      expect(confirmTestImport).toHaveBeenCalledWith("project-1", "preview-1");
      expect(onImported).toHaveBeenCalledWith(importedTest);
    });
  });

  it("renders validation errors with their exact JSON paths", async () => {
    const user = userEvent.setup();
    const api = {
      previewTestImport: vi.fn().mockResolvedValue({
        fileName: "invalid.json",
        valid: false,
        issues: [
          {
            path: "$.mysqlConfig",
            code: "unknown_property",
            message: "Câmpul mysqlConfig nu este permis la import.",
          },
        ],
        datasets: [],
      }),
      confirmTestImport: vi.fn(),
    } as unknown as SemanticAppApi;

    render(
      <TestImportModal api={api} projectId="project-1" onImported={vi.fn()} />,
    );

    await user.click(screen.getByRole("button", { name: /Importă JSON/i }));
    expect(await screen.findByText("$.mysqlConfig")).not.toBeNull();
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: /Confirmă importul/i,
      }).disabled,
    ).toBe(true);
  });
});
