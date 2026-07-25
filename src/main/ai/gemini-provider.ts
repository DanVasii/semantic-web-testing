import type {
  AiGenerationResult,
  AiModelInfo,
  AiRequestPreview,
} from "../../shared/ai.js";
import { validateAiOutput } from "./ai-output.js";
import {
  type AIProvider,
  type FetchImplementation,
  requireSuccessfulResponse,
} from "./ai-provider.js";

interface GeminiProviderOptions {
  apiKey: string;
  fetch: FetchImplementation;
}

type UnknownObject = Record<string, unknown>;

const asObject = (value: unknown): UnknownObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownObject)
    : undefined;

export class GeminiAIProvider implements AIProvider {
  public readonly id = "gemini" as const;
  private readonly endpoint =
    "https://generativelanguage.googleapis.com/v1beta";

  public constructor(private readonly options: GeminiProviderOptions) {}

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      "Content-Type": "application/json",
      "x-goog-api-key": this.options.apiKey,
    };
  }

  public async listModels(): Promise<AiModelInfo[]> {
    const response = await this.options.fetch(
      `${this.endpoint}/models?pageSize=1000`,
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    await requireSuccessfulResponse(response, "Gemini");
    const body = asObject(await response.json());
    if (body === undefined || !Array.isArray(body["models"])) {
      throw new Error("Gemini a returnat o listă de modele invalidă.");
    }
    return body["models"]
      .map((item): AiModelInfo | undefined => {
        const model = asObject(item);
        const name =
          typeof model?.["name"] === "string" ? model["name"] : undefined;
        const supported = Array.isArray(model?.["supportedGenerationMethods"])
          ? model["supportedGenerationMethods"]
          : [];
        if (name === undefined || !supported.includes("generateContent")) {
          return undefined;
        }
        const id = name.replace(/^models\//, "");
        return {
          id,
          displayName:
            typeof model?.["displayName"] === "string"
              ? model["displayName"]
              : id,
          ...(typeof model?.["inputTokenLimit"] === "number"
            ? { inputTokenLimit: model["inputTokenLimit"] }
            : {}),
          ...(typeof model?.["outputTokenLimit"] === "number"
            ? { outputTokenLimit: model["outputTokenLimit"] }
            : {}),
        };
      })
      .filter((item): item is AiModelInfo => item !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public async generate(
    request: AiRequestPreview,
  ): Promise<AiGenerationResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Gemini.");
    }
    const model = request.model.replace(/^models\//, "");
    const response = await this.options.fetch(
      `${this.endpoint}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: request.systemInstruction }],
          },
          contents: [{ role: "user", parts: [{ text: request.prompt }] }],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            responseJsonSchema: request.outputSchema,
          },
        }),
      },
    );
    await requireSuccessfulResponse(response, "Gemini");
    const body = asObject(await response.json());
    const candidates = Array.isArray(body?.["candidates"])
      ? body["candidates"]
      : [];
    const candidate = asObject(candidates[0]);
    const content = asObject(candidate?.["content"]);
    const parts = Array.isArray(content?.["parts"]) ? content["parts"] : [];
    const text = parts
      .map((part) => asObject(part)?.["text"])
      .find((value): value is string => typeof value === "string");
    if (text === undefined) {
      throw new Error("Gemini nu a returnat conținut JSON.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("Gemini nu a returnat JSON valid.");
    }
    const usage = asObject(body?.["usageMetadata"]);
    const inputTokens =
      typeof usage?.["promptTokenCount"] === "number"
        ? usage["promptTokenCount"]
        : 0;
    const outputTokens =
      typeof usage?.["candidatesTokenCount"] === "number"
        ? usage["candidatesTokenCount"]
        : 0;
    const totalTokens =
      typeof usage?.["totalTokenCount"] === "number"
        ? usage["totalTokenCount"]
        : inputTokens + outputTokens;
    return {
      provider: "gemini",
      model,
      output: validateAiOutput(request.task, parsed),
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }
}
