import type {
  AiGenerationResult,
  AiVisualCheckResult,
  AiVisualActionResult,
} from "../../shared/ai.js";
import type { AIProvider } from "./ai-provider.js";

export class NoneAIProvider implements AIProvider {
  public readonly id = "none" as const;

  public listModels(): Promise<[]> {
    return Promise.resolve([]);
  }

  public generate(): Promise<AiGenerationResult> {
    return Promise.reject(
      new Error(
        "Providerul AI este dezactivat. Selectează Ollama, LM Studio sau Gemini.",
      ),
    );
  }

  public async evaluateVisualCheck(): Promise<AiVisualCheckResult> {
    return Promise.reject(
      new Error(
        "Providerul AI este dezactivat. Check-ul vizual necesită un model multimodal.",
      ),
    );
  }

  public async decideVisualAction(): Promise<AiVisualActionResult> {
    return Promise.reject(
      new Error(
        "Providerul AI este dezactivat. Acțiunea vizuală necesită un model multimodal.",
      ),
    );
  }
}
