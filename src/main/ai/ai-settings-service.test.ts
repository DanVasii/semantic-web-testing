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
  it("loads LiteLLM pricing, converts it per million tokens and caches it for seven days", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [
            {
              id: "gemini/gemini-flash",
              input_cost_per_token: 0.0000003,
              output_cost_per_token: 0.0000025,
              cache_read_input_token_cost: 0.00000003,
            },
          ],
          has_more: false,
        }),
        { status: 200 },
      ),
    );

    const first = await service.getModelPricing("gemini", "gemini-flash");
    const second = await service.getModelPricing("gemini", "gemini-flash");

    expect(first).toMatchObject({
      status: "available",
      source: "litellm",
      inputPerMillionUsd: 0.3,
      outputPerMillionUsd: 2.5,
      cachedInputPerMillionUsd: 0.03,
      matchedModelId: "gemini/gemini-flash",
      fetchedAt: "2026-07-25T12:00:00.000Z",
      expiresAt: "2026-08-01T12:00:00.000Z",
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledOnce();
    const catalogUrl = fetchMock.mock.calls[0]?.[0];
    expect(catalogUrl).toBeInstanceOf(URL);
    expect((catalogUrl as URL).searchParams.get("provider")).toBe("gemini");
    expect(
      service.estimateCachedUsageCost("gemini", "gemini-flash", {
        inputTokens: 1_000,
        outputTokens: 200,
      }),
    ).toBeCloseTo(0.0008);
  });

  it("offers the manual fallback when LiteLLM has no exact model match", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ id: "openai/gpt-other" }],
          has_more: false,
        }),
        { status: 200 },
      ),
    );

    const missing = await service.getModelPricing("openai", "gpt-test");
    expect(missing).toMatchObject({
      provider: "openai",
      model: "gpt-test",
      status: "unavailable",
    });

    const manual = service.saveModelPricing({
      provider: "openai",
      model: "gpt-test",
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 5,
    });
    expect(manual).toMatchObject({
      status: "available",
      source: "manual",
      inputPerMillionUsd: 1.25,
      outputPerMillionUsd: 5,
      expiresAt: "2026-08-01T12:00:00.000Z",
    });
  });

  it("starts with AI disabled and a local Ollama default", () => {
    expect(service.get()).toEqual({
      provider: "none",
      ollama: {
        baseUrl: "http://127.0.0.1:11434",
        model: "",
      },
      lmStudio: {
        baseUrl: "http://127.0.0.1:1234",
        model: "",
      },
      gemini: {
        model: "",
        apiKeyConfigured: false,
      },
      openai: {
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
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
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
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
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
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
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

  it("encrypts an OpenAI key and loads the authorized model catalog", async () => {
    service.save({
      provider: "openai",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
      geminiModel: "",
      openaiModel: "gpt-test",
      openaiApiKey: "openai-secret-key",
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "gpt-test" }, { id: "text-embedding-test" }],
        }),
        { status: 200 },
      ),
    );

    const result = await service.testConnection("openai");

    expect(result).toMatchObject({
      provider: "openai",
      success: true,
      models: [{ id: "gpt-test", displayName: "gpt-test" }],
    });
    expect(repository.get()?.encryptedOpenaiApiKey).toBe(
      "encrypted:b3BlbmFpLXNlY3JldC1rZXk=",
    );
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/models");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer openai-secret-key",
    });
  });

  it("preloads the configured model catalog once and serves it from memory", async () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
      geminiModel: "gemini-flash",
      geminiApiKey: "gemini-secret-key",
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          models: [
            {
              name: "models/gemini-flash",
              displayName: "Gemini Flash",
              supportedGenerationMethods: ["generateContent"],
            },
          ],
        }),
        { status: 200 },
      ),
    );

    service.preloadModels();
    const first = await service.listModels("gemini");
    const second = await service.listModels("gemini");

    expect(first).toEqual(second);
    expect(first[0]?.id).toBe("gemini-flash");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("normalizes and tests an Ollama connection without requiring a local installation in tests", async () => {
    service.save({
      provider: "ollama",
      ollamaBaseUrl: "http://localhost:11434/api/",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
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

  it("normalizes and tests an LM Studio OpenAI-compatible connection", async () => {
    service.save({
      provider: "lm_studio",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://localhost:1234/v1/",
      lmStudioModel: "local/model-a",
      geminiModel: "",
    });
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          object: "list",
          data: [{ id: "local/model-b" }, { id: "local/model-a" }],
        }),
        { status: 200 },
      ),
    );

    const result = await service.testConnection("lm_studio");

    expect(service.get().lmStudio).toEqual({
      baseUrl: "http://localhost:1234",
      model: "local/model-a",
    });
    expect(result).toMatchObject({
      provider: "lm_studio",
      success: true,
      models: [
        { id: "local/model-a", displayName: "local/model-a" },
        { id: "local/model-b", displayName: "local/model-b" },
      ],
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "http://localhost:1234/v1/models",
    );
  });

  it("builds a local preview that removes secrets and limits oversized context", () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
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
    expect(preview.prompt).toContain('{"useful":');
    expect(preview.prompt).not.toContain('\n  "useful":');
  });

  it("keeps nested semantic calendar locators in the AI run preview", () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
      geminiModel: "gemini-flash",
      geminiApiKey: "gemini-secret-key",
    });

    const preview = service.preview({
      task: "adapt_run",
      context: {
        semanticInteractionMap: [
          {
            pageId: "page-calendar",
            controlsAndMarkers: [
              {
                fieldId: "next_month_button",
                primaryLocator: {
                  strategy: {
                    type: "data_attribute",
                    operator: "equals",
                    attribute: "data-testid",
                    value: "calendar-next-month",
                  },
                },
              },
            ],
          },
        ],
      },
    });

    expect(JSON.stringify(preview.contextPreview)).toContain(
      "calendar-next-month",
    );
    expect(preview.outputSchema).toMatchObject({
      required: ["summary", "changes", "insertions"],
    });
  });

  it("can clear the Gemini key only after leaving the Gemini provider", () => {
    service.save({
      provider: "gemini",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
      geminiModel: "",
      geminiApiKey: "gemini-secret-key",
    });

    const cleared = service.save({
      provider: "none",
      ollamaBaseUrl: "http://127.0.0.1:11434",
      ollamaModel: "",
      lmStudioBaseUrl: "http://127.0.0.1:1234",
      lmStudioModel: "",
      geminiModel: "",
      clearGeminiApiKey: true,
    });

    expect(cleared.gemini.apiKeyConfigured).toBe(false);
    expect(repository.get()?.encryptedGeminiApiKey).toBeUndefined();
  });
});
