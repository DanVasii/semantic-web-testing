// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { AiStepCreatorModal } from "./AiStepCreatorModal.js";

afterEach(cleanup);

describe("AiStepCreatorModal", () => {
  it("previews, validates and adds one generated check", async () => {
    const user = userEvent.setup();
    const test: TestDefinition = {
      id: "test-1",
      projectId: "project-1",
      name: "Checkout",
      status: "draft",
      version: 1,
      testMode: "dynamic_ai",
      wipeBeforeRun: false,
      startMode: "base_url",
      startUrl: "https://example.test",
      normalizedStartUrl: "https://example.test/",
      workflowState: "not_recorded",
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
      flowItems: [],
    };
    const request = {
      task: "create_step" as const,
      provider: "gemini" as const,
      model: "gemini-test",
      systemInstruction: "Returnează JSON.",
      prompt: "Generează pasul.",
      outputSchema: {},
      contextPreview: {},
      estimatedInputTokens: 20,
      originalContextBytes: 100,
      sentContextBytes: 100,
      omittedPaths: [],
    };
    const step = {
      id: "step-ai-check",
      type: "check" as const,
      checkType: "text" as const,
      title: "Confirmă salvarea",
      humanDescription: "Așteaptă mesajul de succes.",
      config: {
        target: {
          type: "css" as const,
          operator: "equals" as const,
          value: "#success",
        },
        operator: "contains" as const,
        value: "Salvat",
      },
      timeoutMs: 10_000,
      enabled: true,
    };
    const api = {
      getAiSettings: vi.fn().mockResolvedValue({
        provider: "gemini",
        gemini: { model: "gemini-test", apiKeyConfigured: true },
        ollama: { baseUrl: "http://localhost:11434", model: "" },
        lmStudio: { baseUrl: "http://localhost:1234", model: "" },
      }),
      listAiModels: vi.fn().mockResolvedValue([]),
      previewAiRequest: vi.fn().mockResolvedValue(request),
      generateAiRequest: vi.fn().mockResolvedValue({
        provider: "gemini",
        model: "gemini-test",
        output: { summary: "Check generat.", step },
        usage: { inputTokens: 10, outputTokens: 10, totalTokens: 20 },
      }),
    } as unknown as SemanticAppApi;
    const onAdd = vi.fn();

    render(
      <AiStepCreatorModal
        api={api}
        open
        test={test}
        items={[]}
        stepId="step-ai-check"
        stepType="check"
        onAdd={onAdd}
        onClose={vi.fn()}
      />,
    );

    await user.type(
      await screen.findByLabelText("Descrierea pasului"),
      "Așteaptă mesajul Salvat.",
    );
    expect(screen.getByLabelText("Model").tagName).toBe("SELECT");
    await user.click(
      screen.getByRole("button", { name: "1. Preview request" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "2. Trimite la AI" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "3. Adaugă pasul propus" }),
    );

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(step));
  });
});
