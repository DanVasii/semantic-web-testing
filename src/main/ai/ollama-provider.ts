import type {
  AiGenerationResult,
  AiModelInfo,
  AiRequestPreview,
  AiVisualCheckResult,
  AiVisualActionResult,
} from "../../shared/ai.js";
import { validateAiOutput } from "./ai-output.js";
import {
  type AIProvider,
  AI_VISUAL_CHECK_OUTPUT_SCHEMA,
  AI_VISUAL_ACTION_OUTPUT_SCHEMA,
  type AiProviderVisualActionRequest,
  type AiProviderVisualCheckRequest,
  type FetchImplementation,
  requireSuccessfulResponse,
  validateVisualCheckOutput,
  visualCheckPrompt,
  validateVisualActionOutput,
  visualActionPrompt,
} from "./ai-provider.js";

interface OllamaProviderOptions {
  baseUrl: string;
  fetch: FetchImplementation;
}

const asObject = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const parseJsonText = (text: string): unknown => {
  let source = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  if (fenced?.[1] !== undefined) source = fenced[1].trim();
  for (let depth = 0; depth < 2; depth += 1) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(source);
    } catch {
      throw new Error(
        `Ollama nu a returnat JSON valid.\n\nText returnat:\n${text.slice(0, 2000)}`,
      );
    }
    if (typeof parsed !== "string") return parsed;
    source = parsed.trim();
  }
  throw new Error(
    `Ollama nu a returnat un obiect JSON.\n\nText returnat:\n${text.slice(0, 2000)}`,
  );
};

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
    const text = body["response"];
    const parsed = parseJsonText(text);
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

  public async evaluateVisualCheck(
    request: AiProviderVisualCheckRequest,
  ): Promise<AiVisualCheckResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Ollama cu suport vision.");
    }
    if (request.imagesBase64.length === 0) {
      throw new Error("Nu au fost furnizate imagini pentru verificare.");
    }

    const response = await this.options.fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: request.model,
        system:
          "Ești evaluator vizual pentru teste web. Răspunzi numai cu verdict JSON și folosești exclusiv dovezi vizibile.",
        prompt: visualCheckPrompt(request.prompt),
        images: request.imagesBase64,
        format: AI_VISUAL_CHECK_OUTPUT_SCHEMA,
        stream: false,
        options: { temperature: 0, num_predict: 512 },
      }),
    });
    await requireSuccessfulResponse(response, "Ollama");
    const body = asObject(await response.json());
    if (body === undefined || typeof body["response"] !== "string") {
      throw new Error("Ollama nu a returnat verdictul vizual.");
    }

    const text = body["response"];
    const usage = body;
    const inputTokens =
      typeof usage?.["prompt_eval_count"] === "number"
        ? usage["prompt_eval_count"]
        : 0;
    const outputTokens =
      typeof usage?.["eval_count"] === "number" ? usage["eval_count"] : 0;

    return validateVisualCheckOutput(
      parseJsonText(text),
      "ollama",
      request.model,
      {
        inputTokens,
        outputTokens,
        totalTokens:
          typeof usage?.["total_tokens"] === "number"
            ? usage["total_tokens"]
            : inputTokens + outputTokens,
      },
    );
  }

  public async decideVisualAction(
    request: AiProviderVisualActionRequest,
  ): Promise<AiVisualActionResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Ollama cu suport vision.");
    }
    const response = await this.options.fetch(`${this.baseUrl}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(120_000),
      body: JSON.stringify({
        model: request.model,
        prompt: visualActionPrompt(request),
        images: [request.imageBase64],
        format: AI_VISUAL_ACTION_OUTPUT_SCHEMA,
        stream: false,
        options: { temperature: 0, num_predict: 512 },
      }),
    });
    await requireSuccessfulResponse(response, "Ollama");
    const body = asObject(await response.json());
    if (typeof body?.["response"] !== "string") {
      throw new Error("Ollama nu a returnat decizia vizuală.");
    }
    const inputTokens =
      typeof body["prompt_eval_count"] === "number"
        ? body["prompt_eval_count"]
        : 0;
    const outputTokens =
      typeof body["eval_count"] === "number" ? body["eval_count"] : 0;
    return validateVisualActionOutput(
      parseJsonText(body["response"]),
      "ollama",
      request.model,
      {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
    );
  }
}
