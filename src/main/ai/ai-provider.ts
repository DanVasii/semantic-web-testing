import type {
  AiGenerationResult,
  AiModelInfo,
  AiProviderId,
  AiRequestPreview,
  AiTokenUsage,
  AiVisualCheckResult,
  AiVisualActionResult,
} from "../../shared/ai.js";
import type { JsonValue } from "../../shared/persistence.js";

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AIProvider {
  readonly id: AiProviderId;
  listModels: () => Promise<AiModelInfo[]>;
  generate: (request: AiRequestPreview) => Promise<AiGenerationResult>;
  evaluateVisualCheck: (
    request: AiProviderVisualCheckRequest,
  ) => Promise<AiVisualCheckResult>;
  decideVisualAction: (
    request: AiProviderVisualActionRequest,
  ) => Promise<AiVisualActionResult>;
}

export interface AiProviderVisualCheckRequest {
  model: string;
  prompt: string;
  imagesBase64: string[];
  mimeType: "image/jpeg" | "image/png";
}

export interface AiProviderVisualActionRequest {
  model: string;
  instruction: string;
  imageBase64: string;
  mimeType: "image/jpeg" | "image/png";
  actionCount: number;
  maxActions: 5;
  history: Array<{
    actionNumber: number;
    x: number;
    y: number;
    observation: string;
  }>;
}

export const AI_VISUAL_ACTION_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    status: {
      type: "string",
      enum: ["click", "done", "loading", "error", "failed"],
    },
    x: { type: ["number", "null"], minimum: 0, maximum: 1 },
    y: { type: ["number", "null"], minimum: 0, maximum: 1 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    observation: { type: "string" },
  },
  required: ["status", "x", "y", "confidence", "observation"],
};

export const visualActionPrompt = (
  request: AiProviderVisualActionRequest,
): string =>
  [
    "Controlezi o interfață web exclusiv pe baza imaginii decupate primite.",
    `Obiectiv: ${request.instruction}`,
    `Au fost executate ${request.actionCount} din maximum ${request.maxActions} clickuri.`,
    request.history.length === 0
      ? "Nu există clickuri anterioare."
      : `Istoric: ${JSON.stringify(request.history)}`,
    "Alege exact una: click, done, loading, error sau failed.",
    "Pentru click, x și y sunt coordonate normalizate între 0 și 1 în imagine. Clickul trebuie să fie în centrul controlului dorit.",
    "Folosește loading dacă vezi un spinner, skeleton, overlay de încărcare sau conținut care este evident în curs de actualizare. Nu propune click în această stare.",
    "Folosește error dacă pagina afișează o eroare relevantă pentru obiectiv (mesaj de eroare, request eșuat, indisponibilitate sau stare invalidă). Descrie exact eroarea vizibilă în observation.",
    "Folosește done numai dacă obiectivul este vizibil îndeplinit. Folosește failed dacă obiectivul nu poate fi realizat din zona primită ori nu mai sunt clickuri disponibile, fără să existe o eroare vizibilă explicită.",
    "Returnează JSON strict cu status, x, y, confidence și observation. Pentru done/loading/error/failed, x și y trebuie să fie null.",
  ].join("\n");

export const validateVisualActionOutput = (
  value: unknown,
  provider: Exclude<AiProviderId, "none">,
  model: string,
  usage: AiTokenUsage,
): AiVisualActionResult => {
  const output = asRecord(value);
  const status = output?.["status"];
  const x = output?.["x"];
  const y = output?.["y"];
  const confidence = output?.["confidence"];
  const observation = output?.["observation"];
  if (
    !["click", "done", "loading", "error", "failed"].includes(String(status)) ||
    typeof confidence !== "number" ||
    confidence < 0 ||
    confidence > 1 ||
    typeof observation !== "string" ||
    observation.length === 0 ||
    observation.length > 2000 ||
    (status === "click" &&
      (typeof x !== "number" ||
        x < 0 ||
        x > 1 ||
        typeof y !== "number" ||
        y < 0 ||
        y > 1)) ||
    (status !== "click" && (x !== null || y !== null))
  ) {
    throw new Error("AI a returnat o decizie vizuală invalidă.");
  }
  return {
    provider,
    model,
    status: status as AiVisualActionResult["status"],
    ...(status === "click" ? { x: x as number, y: y as number } : {}),
    confidence,
    observation,
    usage,
  };
};

