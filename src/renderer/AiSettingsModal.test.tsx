// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import { AiSettingsModal } from "./AiSettingsModal.js";

afterEach(cleanup);

const settings = {
  provider: "none" as const,
  ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
  gemini: { model: "", apiKeyConfigured: false },
};

describe("AiSettingsModal", () => {
  it("offers a copyable prompt for generating compatible imports with another AI", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const api = {
      getAiSettings: vi.fn().mockResolvedValue(settings),
      listAiModels: vi.fn().mockResolvedValue([]),
    } as unknown as SemanticAppApi;

    render(<AiSettingsModal api={api} open onClose={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Copiază promptul" }),
    );

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"kind": "semantic-test"'),
    );
    expect(screen.getByText(/Îl poți lipi în orice alt AI/)).not.toBeNull();
  });

  it("saves a Gemini key in app settings, tests it explicitly and loads models", async () => {
    const user = userEvent.setup();
    const api = {
      getAiSettings: vi.fn().mockResolvedValue(settings),
      saveAiSettings: vi.fn().mockResolvedValue({
        ...settings,
        provider: "gemini",
        gemini: { model: "", apiKeyConfigured: true },
      }),
      testAiConnection: vi.fn().mockResolvedValue({
        provider: "gemini",
        success: true,
        message: "Conexiune reușită. 1 model compatibil disponibil.",
        latencyMs: 42,
        models: [
          {
            id: "gemini-flash",
            displayName: "Gemini Flash",
            inputTokenLimit: 1000,
            outputTokenLimit: 200,
          },
        ],
      }),
      listAiModels: vi.fn().mockResolvedValue([]),
      previewAiRequest: vi.fn(),
    } as unknown as SemanticAppApi;

    render(<AiSettingsModal api={api} open onClose={vi.fn()} />);
    await user.selectOptions(
      await screen.findByLabelText("Provider activ"),
      "gemini",
    );
    expect(screen.getByText(/nu folosim \.env/i)).not.toBeNull();
    await user.type(
      screen.getByLabelText("Cheie Gemini API"),
      "secret-key-123",
    );
    await user.click(
      screen.getByRole("button", {
        name: "Testează conexiunea și reîncarcă modelele",
      }),
    );

    await waitFor(() => {
      expect(api.saveAiSettings).toHaveBeenCalledWith({
        provider: "gemini",
        ollamaBaseUrl: "http://127.0.0.1:11434",
        ollamaModel: "",
        geminiModel: "",
        geminiApiKey: "secret-key-123",
      });
      expect(api.testAiConnection).toHaveBeenCalledWith("gemini");
    });
    expect(await screen.findByText(/Conexiune reușită/)).not.toBeNull();
    expect(
      screen.getByRole("option", {
        name: /Gemini Flash · 1.000 tokenuri input/,
      }),
    ).not.toBeNull();
  });

  it("shows a local request preview and token estimate without sending data", async () => {
    const user = userEvent.setup();
    const api = {
      getAiSettings: vi.fn().mockResolvedValue({
        ...settings,
        provider: "gemini",
        gemini: { model: "gemini-flash", apiKeyConfigured: true },
      }),
      saveAiSettings: vi.fn(),
      testAiConnection: vi.fn(),
      listAiModels: vi
        .fn()
        .mockResolvedValue([
          { id: "gemini-flash", displayName: "Gemini Flash" },
        ]),
      previewAiRequest: vi.fn().mockResolvedValue({
        task: "analyze_step",
        provider: "gemini",
        model: "gemini-flash",
        systemInstruction: "Instrucțiune sigură.",
        prompt: "Prompt limitat.",
        outputSchema: { type: "object" },
        contextPreview: { step: "fill" },
        estimatedInputTokens: 321,
        originalContextBytes: 500,
        sentContextBytes: 220,
        omittedPaths: ["$.password"],
      }),
    } as unknown as SemanticAppApi;

    render(<AiSettingsModal api={api} open onClose={vi.fn()} />);
    await user.click(
      await screen.findByRole("button", { name: "Generează preview local" }),
    );

    expect(api.previewAiRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        task: "analyze_step",
        provider: "gemini",
        model: "gemini-flash",
      }),
    );
    expect(await screen.findByText("321")).not.toBeNull();
    expect(screen.getByText(/Câmpuri omise.*password/)).not.toBeNull();
    expect(
      screen.getByText(/Generarea preview-ului nu apelează/),
    ).not.toBeNull();
    expect(api.testAiConnection).not.toHaveBeenCalled();
    expect(api.listAiModels).toHaveBeenCalledWith("gemini");
    expect(
      screen.getByLabelText<HTMLSelectElement>("Model implicit Gemini").value,
    ).toBe("gemini-flash");
  });
});
