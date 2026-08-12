import type {
  AiConnectionTestResult,
  AiGenerationResult,
  AiModelInfo,
  AiProviderId,
  AiRequestPreview,
  AiSettingsSummary,
  CreateAiRequestPreviewInput,
  SaveAiSettingsInput,
} from "../../shared/ai.js";
import { AI_TASKS } from "../../shared/ai.js";
import type { JsonValue } from "../../shared/persistence.js";
import type {
  ApplicationAiSettingsRecord,
  ApplicationAiSettingsRepository,
} from "../persistence/repositories.js";
import type { SecretProtector } from "../project-basic-auth-service.js";
import type { AIProvider, FetchImplementation } from "./ai-provider.js";
import { createAiRequestPreview } from "./ai-prompts.js";
import { GeminiAIProvider } from "./gemini-provider.js";
import { NoneAIProvider } from "./none-provider.js";
import { OllamaAIProvider } from "./ollama-provider.js";

export interface AiSettingsServiceOptions {
  now: () => Date;
  secrets: SecretProtector;
  fetch: FetchImplementation;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";

const defaultRecord = (): ApplicationAiSettingsRecord => ({
  provider: "none",
  ollamaBaseUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: "",
  geminiModel: "",
  updatedAt: "",
});

const isProviderId = (value: string): value is AiProviderId =>
  value === "none" || value === "ollama" || value === "gemini";

const normalizeOllamaBaseUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("URL-ul Ollama nu este valid.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error("URL-ul Ollama trebuie să fie un endpoint HTTP sau HTTPS.");
  }
  const pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/api$/, "");
  parsed.pathname = pathname;
  return parsed.toString().replace(/\/+$/, "");
};

const validateModel = (value: string, provider: string): string => {
  const model = value.trim();
  if (model.length > 200 || /[\r\n]/.test(model)) {
    throw new Error(`Modelul ${provider} nu este valid.`);
  }
  return model;
};

const isJsonValue = (
  value: unknown,
  state: { nodes: number },
  depth = 0,
): value is JsonValue => {
  state.nodes += 1;
  if (state.nodes > 100_000 || depth > 20) return false;
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item, state, depth + 1));
  }
  return (
    typeof value === "object" &&
    value !== null &&
    Object.values(value).every((item) => isJsonValue(item, state, depth + 1))
  );
};

export class AiSettingsService {
  private readonly modelCache = new Map<
    Exclude<AiProviderId, "none">,
    AiModelInfo[]
  >();
  private readonly modelLoads = new Map<
    Exclude<AiProviderId, "none">,
    Promise<AiModelInfo[]>
  >();

  public constructor(
    private readonly repository: ApplicationAiSettingsRepository,
    private readonly options: AiSettingsServiceOptions,
  ) {}

  public get(): AiSettingsSummary {
    return this.toSummary(this.repository.get() ?? defaultRecord());
  }