export const AI_VISUAL_CHECK_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    passed: { type: "boolean" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    explanation: { type: "string" },
    evidence: {
      type: "array",
      maxItems: 10,
      items: { type: "string" },
    },
  },
  required: ["passed", "confidence", "explanation", "evidence"],
};

export const visualCheckPrompt = (prompt: string): string =>
  [
    "Evaluează captura completă a paginii exact în momentul acestui pas de test.",
    "Din cauza limitărilor de dimensiune, pagina web îți este trimisă sub forma unui set de mai multe imagini parțiale (scroll de sus în jos). Trebuie să le analizezi pe toate.",
    "Dacă cerința este vizibilă și îndeplinită în MĂCAR UNA dintre imagini, consideră testul ca fiind trecut (passed=true). Nu te lăsa indus în eroare dacă în celelalte imagini nu apare informația.",
    `Cerință: ${prompt}`,
    "Folosește numai dovezi vizibile în imagini. Nu presupune stări ascunse, request-uri sau date care nu pot fi observate.",
    "Doar dacă absolut NICIO imagine nu oferă dovezi suficiente, verdictul trebuie să fie passed=false.",
    "Returnează JSON strict cu passed (obligatoriu prima cheie), confidence între 0 și 1, explanation și evidence (fragmente vizuale scurte).",
  ].join("\n");

export const validateVisualCheckOutput = (
  value: unknown,
  provider: Exclude<AiProviderId, "none">,
  model: string,
  usage: AiTokenUsage,
): AiVisualCheckResult => {
  const output = asRecord(value);
  if (
    output === undefined ||
    typeof output["passed"] !== "boolean" ||
    typeof output["confidence"] !== "number" ||
    output["confidence"] < 0 ||
    output["confidence"] > 1 ||
    typeof output["explanation"] !== "string" ||
    output["explanation"].length === 0 ||
    output["explanation"].length > 4000 ||
    !Array.isArray(output["evidence"]) ||
    output["evidence"].length > 10 ||
    !output["evidence"].every(
      (entry) => typeof entry === "string" && entry.length <= 1000,
    )
  ) {
    throw new Error("AI a returnat un verdict vizual invalid.");
  }
  return {
    provider,
    model,
    passed: output["passed"],
    confidence: output["confidence"],
    explanation: output["explanation"],
    evidence: output["evidence"] as string[],
    usage,
  };
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

const readFieldViolationDetails = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): string[] => {
    const fieldViolations = asRecord(item)?.["fieldViolations"];
    if (!Array.isArray(fieldViolations)) return [];
    return fieldViolations.flatMap((violation): string[] => {
      const entry = asRecord(violation);
      if (entry === undefined) return [];
      const field = typeof entry["field"] === "string" ? entry["field"] : "";
      const description =
        typeof entry["description"] === "string" ? entry["description"] : "";
      const message = [field, description].filter(Boolean).join(": ");
      return message.length === 0 ? [] : [message];
    });
  });
};

export const requireSuccessfulResponse = async (
  response: Response,
  providerLabel: string,
): Promise<void> => {
  if (response.ok) return;
  let detail = "";
  try {
    const text = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      // Not JSON
    }
    const error = asRecord(asRecord(body)?.["error"]);
    const message = error?.["message"];
    if (typeof message === "string") {
      detail = ` ${message.slice(0, 1000)}`;
      const violations = readFieldViolationDetails(error?.["details"]);
      if (violations.length > 0) {
        detail += ` Detalii: ${violations.join("; ").slice(0, 1000)}`;
      }
    } else if (text.trim().length > 0) {
      detail = ` Mesaj brut: ${text.slice(0, 2000)}`;
    }
  } catch {
    // If text() fails
  }
  throw new Error(
    `${providerLabel} a răspuns cu HTTP ${response.status}.${detail}`.trim(),
  );
};
