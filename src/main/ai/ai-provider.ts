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

export const requireSuccessfulResponse = async (
  response: Response,
  providerLabel: string,
): Promise<void> => {
  if (response.ok) return;
  let detail = "";
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "error" in body &&
      typeof body.error === "object" &&
      body.error !== null &&
      "message" in body.error &&
      typeof body.error.message === "string"
    ) {
      detail = ` ${body.error.message.slice(0, 300)}`;
    }
  } catch {
    // Răspunsurile non-JSON sunt raportate doar prin codul HTTP.
  }
  throw new Error(
    `${providerLabel} a răspuns cu HTTP ${response.status}.${detail}`.trim(),
  );
};
