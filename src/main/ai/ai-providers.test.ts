import { describe, expect, it, vi } from "vitest";

import type { AiRequestPreview } from "../../shared/ai.js";
import { validateAiOutput } from "./ai-output.js";
import { GeminiAIProvider } from "./gemini-provider.js";
import { NoneAIProvider } from "./none-provider.js";
import { OllamaAIProvider } from "./ollama-provider.js";

const analyzePreview: AiRequestPreview = {
  task: "analyze_step",
  provider: "gemini",
  model: "gemini-flash",
  systemInstruction: "Returnează JSON sigur.",
  prompt: "Analizează pasul.",
  outputSchema: { type: "object" },
  contextPreview: {},
  estimatedInputTokens: 12,
  originalContextBytes: 20,
  sentContextBytes: 20,
  omittedPaths: [],
};

const analyzeOutput = {
  summary: "Pas valid.",
  suggestedTitle: "Completează email",
  humanDescription: "Completează câmpul de email.",
  whyExplanation: "Câmp identificat semantic.",
  downstreamSuggestions: ["Verifică validarea."],
};

describe("AI providers", () => {
  it("Gemini sends a strict structured request and reports exact token usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [{ text: JSON.stringify(analyzeOutput) }],
              },
            },
          ],
          usageMetadata: {
            promptTokenCount: 21,
            candidatesTokenCount: 13,
            totalTokenCount: 34,
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new GeminiAIProvider({
      apiKey: "secret-api-key",
      fetch: fetchMock,
    });

    const result = await provider.generate(analyzePreview);

    expect(result).toEqual({
      provider: "gemini",
      model: "gemini-flash",
      output: analyzeOutput,
      usage: { inputTokens: 21, outputTokens: 13, totalTokens: 34 },
    });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("gemini-flash:generateContent");
    expect(request.headers).toMatchObject({
      "x-goog-api-key": "secret-api-key",
    });
    if (typeof request.body !== "string") {
      throw new Error("Expected a serialized Gemini request body.");
    }
    expect(JSON.parse(request.body)).toMatchObject({
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
        responseJsonSchema: { type: "object" },
      },
    });
  });

  it("retries Gemini 400 without responseJsonSchema and still validates locally", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: 400,
              message: "Request contains an invalid argument.",
              status: "INVALID_ARGUMENT",
            },
          }),
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                content: {
                  parts: [{ text: JSON.stringify(analyzeOutput) }],
                },
              },
            ],
            usageMetadata: {
              promptTokenCount: 25,
              candidatesTokenCount: 15,
              totalTokenCount: 40,
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new GeminiAIProvider({
      apiKey: "secret-api-key",
      fetch: fetchMock,
    });

    const result = await provider.generate(analyzePreview);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as
      RequestInit | undefined;
    const secondRequest = fetchMock.mock.calls[1]?.[1] as
      RequestInit | undefined;
    if (
      typeof firstRequest?.body !== "string" ||
      typeof secondRequest?.body !== "string"
    ) {
      throw new Error("Expected serialized Gemini requests.");
    }
    const firstPayload: unknown = JSON.parse(firstRequest.body);
    const secondPayload: unknown = JSON.parse(secondRequest.body);
    expect(firstPayload).toMatchObject({
      generationConfig: {
        responseJsonSchema: { type: "object" },
      },
    });
    const serializedFallback = JSON.stringify(secondPayload);
    expect(serializedFallback).not.toContain("responseJsonSchema");
    expect(serializedFallback).toContain("Schema JSON exactă");
    expect(serializedFallback).toContain('\\"type\\":\\"object\\"');
    expect(result.output).toEqual(analyzeOutput);
    expect(result.usage.totalTokens).toBe(40);
  });

  it("Gemini reads final non-thought parts and nested JSON safely", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  { thought: true, text: '"not the final answer"' },
                  { text: JSON.stringify(JSON.stringify(analyzeOutput)) },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
    );
    const provider = new GeminiAIProvider({
      apiKey: "secret-api-key",
      fetch: fetchMock,
    });

    const result = await provider.generate(analyzePreview);

    expect(result.output).toEqual(analyzeOutput);
  });

  it("Ollama sends a non-streaming schema request and validates locator repair", async () => {
    const output = {
      summary: "Locator reparat.",
      stepId: "step-1",
      primaryLocator: {
        type: "data_attribute",
        operator: "equals",
        value: "submit-order",
        attribute: "data-testid",
      },
      fallbackLocators: [
        {
          type: "role",
          operator: "equals",
          value: "Trimite comanda",
          role: "button",
        },
      ],
      rationale: "Atribut stabil și nume accesibil.",
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: JSON.stringify(output),
          prompt_eval_count: 30,
          eval_count: 20,
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaAIProvider({
      baseUrl: "http://localhost:11434/",
      fetch: fetchMock,
    });
    const request: AiRequestPreview = {
      ...analyzePreview,
      task: "repair_locator",
      provider: "ollama",
      model: "gemma3:4b",
    };

    const result = await provider.generate(request);

    expect(result.output).toEqual(output);
    expect(result.usage).toEqual({
      inputTokens: 30,
      outputTokens: 20,
      totalTokens: 50,
    });
    const [, requestOptions] = fetchMock.mock.calls[0] as [string, RequestInit];
    if (typeof requestOptions.body !== "string") {
      throw new Error("Expected a serialized Ollama request body.");
    }
    expect(JSON.parse(requestOptions.body)).toMatchObject({
      model: "gemma3:4b",
      stream: false,
      options: { temperature: 0 },
      format: { type: "object" },
    });
  });

  it("rejects unknown fields, unsupported actions and arbitrary code", () => {
    expect(() =>
      validateAiOutput("analyze_step", {
        ...analyzeOutput,
        unexpected: true,
      }),
    ).toThrow("schema strictă");
    expect(() =>
      validateAiOutput("generate_test", {
        summary: "Test",
        downstreamSuggestions: [],
        steps: [
          {
            actionType: "execute_code",
            title: "Rulează",
            humanDescription: "Rulează ceva.",
            whyExplanation: "Nu este permis.",
          },
        ],
      }),
    ).toThrow("acțiune nepermisă");
    expect(() =>
      validateAiOutput("analyze_step", {
        ...analyzeOutput,
        summary: "```javascript\nalert(1)\n```",
      }),
    ).toThrow("cod arbitrar");
  });

  it("validates strict step edits and rejects arbitrary downstream fields", () => {
    const editOutput = {
      summary: "Clarifică pașii calendarului.",
      currentStepChange: {
        stepId: "step-2",
        patch: {
          title: "Alege ziua 15",
          primaryLocator: {
            type: "data_attribute",
            operator: "equals",
            value: "calendar-day-15",
            attribute: "data-testid",
          },
        },
        rationale: "Ziua devine explicită.",
      },
      downstreamChanges: [
        {
          stepId: "step-3",
          patch: { humanDescription: "Alege ora disponibilă." },
          rationale: "Păstrează pasul următor coerent.",
        },
      ],
    };

    expect(validateAiOutput("edit_step", editOutput)).toEqual(editOutput);
    expect(() =>
      validateAiOutput("edit_step", {
        ...editOutput,
        downstreamChanges: [
          {
            ...editOutput.downstreamChanges[0],
            patch: { command: "powershell.exe" },
          },
        ],
      }),
    ).toThrow("cod arbitrar");
  });

  it("keeps None as a provider that never performs generation", async () => {
    const provider = new NoneAIProvider();
    await expect(provider.generate()).rejects.toThrow(
      "Providerul AI este dezactivat",
    );
    await expect(provider.listModels()).resolves.toEqual([]);
  });
});
