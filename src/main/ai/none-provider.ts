import type { AiGenerationResult } from "../../shared/ai.js";
import type { AIProvider } from "./ai-provider.js";

export class NoneAIProvider implements AIProvider {
  public readonly id = "none" as const;

  public listModels(): Promise<[]> {
    return Promise.resolve([]);
  }

  public generate(): Promise<AiGenerationResult> {
    return Promise.reject(
      new Error("Providerul AI este dezactivat. Selectează Ollama sau Gemini."),
    );
  }
}
