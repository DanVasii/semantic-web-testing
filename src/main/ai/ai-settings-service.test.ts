import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../persistence/database.js";
import { ApplicationAiSettingsRepository } from "../persistence/repositories.js";
import type { FetchImplementation } from "./ai-provider.js";
import { AiSettingsService } from "./ai-settings-service.js";

let directory: string;
let database: ApplicationDatabase;
let repository: ApplicationAiSettingsRepository;
let fetchMock: ReturnType<typeof vi.fn<FetchImplementation>>;
let service: AiSettingsService;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-app-ai-settings-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  repository = new ApplicationAiSettingsRepository(database.connection);
  fetchMock = vi.fn<FetchImplementation>();
  service = new AiSettingsService(repository, {
    now: () => new Date("2026-07-25T12:00:00.000Z"),
    secrets: {
      encrypt: (value) => `encrypted:${Buffer.from(value).toString("base64")}`,
      decrypt: (value) =>
        Buffer.from(value.replace("encrypted:", ""), "base64").toString(),
    },
    fetch: fetchMock,
  });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("AiSettingsService", () => {
  it("starts with AI disabled and a local Ollama default", () => {
    expect(service.get()).toEqual({
      provider: "none",
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        model: "",
      },
      gemini: {
        model: "",
        apiKeyConfigured: false,
      },
    });
  });

  it("encrypts the Gemini key and preserves it when only the model changes", () => {
    const saved = service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434/",
      ollamaModel: "",
      geminiModel: "",
      geminiApiKey: "gemini-secret-key",
    });

    expect(saved).toMatchObject({
      provider: "gemini",
      gemini: { apiKeyConfigured: true },
      updatedAt: "2026-07-25T12:00:00.000Z",
    });
    expect(saved).not.toHaveProperty("geminiApiKey");
    expect(repository.get()?.encryptedGeminiApiKey).toBe(
      "encrypted:Z2VtaW5pLXNlY3JldC1rZXk=",
    );

    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      geminiModel: "gemini-model",
    });
    expect(repository.get()?.encryptedGeminiApiKey).toBe(
      "encrypted:Z2VtaW5pLXNlY3JldC1rZXk=",
    );
  });

  it("tests Gemini explicitly and returns only compatible generation models", async () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      geminiModel: "",
      geminiApiKey: "gemini-secret-key",
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-flash",
              displayName: "Gemini Flash",
              inputTokenLimit: 1000,
              outputTokenLimit: 200,
              supportedGenerationMethods: ["generateContent"],
            },
            {
              name: "models/embedding",
              displayName: "Embedding",
              supportedGenerationMethods: ["embedContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    const result = await service.testConnection("gemini");

    expect(result).toMatchObject({
      provider: "gemini",
      success: true,
      models: [
        {
          id: "gemini-flash",
          displayName: "Gemini Flash",
          inputTokenLimit: 1000,
          outputTokenLimit: 200,
        },
      ],
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(request.headers).toMatchObject({
      "x-goog-api-key": "gemini-secret-key",
    });
  });

  it("normalizes and tests an Ollama connection without requiring a local installation in tests", async () => {
    service.save({
      provider: "ollama",
      ollamaBaseUrl: "http://localhost:11434/api/",
      ollamaModel: "",
      geminiModel: "",
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [{ name: "gemma3:4b" }, { model: "qwen:latest" }],
        }),
        { status: 200 },
      ),
    );

    const result = await service.testConnection("ollama");

    expect(service.get().ollama.baseUrl).toBe("http://localhost:11434");
    expect(result.success).toBe(true);
    expect(result.models.map(({ id }) => id)).toEqual([
      "gemma3:4b",
      "qwen:latest",
    ]);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:11434/api/tags",
    );
  });

  it("builds a local preview that removes secrets and limits oversized context", () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      geminiModel: "gemini-flash",
      geminiApiKey: "gemini-secret-key",
    });

    const preview = service.preview({
      task: "analyze_step",
      context: {
        password: "do-not-send",
        rawHtml: "<main>private</main>",
        useful: "x".repeat(2_000),
        step: { title: "Completează email" },
      },
    });

    expect(preview.provider).toBe("gemini");
    expect(preview.model).toBe("gemini-flash");
    expect(preview.estimatedInputTokens).toBeGreaterThan(0);
    expect(preview.sentContextBytes).toBeLessThan(preview.originalContextBytes);
    expect(preview.omittedPaths).toEqual(
      expect.arrayContaining(["$.password", "$.rawHtml", "$.useful"]),
    );
    expect(JSON.stringify(preview.contextPreview)).not.toContain("do-not-send");
    expect(preview.prompt).toContain("Completează email");
  });

  it("can clear the Gemini key only after leaving the Gemini provider", () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      geminiModel: "",
      geminiApiKey: "gemini-secret-key",
    });

    const cleared = service.save({
      provider: "none",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      geminiModel: "",
      clearGeminiApiKey: true,
    });

    expect(cleared.gemini.apiKeyConfigured).toBe(false);
    expect(repository.get()?.encryptedGeminiApiKey).toBeUndefined();
  });
});
