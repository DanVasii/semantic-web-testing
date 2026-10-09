import { describe, expect, it, vi } from "vitest";

import type { AiRequestPreview } from "../../shared/ai.js";
import { validateAiOutput } from "./ai-output.js";
import { GeminiAIProvider } from "./gemini-provider.js";
import { LmStudioAIProvider } from "./lm-studio-provider.js";
import { NoneAIProvider } from "./none-provider.js";
import { OllamaAIProvider } from "./ollama-provider.js";
import { OpenAiProvider } from "./openai-provider.js";

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

const parseRequestBody = (request: RequestInit): unknown => {
  if (typeof request.body !== "string") {
    throw new Error("Expected a serialized request body.");
  }
  return JSON.parse(request.body) as unknown;
};

describe("AI providers", () => {
  it("OpenAI sends an authenticated strict structured request", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(analyzeOutput) } }],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 11,
            total_tokens: 29,
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new OpenAiProvider({
      apiKey: "openai-secret-key",
      fetch: fetchMock,
    });

    const result = await provider.generate({
      ...analyzePreview,
      provider: "openai",
      model: "gpt-test",
    });

    expect(result).toEqual({
      provider: "openai",
      model: "gpt-test",
      output: analyzeOutput,
      usage: { inputTokens: 18, outputTokens: 11, totalTokens: 29 },
    });
    const [url, request] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.openai.com/v1/chat/completions");
    expect(request.headers).toMatchObject({
      Authorization: "Bearer openai-secret-key",
    });
    expect(parseRequestBody(request)).toMatchObject({
      model: "gpt-test",
      response_format: {
        type: "json_schema",
        json_schema: { strict: true, schema: { type: "object" } },
      },
    });
  });

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

  it("retries a truncated Gemini visual action with a larger output budget", async () => {
    const decision = {
      status: "click",
      x: 0.441,
      y: 0.62,
      confidence: 0.9,
      observation: "Butonul următor este vizibil.",
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              {
                finishReason: "MAX_TOKENS",
                content: {
                  parts: [{ text: '{ "status": "click", "x": 0.441, "y":' }],
                },
              },
            ],
          }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            candidates: [
              { content: { parts: [{ text: JSON.stringify(decision) }] } },
            ],
            usageMetadata: {
              promptTokenCount: 30,
              candidatesTokenCount: 12,
              totalTokenCount: 42,
            },
          }),
          { status: 200 },
        ),
      );
    const provider = new GeminiAIProvider({
      apiKey: "secret-api-key",
      fetch: fetchMock,
    });

    const result = await provider.decideVisualAction({
      model: "gemini-2.5-flash",
      instruction: "Selectează prima dată disponibilă.",
      imageBase64: "aW1hZ2U=",
      mimeType: "image/jpeg",
      actionCount: 0,
      maxActions: 5,
      history: [],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstRequest = fetchMock.mock.calls[0]?.[1] as
      RequestInit | undefined;
    const retryRequest = fetchMock.mock.calls[1]?.[1] as
      RequestInit | undefined;
    if (firstRequest === undefined || retryRequest === undefined) {
      throw new Error("Expected both Gemini visual action requests.");
    }
    const firstPayload = parseRequestBody(firstRequest);
    const retryPayload = parseRequestBody(retryRequest);
    expect(firstPayload).toMatchObject({
      generationConfig: {
        maxOutputTokens: 4096,
        thinkingConfig: { thinkingBudget: 0 },
      },
    });
    expect(retryPayload).toMatchObject({
      generationConfig: { maxOutputTokens: 8192 },
    });
    expect(result).toMatchObject({
      provider: "gemini",
      model: "gemini-2.5-flash",
      ...decision,
      usage: { totalTokens: 42 },
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

  it("LM Studio uses OpenAI-compatible structured output and token usage", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify(analyzeOutput),
              },
            },
          ],
          usage: {
            prompt_tokens: 18,
            completion_tokens: 11,
            total_tokens: 29,
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new LmStudioAIProvider({
      baseUrl: "http://localhost:1234/",
      fetch: fetchMock,
    });
    const request: AiRequestPreview = {
      ...analyzePreview,
      provider: "lm_studio",
      model: "local/qwen-test",
    };

    const result = await provider.generate(request);

    expect(result).toEqual({
      provider: "lm_studio",
      model: "local/qwen-test",
      output: analyzeOutput,
      usage: { inputTokens: 18, outputTokens: 11, totalTokens: 29 },
    });
    const [url, requestOptions] = fetchMock.mock.calls[0] as [
      string,
      RequestInit,
    ];
    expect(url).toBe("http://localhost:1234/v1/chat/completions");
    if (typeof requestOptions.body !== "string") {
      throw new Error("Expected a serialized LM Studio request body.");
    }
    expect(JSON.parse(requestOptions.body)).toMatchObject({
      model: "local/qwen-test",
      temperature: 0,
      stream: false,
      messages: [
        { role: "system", content: "Returnează JSON sigur." },
        { role: "user", content: "Analizează pasul." },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "semantic_analyze_step",
          strict: true,
          schema: { type: "object" },
        },
      },
    });
  });

  it("Gemini sends visual checks as inline image data", async () => {
    const verdict = {
      passed: true,
      confidence: 0.91,
      explanation: "Confirmarea este vizibilă.",
      evidence: ["Comandă finalizată"],
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(verdict) }] } },
          ],
          usageMetadata: {
            promptTokenCount: 40,
            candidatesTokenCount: 10,
            totalTokenCount: 50,
          },
        }),
        { status: 200 },
      ),
    );
    const provider = new GeminiAIProvider({
      apiKey: "secret-api-key",
      fetch: fetchMock,
    });

    const result = await provider.evaluateVisualCheck({
      model: "gemini-vision",
      prompt: "Confirmă finalizarea comenzii.",
      imagesBase64: ["anBlZw=="],
      mimeType: "image/jpeg",
    });

    expect(result).toMatchObject({ ...verdict, provider: "gemini" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = parseRequestBody(request) as {
      contents: { parts: unknown[] }[];
    };
    expect(body.contents[0]?.parts).toEqual(
      expect.arrayContaining([
        { inlineData: { mimeType: "image/jpeg", data: "anBlZw==" } },
      ]),
    );
  });

  it("LM Studio sends visual checks through an OpenAI image_url part", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  passed: true,
                  confidence: 0.8,
                  explanation: "Rezultatul este vizibil.",
                  evidence: ["Succes"],
                }),
              },
            },
          ],
          usage: { prompt_tokens: 8, completion_tokens: 4, total_tokens: 12 },
        }),
        { status: 200 },
      ),
    );
    const provider = new LmStudioAIProvider({
      baseUrl: "http://localhost:1234",
      fetch: fetchMock,
    });

    await provider.evaluateVisualCheck({
      model: "local/vision",
      prompt: "Confirmă rezultatul.",
      imagesBase64: ["anBlZw=="],
      mimeType: "image/jpeg",
    });

    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = parseRequestBody(request) as {
      messages: { content: unknown }[];
      max_tokens: number;
    };
    expect(body.max_tokens).toBe(1_024);
    expect(body.messages[1]?.content).toEqual(
      expect.arrayContaining([
        {
          type: "image_url",
          image_url: { url: "data:image/jpeg;base64,anBlZw==" },
        },
      ]),
    );
  });

  it("Ollama sends the screenshot through its images field", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          response: JSON.stringify({
            passed: false,
            confidence: 0.4,
            explanation: "Confirmarea nu este vizibilă.",
            evidence: [],
          }),
          prompt_eval_count: 15,
          eval_count: 5,
        }),
        { status: 200 },
      ),
    );
    const provider = new OllamaAIProvider({
      baseUrl: "http://localhost:11434",
      fetch: fetchMock,
    });

    const result = await provider.evaluateVisualCheck({
      model: "llava",
      prompt: "Confirmă rezultatul.",
      imagesBase64: ["anBlZw=="],
      mimeType: "image/jpeg",
    });

    expect(result.passed).toBe(false);
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(parseRequestBody(request)).toMatchObject({
      model: "llava",
      images: ["anBlZw=="],
      stream: false,
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
        name: "Test nou",
        description: "Variantă",
        datasets: [],
        changes: [],
        removals: [],
        insertions: [
          {
            anchorStepId: "step-1",
            position: "after",
            rationale: "Nu este permis.",
            step: {
              id: "ai-step-1",
              type: "action",
              actionType: "execute_code",
              title: "Rulează",
              humanDescription: "Rulează ceva.",
              whyExplanation: "Nu este permis.",
              fallbacks: [],
              enabled: true,
            },
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

  it("validates a strict textual Google Pay card selection", () => {
    expect(
      validateAiOutput("select_google_pay_card", {
        scenarioCode: "incorrect_cvc",
        reason: "Descrierea cere scenariul incorrect_cvc.",
      }),
    ).toEqual({
      scenarioCode: "incorrect_cvc",
      reason: "Descrierea cere scenariul incorrect_cvc.",
    });
    expect(() =>
      validateAiOutput("select_google_pay_card", {
        scenarioCode: "incorrect_cvc",
        reason: "Potrivit.",
        coordinates: { x: 0.5, y: 0.5 },
      }),
    ).toThrow("schema strictă");
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
