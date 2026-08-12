// @vitest-environment jsdom

import { render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { AiStepEditorModal } from "./AiStepEditorModal.js";

const test: TestDefinition = {
  id: "test-1",
  projectId: "project-1",
  name: "Calendar",
  status: "valid",
  version: 4,
  testMode: "dynamic_ai",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test",
  normalizedStartUrl: "https://example.test/",
  workflowState: "ready",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  flowItems: [
    {
      id: "step-2",
      type: "action",
      actionType: "click",
      title: "Alege ziua",
      humanDescription: "Apasă ziua.",
      whyExplanation: "Selectează data.",
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
    },
    {
      id: "step-3",
      type: "action",
      actionType: "click",
      title: "Alege ora",
      humanDescription: "Apasă ora.",
      whyExplanation: "Selectează ora.",
      target: {
        primary: { type: "text", operator: "equals", value: "10:30" },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const request = {
  task: "edit_step" as const,
  provider: "gemini" as const,
  model: "gemini-flash",
  systemInstruction: "JSON only",
  prompt: "Edit step",
  outputSchema: {},
  contextPreview: { selectedStep: { id: "step-2" } },
  estimatedInputTokens: 100,
  originalContextBytes: 500,
  sentContextBytes: 400,
  omittedPaths: [],
};

describe("AiStepEditorModal", () => {
  it("requires explicit preview and send, shows token usage and applies approved downstream changes", async () => {
    const user = userEvent.setup();
    const previewAiStepEdit = vi.fn().mockResolvedValue({
      request,
      context: {
        selectedStepId: "step-2",
        previousStepIds: [],
        nextStepIds: ["step-3"],
        pageIds: ["page-1"],
      },
    });
    const proposal = {
      summary: "Clarifică selecția.",
      currentStepChange: {
        stepId: "step-2",
        patch: { title: "Alege ziua 15" },
        rationale: "Data este explicită.",
      },
      downstreamChanges: [
        {
          stepId: "step-3",
          patch: { title: "Alege ora 10:30" },
          rationale: "Ora este explicită.",
        },
      ],
    };
    const generateAiStepEdit = vi.fn().mockResolvedValue({
      provider: "gemini",
      model: "gemini-flash",
      proposal,
      diffs: [
        {
          stepId: "step-2",
          field: "title",
          before: "Alege ziua",
          after: "Alege ziua 15",
        },
        {
          stepId: "step-3",
          field: "title",
          before: "Alege ora",
          after: "Alege ora 10:30",
        },
      ],
      usage: { inputTokens: 120, outputTokens: 40, totalTokens: 160 },
    });
    const applyAiStepChanges = vi.fn().mockResolvedValue({
      test: { ...test, version: 5 },
      appliedStepIds: ["step-2", "step-3"],
      aiVersion: 5,
    });
    const api = {
      getAiSettings: vi.fn().mockResolvedValue({
        provider: "gemini",
        ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
        gemini: { model: "gemini-flash", apiKeyConfigured: true },
      }),
      testAiConnection: vi.fn(),
      listAiModels: vi
        .fn()
        .mockResolvedValue([
          { id: "gemini-flash", displayName: "Gemini Flash" },
        ]),
      previewAiStepEdit,
      generateAiStepEdit,
      applyAiStepChanges,
    } as unknown as SemanticAppApi;
    const onApplied = vi.fn();

    render(
      <AiStepEditorModal
        api={api}
        open
        projectId="project-1"
        test={test}
        step={test.flowItems[0]!}
        onClose={vi.fn()}
        onApplied={onApplied}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByRole<HTMLSelectElement>("combobox", {
          name: "Model pentru această cerere",
        }).value,
      ).toBe("gemini-flash");
    });
    await user.type(
      screen.getByLabelText("Ce vrei să schimbe AI la acest pas?"),
      "Clarifică selecția zilei.",
    );
    expect(generateAiStepEdit).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "1. Generează preview" }),
    );
    expect(await screen.findByText("Request preview · local")).not.toBeNull();
    expect(generateAiStepEdit).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "2. Trimite la AI" }));
    expect(await screen.findByText(/160 tokeni total/)).not.toBeNull();
    await user.click(screen.getByLabelText("Pas step-3"));
    await user.click(
      screen.getByRole("button", { name: "Aplică aprobările (2)" }),
    );

    await waitFor(() => {
      expect(applyAiStepChanges).toHaveBeenCalledWith(
        expect.objectContaining({
          baseVersion: 4,
          selectedStepId: "step-2",
          approvedDownstreamStepIds: ["step-3"],
          proposal,
        }),
      );
    });
    expect(onApplied).toHaveBeenCalledWith(
      expect.objectContaining({ version: 5 }),
      5,
    );
  });
});