  public save(input: SaveAiSettingsInput): AiSettingsSummary {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.ollamaBaseUrl !== "string" ||
      typeof input.ollamaModel !== "string" ||
      typeof input.geminiModel !== "string" ||
      (input.geminiApiKey !== undefined &&
        typeof input.geminiApiKey !== "string") ||
      (input.clearGeminiApiKey !== undefined &&
        typeof input.clearGeminiApiKey !== "boolean")
    ) {
      throw new Error("Setările AI nu sunt valide.");
    }
    if (!isProviderId(input.provider)) {
      throw new Error("Providerul AI nu este valid.");
    }
    const existing = this.repository.get() ?? defaultRecord();
    const ollamaBaseUrl = normalizeOllamaBaseUrl(input.ollamaBaseUrl);
    const ollamaModel = validateModel(input.ollamaModel, "Ollama");
    const geminiModel = validateModel(input.geminiModel, "Gemini");
    const apiKey = input.geminiApiKey?.trim();
    if (apiKey !== undefined && (apiKey.length < 10 || apiKey.length > 512)) {
      throw new Error("Cheia Gemini API nu este validă.");
    }
    const encryptedGeminiApiKey =
      input.clearGeminiApiKey === true
        ? undefined
        : apiKey === undefined
          ? existing.encryptedGeminiApiKey
          : this.options.secrets.encrypt(apiKey);
    if (input.provider === "gemini" && encryptedGeminiApiKey === undefined) {
      throw new Error("Configurează cheia Gemini API înainte de activare.");
    }
    const saved: ApplicationAiSettingsRecord = {
      provider: input.provider,
      ollamaBaseUrl,
      ollamaModel,
      geminiModel,
      ...(encryptedGeminiApiKey === undefined ? {} : { encryptedGeminiApiKey }),
      updatedAt: this.options.now().toISOString(),
    };
    this.repository.save(saved);
    this.modelCache.clear();
    this.modelLoads.clear();
    return this.toSummary(saved);
  }

  public async listModels(
    providerId: Exclude<AiProviderId, "none">,
    refresh = false,
  ): Promise<AiModelInfo[]> {
    this.requireProvider(providerId);
    if (!refresh) {
      const cached = this.modelCache.get(providerId);
      if (cached !== undefined) return structuredClone(cached);
      const pending = this.modelLoads.get(providerId);
      if (pending !== undefined) return structuredClone(await pending);
    }
    const load = this.createProvider(providerId)
      .listModels()
      .then((models) => {
        this.modelCache.set(providerId, structuredClone(models));
        return models;
      })
      .finally(() => {
        if (this.modelLoads.get(providerId) === load) {
          this.modelLoads.delete(providerId);
        }
      });
    this.modelLoads.set(providerId, load);
    return structuredClone(await load);
  }

  public preloadModels(): void {
    const record = this.repository.get() ?? defaultRecord();
    const providers: Exclude<AiProviderId, "none">[] = [];
    if (record.encryptedGeminiApiKey !== undefined) providers.push("gemini");
    if (record.provider === "ollama") providers.push("ollama");
    for (const provider of providers) {
      void this.listModels(provider).catch((error: unknown) => {
        console.warn(
          `[AI][${provider}] catalogul de modele nu a putut fi preîncărcat:`,
          error instanceof Error ? error.message : error,
        );
      });
    }
  }

  public async testConnection(
    providerId: Exclude<AiProviderId, "none">,
  ): Promise<AiConnectionTestResult> {
    this.requireProvider(providerId);
    const startedAt = Date.now();
    try {
      const models = await this.listModels(providerId, true);
      return {
        provider: providerId,
        success: true,
        message:
          models.length === 0
            ? "Conexiunea funcționează, dar nu a fost găsit niciun model compatibil."
            : `Conexiune reușită. ${models.length} modele compatibile disponibile.`,
        latencyMs: Date.now() - startedAt,
        models,
      };
    } catch (error) {
      return {
        provider: providerId,
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Conexiunea AI nu a putut fi testată.",
        latencyMs: Date.now() - startedAt,
        models: [],
      };
    }
  }

  public preview(input: CreateAiRequestPreviewInput): AiRequestPreview {
    if (
      typeof input !== "object" ||
      input === null ||
      !(AI_TASKS as readonly unknown[]).includes(input.task) ||
      (input.provider !== undefined &&
        (typeof input.provider !== "string" ||
          !isProviderId(input.provider))) ||
      (input.model !== undefined &&
        (typeof input.model !== "string" ||
          input.model.length > 200 ||
          /[\r\n]/.test(input.model))) ||
      (input.outputSchema !== undefined &&
        !isJsonValue(input.outputSchema, { nodes: 0 })) ||
      !isJsonValue(input.context, { nodes: 0 })
    ) {
      throw new Error("Contextul pentru preview-ul AI nu este valid.");
    }
    return createAiRequestPreview(this.get(), input);
  }

  public async generate(
    input: CreateAiRequestPreviewInput,
  ): Promise<AiGenerationResult> {
    const preview = this.preview(input);
    if (preview.provider === "none") {
      const provider: AIProvider = new NoneAIProvider();
      return provider.generate(preview);
    }
    return this.createProvider(preview.provider).generate(preview);
  }

  private createProvider(
    providerId: Exclude<AiProviderId, "none">,
  ): AIProvider {
    const record = this.repository.get() ?? defaultRecord();
    if (providerId === "ollama") {
      return new OllamaAIProvider({
        baseUrl: record.ollamaBaseUrl,
        fetch: this.options.fetch,
      });
    }
    if (record.encryptedGeminiApiKey === undefined) {
      throw new Error("Cheia Gemini API nu este configurată.");
    }
    return new GeminiAIProvider({
      apiKey: this.options.secrets.decrypt(record.encryptedGeminiApiKey),
      fetch: this.options.fetch,
    });
  }

  private requireProvider(providerId: Exclude<AiProviderId, "none">): void {
    if (providerId !== "ollama" && providerId !== "gemini") {
      throw new Error("Providerul AI nu poate fi folosit.");
    }
  }

  private toSummary(record: ApplicationAiSettingsRecord): AiSettingsSummary {
    return {
      provider: record.provider,
      ollama: {
        baseUrl: record.ollamaBaseUrl,
        model: record.ollamaModel,
      },
      gemini: {
        model: record.geminiModel,
        apiKeyConfigured: record.encryptedGeminiApiKey !== undefined,
      },
      ...(record.updatedAt.length === 0 ? {} : { updatedAt: record.updatedAt }),
    };
  }
}
