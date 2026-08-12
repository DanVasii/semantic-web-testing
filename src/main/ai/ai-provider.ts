import type {
  AiGenerationResult,
  AiModelInfo,
  AiProviderId,
  AiRequestPreview,
} from "../../shared/ai.js";

export type FetchImplementation = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface AIProvider {
  readonly id: AiProviderId;
  listModels: () => Promise<AiModelInfo[]>;
  generate: (request: AiRequestPreview) => Promise<AiGenerationResult>;
}

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
    const body: unknown = await response.json();
    const error = asRecord(asRecord(body)?.["error"]);
    const message = error?.["message"];
    if (typeof message === "string") {
      detail = ` ${message.slice(0, 300)}`;
      const violations = readFieldViolationDetails(error?.["details"]);
      if (violations.length > 0) {
        detail += ` Detalii: ${violations.join("; ").slice(0, 500)}`;
      }
    }
  } catch {
    // Răspunsurile non-JSON sunt raportate doar prin codul HTTP.
  }
  throw new Error(
    `${providerLabel} a răspuns cu HTTP ${response.status}.${detail}`.trim(),
  );
};
