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

interface GeminiProviderOptions {
  apiKey: string;
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
        `Gemini nu a returnat JSON valid.\n\nText returnat:\n${text.slice(0, 2000)}`,
      );
    }
    if (typeof parsed !== "string") return parsed;
    source = parsed.trim();
  }
  throw new Error(
    `Gemini nu a returnat un obiect JSON.\n\nText returnat:\n${text.slice(0, 2000)}`,
  );
};

const visualActionThinkingConfig = (
  model: string,
): UnknownObject | undefined => {
  if (/^gemini-3(?:\.|-|$)/i.test(model)) {
    return { thinkingLevel: "LOW" };
  }
  if (/^gemini-2\.5-pro(?:-|$)/i.test(model)) {
    return { thinkingBudget: 128 };
  }
  if (/^gemini-2\.5(?:\.|-|$)/i.test(model)) {
    return { thinkingBudget: 0 };
  }
  return undefined;
};

const geminiCandidateText = (body: UnknownObject | undefined): string => {
  const candidates = Array.isArray(body?.["candidates"])
    ? body["candidates"]
    : [];
  const parts = asObject(asObject(candidates[0])?.["content"])?.["parts"];
  return Array.isArray(parts)
    ? parts
        .filter((part) => asObject(part)?.["thought"] !== true)
        .map((part) => asObject(part)?.["text"])
        .filter((value): value is string => typeof value === "string")
        .join("")
    : "";
};

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
    const endpoint = `${this.endpoint}/models/${encodeURIComponent(
      model,
    )}:generateContent`;
    const send = (withSchema: boolean): Promise<Response> =>
      this.options.fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: request.systemInstruction }],
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: withSchema ? request.prompt : fallbackPrompt(request) },
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: "application/json",
            ...(withSchema ? { responseJsonSchema: request.outputSchema } : {}),
          },
        }),
      });
    let response = await send(true);
    if (!response.ok && response.status === 400) {
      response = await send(false);
    }
    await requireSuccessfulResponse(response, "Gemini");
    const body = asObject(await response.json());
    const candidates = Array.isArray(body?.["candidates"])
      ? body["candidates"]
      : [];
    const candidate = asObject(candidates[0]);
    const content = asObject(candidate?.["content"]);
    const parts = Array.isArray(content?.["parts"]) ? content["parts"] : [];
    const text = parts
      .map((part) => asObject(part))
      .filter((part) => part?.["thought"] !== true)
      .map((part) => part?.["text"])
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (text.length === 0) {
      throw new Error("Gemini nu a returnat conținut JSON.");
    }
    console.info(
      `[AI][Gemini][${request.task}] răspuns brut:\n${text.slice(0, 50_000)}`,
    );
    const parsed = parseJsonText(text);
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

  public async evaluateVisualCheck(
    request: AiProviderVisualCheckRequest,
  ): Promise<AiVisualCheckResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Gemini multimodal.");
    }
    const model = request.model.replace(/^models\//, "");
    const endpoint = `${this.endpoint}/models/${encodeURIComponent(
      model,
    )}:generateContent`;
    const send = (withSchema: boolean): Promise<Response> =>
      this.options.fetch(endpoint, {
        method: "POST",
        headers: this.headers(),
        signal: AbortSignal.timeout(120_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [
              {
                text: "Ești evaluator vizual pentru teste web. Răspunzi exclusiv cu verdict JSON și nu inventezi dovezi absente din captură.",
              },
            ],
          },
          contents: [
            {
              role: "user",
              parts: [
                { text: visualCheckPrompt(request.prompt) },
                ...request.imagesBase64.map((base64) => ({
                  inlineData: {
                    mimeType: request.mimeType,
                    data: base64,
                  },
                })),
              ],
            },
          ],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 2048,
            responseMimeType: "application/json",
            ...(withSchema
              ? { responseJsonSchema: AI_VISUAL_CHECK_OUTPUT_SCHEMA }
              : {}),
          },
        }),
      });
    let response = await send(true);
    if (!response.ok && response.status === 400) response = await send(false);
    await requireSuccessfulResponse(response, "Gemini");
    const body = asObject(await response.json());
    const candidates = Array.isArray(body?.["candidates"])
      ? body["candidates"]
      : [];
    const content = asObject(asObject(candidates[0])?.["content"]);
    const parts = Array.isArray(content?.["parts"]) ? content["parts"] : [];
    const text = parts
      .map((part) => asObject(part)?.["text"])
      .filter((value): value is string => typeof value === "string")
      .join("");
    if (text.length === 0) {
      throw new Error("Gemini nu a returnat verdictul vizual.");
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

    let parsed: unknown;
    try {
      parsed = parseJsonText(text);
    } catch (error) {
      const match = /"passed"\s*:\s*(true|false)/i.exec(text);
      if (match && match[1]) {
        parsed = {
          passed: match[1].toLowerCase() === "true",
          confidence: 0,
          explanation: "Răspuns parțial (trunchiat de limitele API).",
          evidence: [],
        };
      } else {
        throw error;
      }
    }

    return validateVisualCheckOutput(parsed, "gemini", model, {
      inputTokens,
      outputTokens,
      totalTokens:
        typeof usage?.["totalTokenCount"] === "number"
          ? usage["totalTokenCount"]
          : inputTokens + outputTokens,
    });
  }

  public async decideVisualAction(
    request: AiProviderVisualActionRequest,
  ): Promise<AiVisualActionResult> {
    if (request.model.trim().length === 0) {
      throw new Error("Selectează un model Gemini multimodal.");
    }
    const model = request.model.replace(/^models\//, "");
    const send = async (maxOutputTokens: number): Promise<UnknownObject> => {
      const thinkingConfig = visualActionThinkingConfig(model);
      const response = await this.options.fetch(
        `${this.endpoint}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: "POST",
          headers: this.headers(),
          signal: AbortSignal.timeout(120_000),
          body: JSON.stringify({
            contents: [
              {
                role: "user",
                parts: [
                  { text: visualActionPrompt(request) },
                  {
                    inlineData: {
                      mimeType: request.mimeType,
                      data: request.imageBase64,
                    },
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0,
              maxOutputTokens,
              responseMimeType: "application/json",
              responseJsonSchema: AI_VISUAL_ACTION_OUTPUT_SCHEMA,
              ...(thinkingConfig === undefined ? {} : { thinkingConfig }),
            },
          }),
        },
      );
      await requireSuccessfulResponse(response, "Gemini");
      return asObject(await response.json()) ?? {};
    };

    let body = await send(4_096);
    let text = geminiCandidateText(body);
    if (text.length === 0)
      throw new Error("Gemini nu a returnat decizia vizuală.");
    let parsed: unknown;
    try {
      parsed = parseJsonText(text);
    } catch (initialError) {
      const candidate = asObject(
        Array.isArray(body["candidates"]) ? body["candidates"][0] : undefined,
      );
      console.warn("[AI][Gemini][visual_action] răspuns incomplet; retry", {
        finishReason: candidate?.["finishReason"],
        text: text.slice(0, 500),
        error:
          initialError instanceof Error
            ? initialError.message
            : String(initialError),
      });
      body = await send(8_192);
      text = geminiCandidateText(body);
      if (text.length === 0) {
        throw new Error("Gemini nu a returnat decizia vizuală după retry.", {
          cause: initialError,
        });
      }
      parsed = parseJsonText(text);
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
    return validateVisualActionOutput(parsed, "gemini", model, {
      inputTokens,
      outputTokens,
      totalTokens:
        typeof usage?.["totalTokenCount"] === "number"
          ? usage["totalTokenCount"]
          : inputTokens + outputTokens,
    });
  }
}
