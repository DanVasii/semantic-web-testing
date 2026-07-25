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

interface OllamaProviderOptions {
  baseUrl: string;
  fetch: FetchImplementation;
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

export class OllamaAIProvider implements AIProvider {
  public readonly id = "ollama" as const;
  private readonly baseUrl: string;

  public constructor(private readonly options: OllamaProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  public async listModels(): Promise<AiModelInfo[]> {
    const response = await this.options.fetch(`${this.baseUrl}/api/tags`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    await requireSuccessfulResponse(response, "Ollama");
    const body = asObject(await response.json());
    if (body === undefined || !Array.isArray(body["models"])) {
      throw new Error("Ollama a returnat o listă de modele invalidă.");
    }
    return body["models"]
      .map((item): AiModelInfo | undefined => {
        const model = asObject(item);
        const id =
          typeof model?.["name"] === "string"
            ? model["name"]
            : typeof model?.["model"] === "string"
              ? model["model"]
              : undefined;
        return id === undefined ? undefined : { id, displayName: id };
      })
      .filter((item): item is AiModelInfo => item !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public async generate(
    request: AiRequestPreview,
  ): Promise<AiGenerationResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Ollama.");
    }
    const response = await this.options.fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: request.model,
        system: request.systemInstruction,
        prompt: request.prompt,
        format: request.outputSchema,
        stream: false,
        options: { temperature: 0 },
      }),
    });
    await requireSuccessfulResponse(response, "Ollama");
    const body = asObject(await response.json());
    if (body === undefined || typeof body["response"] !== "string") {
      throw new Error("Ollama a returnat un răspuns invalid.");
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body["response"]);
    } catch {
      throw new Error("Ollama nu a returnat JSON valid.");
    }
    const inputTokens =
      typeof body["prompt_eval_count"] === "number"
        ? body["prompt_eval_count"]
        : 0;
    const outputTokens =
      typeof body["eval_count"] === "number" ? body["eval_count"] : 0;
    return {
      provider: "ollama",
      model: request.model,
      output: validateAiOutput(request.task, parsed),
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    };
  }
}
