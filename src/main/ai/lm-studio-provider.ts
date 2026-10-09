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

interface LmStudioProviderOptions {
  baseUrl: string;
  fetch: FetchImplementation;
}

type UnknownObject = Record<string, unknown>;

const asObject = (value: unknown): UnknownObject | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as UnknownObject)
    : undefined;

const fallbackPrompt = (request: AiRequestPreview): string =>
  [
    request.prompt,
    "Schema JSON exactă pe care trebuie să o respecți este:",
    JSON.stringify(request.outputSchema),
    "Returnează numai obiectul JSON, fără Markdown, explicații sau proprietăți suplimentare.",
  ].join("\n\n");

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
        `LM Studio nu a returnat JSON valid.\n\nText returnat:\n${text.slice(0, 2000)}`,
      );
    }
    if (typeof parsed !== "string") return parsed;
    source = parsed.trim();
  }
  throw new Error(
    `LM Studio nu a returnat un obiect JSON.\n\nText returnat:\n${text.slice(0, 2000)}`,
  );
};

export class LmStudioAIProvider implements AIProvider {
  public readonly id = "lm_studio" as const;
  private readonly baseUrl: string;

  public constructor(private readonly options: LmStudioProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
  }

  public async listModels(): Promise<AiModelInfo[]> {
    const response = await this.options.fetch(`${this.baseUrl}/v1/models`, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    });
    await requireSuccessfulResponse(response, "LM Studio");
    const body = asObject(await response.json());
    if (body === undefined || !Array.isArray(body["data"])) {
      throw new Error("LM Studio a returnat o listă de modele invalidă.");
    }
    return body["data"]
      .map((item): AiModelInfo | undefined => {
        const model = asObject(item);
        const id = typeof model?.["id"] === "string" ? model["id"] : undefined;
        return id === undefined ? undefined : { id, displayName: id };
      })
      .filter((item): item is AiModelInfo => item !== undefined)
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  public async generate(
    request: AiRequestPreview,
  ): Promise<AiGenerationResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model LM Studio.");
    }
    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const send = (withSchema: boolean): Promise<Response> =>
      this.options.fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          model: request.model,
          messages: [
            { role: "system", content: request.systemInstruction },
            {
              role: "user",
              content: withSchema ? request.prompt : fallbackPrompt(request),
            },
          ],
          temperature: 0,
          stream: false,
          ...(withSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: `semantic_${request.task}`,
                    strict: true,
                    schema: request.outputSchema,
                  },
                },
              }
            : {}),
        }),
      });

    let response = await send(true);
    if (!response.ok && response.status === 400) {
      response = await send(false);
    }
    await requireSuccessfulResponse(response, "LM Studio");
    const body = asObject(await response.json());
    const choices = Array.isArray(body?.["choices"]) ? body["choices"] : [];
    const choice = asObject(choices[0]);
    const message = asObject(choice?.["message"]);
    const content = message?.["content"];
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => asObject(part)?.["text"])
              .filter((value): value is string => typeof value === "string")
              .join("")
          : "";
    if (text.length === 0) {
      throw new Error("LM Studio nu a returnat conținut JSON.");
    }
    const usage = asObject(body?.["usage"]);
    const inputTokens =
      typeof usage?.["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0;
    const outputTokens =
      typeof usage?.["completion_tokens"] === "number"
        ? usage["completion_tokens"]
        : 0;
    const totalTokens =
      typeof usage?.["total_tokens"] === "number"
        ? usage["total_tokens"]
        : inputTokens + outputTokens;
    return {
      provider: "lm_studio",
      model: request.model,
      output: validateAiOutput(request.task, parseJsonText(text)),
      usage: { inputTokens, outputTokens, totalTokens },
    };
  }

  public async evaluateVisualCheck(
    request: AiProviderVisualCheckRequest,
  ): Promise<AiVisualCheckResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează în LM Studio un model cu suport vision.");
    }
    if (request.imagesBase64.length === 0) {
      throw new Error("Nu au fost furnizate imagini pentru verificare.");
    }

    const endpoint = `${this.baseUrl}/v1/chat/completions`;
    const send = (withSchema: boolean): Promise<Response> =>
      this.options.fetch(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
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
          temperature: 0,
          max_tokens: 1_024,
          stream: false,
          ...(withSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "semantic_visual_check",
                    strict: true,
                    schema: AI_VISUAL_CHECK_OUTPUT_SCHEMA,
                  },
                },
              }
            : {}),
        }),
      });

    let response = await send(true);
    if (!response.ok && response.status === 400) response = await send(false);
    await requireSuccessfulResponse(response, "LM Studio");
    const body = asObject(await response.json());
    const choice = asObject(
      Array.isArray(body?.["choices"]) ? body["choices"][0] : undefined,
    );
    const content = asObject(choice?.["message"])?.["content"];
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((part) => asObject(part)?.["text"])
              .filter((value): value is string => typeof value === "string")
              .join("")
          : "";
    if (text.length === 0) {
      throw new Error("LM Studio nu a returnat verdictul vizual.");
    }
    const usage = asObject(body?.["usage"]);
    const inputTokens =
      typeof usage?.["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0;
    const outputTokens =
      typeof usage?.["completion_tokens"] === "number"
        ? usage["completion_tokens"]
        : 0;

    return validateVisualCheckOutput(
      parseJsonText(text),
      "lm_studio",
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
      throw new Error("Selectează în LM Studio un model cu suport vision.");
    }
    const response = await this.options.fetch(
      `${this.baseUrl}/v1/chat/completions`,
      {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
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
          temperature: 0,
          stream: false,
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
    await requireSuccessfulResponse(response, "LM Studio");
    const body = asObject(await response.json());
    const choice = asObject(
      Array.isArray(body?.["choices"]) ? body["choices"][0] : undefined,
    );
    const content = asObject(choice?.["message"])?.["content"];
    if (typeof content !== "string" || content.length === 0) {
      throw new Error("LM Studio nu a returnat decizia vizuală.");
    }
    const usage = asObject(body?.["usage"]);
    const inputTokens =
      typeof usage?.["prompt_tokens"] === "number" ? usage["prompt_tokens"] : 0;
    const outputTokens =
      typeof usage?.["completion_tokens"] === "number"
        ? usage["completion_tokens"]
        : 0;
    return validateVisualActionOutput(
      parseJsonText(content),
      "lm_studio",
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
}
