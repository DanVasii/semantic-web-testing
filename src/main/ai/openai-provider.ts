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

interface OpenAiProviderOptions {
  apiKey: string;
  fetch: FetchImplementation;
}

type UnknownObject = Record<string, unknown>;

const asObject = (value: unknown): UnknownObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownObject)
    : undefined;

const parseJsonText = (text: string): unknown => {
  let source = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(source);
  if (fenced?.[1] !== undefined) source = fenced[1].trim();
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(
      `OpenAI nu a returnat JSON valid.\n\nText returnat:\n${text.slice(0, 2000)}`,
    );
  }
};

const responseText = (body: UnknownObject | undefined): string => {
  const choice = asObject(
    Array.isArray(body?.["choices"]) ? body["choices"][0] : undefined,
  );
  const content = asObject(choice?.["message"])?.["content"];
  return typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .map((part) => asObject(part)?.["text"])
          .filter((value): value is string => typeof value === "string")
          .join("")
      : "";
};

const usageFrom = (body: UnknownObject | undefined) => {
  const usage = asObject(body?.["usage"]);
  const inputTokens =
    typeof usage?.["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0;
  const outputTokens =
    typeof usage?.["completion_tokens"] === "number"
      ? usage["completion_tokens"]
      : 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      typeof usage?.["total_tokens"] === "number"
        ? usage["total_tokens"]
        : inputTokens + outputTokens,
  };
};

export class OpenAiProvider implements AIProvider {
  public readonly id = "openai" as const;

  public constructor(private readonly options: OpenAiProviderOptions) {}

  private headers(): Record<string, string> {
    return {
      Accept: "application/json",
      Authorization: `Bearer ${this.options.apiKey}`,
      "Content-Type": "application/json",
    };
  }

  public async listModels(): Promise<AiModelInfo[]> {
    const response = await this.options.fetch(
      "https://api.openai.com/v1/models",
      {
        headers: this.headers(),
        signal: AbortSignal.timeout(15_000),
      },
    );
    await requireSuccessfulResponse(response, "OpenAI");
    const body = asObject(await response.json());
    if (!Array.isArray(body?.["data"])) {
      throw new Error("OpenAI a returnat o listă de modele invalidă.");
    }
    return body["data"]
      .map((item): AiModelInfo | undefined => {
        const id = asObject(item)?.["id"];
        return typeof id === "string" && /^(gpt-|o\d|chatgpt-)/i.test(id)
          ? { id, displayName: id }
          : undefined;
      })
      .filter((item): item is AiModelInfo => item !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public async generate(
    request: AiRequestPreview,
  ): Promise<AiGenerationResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model OpenAI.");
    }
    const response = await this.options.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.systemInstruction },
            { role: "user", content: request.prompt },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: `semantic_${request.task}`,
              strict: true,
              schema: request.outputSchema,
            },
          },
        }),
      },
    );
    await requireSuccessfulResponse(response, "OpenAI");
    const body = asObject(await response.json());
    const text = responseText(body);
    if (text.length === 0)
      throw new Error("OpenAI nu a returnat conținut JSON.");
    return {
      provider: "openai",
      model: request.model,
      output: validateAiOutput(request.task, parseJsonText(text)),
      usage: usageFrom(body),
    };
  }

  public async evaluateVisualCheck(
    request: AiProviderVisualCheckRequest,
  ): Promise<AiVisualCheckResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model OpenAI cu suport vision.");
    }
    const response = await this.options.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "system",
              content:
                "Ești evaluator vizual pentru teste web. Răspunzi numai cu verdict JSON și folosești exclusiv dovezi vizibile.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: visualCheckPrompt(request.prompt) },
                ...request.imagesBase64.map((base64) => ({
                  type: "image_url",
                  image_url: {
                    url: `data:${request.mimeType};base64,${base64}`,
                  },
                })),
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "semantic_visual_check",
              strict: true,
              schema: AI_VISUAL_CHECK_OUTPUT_SCHEMA,
            },
          },
        }),
      },
    );
    await requireSuccessfulResponse(response, "OpenAI");
    const body = asObject(await response.json());
    const text = responseText(body);
    if (text.length === 0)
      throw new Error("OpenAI nu a returnat verdictul vizual.");
    return validateVisualCheckOutput(
      parseJsonText(text),
      "openai",
      request.model,
      usageFrom(body),
    );
  }

  public async decideVisualAction(
    request: AiProviderVisualActionRequest,
  ): Promise<AiVisualActionResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model OpenAI cu suport vision.");
    }
    const response = await this.options.fetch(
      "https://api.openai.com/v1/chat/completions",
      {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: request.model,
          messages: [
            {
              role: "user",
              content: [
                { type: "text", text: visualActionPrompt(request) },
                {
                  type: "image_url",
                  image_url: {
                    url: `data:${request.mimeType};base64,${request.imageBase64}`,
                  },
                },
              ],
            },
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "semantic_visual_action",
              strict: true,
              schema: AI_VISUAL_ACTION_OUTPUT_SCHEMA,
            },
          },
        }),
      },
    );
    await requireSuccessfulResponse(response, "OpenAI");
    const body = asObject(await response.json());
    const content = responseText(body);
    if (content.length === 0)
      throw new Error("OpenAI nu a returnat decizia vizuală.");
    return validateVisualActionOutput(
      parseJsonText(content),
      "openai",
      request.model,
      usageFrom(body),
    );
  }
}
