import type {
  AiConnectionTestResult,
  AiGenerationResult,
  AiModelInfo,
  AiModelPricing,
  AiProviderId,
  AiRequestPreview,
  AiSettingsSummary,
  AiVisualCheckInput,
  AiVisualCheckResult,
  AiVisualActionInput,
  AiVisualActionResult,
  CreateAiRequestPreviewInput,
  SaveAiSettingsInput,
  SaveAiModelPricingInput,
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
import { LmStudioAIProvider } from "./lm-studio-provider.js";
import { NoneAIProvider } from "./none-provider.js";
import { OllamaAIProvider } from "./ollama-provider.js";
import { OpenAiProvider } from "./openai-provider.js";

export interface AiSettingsServiceOptions {
  now: () => Date;
  secrets: SecretProtector;
  fetch: FetchImplementation;
}

const DEFAULT_OLLAMA_URL = "http://127.0.0.1:11434";
const DEFAULT_LM_STUDIO_URL = "http://127.0.0.1:1234";
const MODEL_PRICING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LITELLM_CATALOG_URL = "https://api.litellm.ai/model_catalog";

type UnknownObject = Record<string, unknown>;

const asObject = (value: unknown): UnknownObject | undefined =>
  typeof value === "object" && value !== null
    ? (value as UnknownObject)
    : undefined;

const finiteNonNegative = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

const normalizeCatalogModelId = (
  provider: "gemini" | "openai",
  value: string,
) =>
  value
    .trim()
    .toLowerCase()
    .replace(/^models\//, "")
    .replace(new RegExp(`^${provider}/`), "");

const defaultRecord = (): ApplicationAiSettingsRecord => ({
  provider: "none",
  ollamaBaseUrl: DEFAULT_OLLAMA_URL,
  ollamaModel: "",
  lmStudioBaseUrl: DEFAULT_LM_STUDIO_URL,
  lmStudioModel: "",
  geminiModel: "",
  openaiModel: "",
  updatedAt: "",
});

const isProviderId = (value: string): value is AiProviderId =>
  value === "none" ||
  value === "ollama" ||
  value === "lm_studio" ||
  value === "gemini" ||
  value === "openai";

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

const normalizeLmStudioBaseUrl = (value: string): string => {
  let parsed: URL;
  try {
    parsed = new URL(value.trim());
  } catch {
    throw new Error("URL-ul LM Studio nu este valid.");
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username.length > 0 ||
    parsed.password.length > 0 ||
    parsed.search.length > 0 ||
    parsed.hash.length > 0
  ) {
    throw new Error(
      "URL-ul LM Studio trebuie să fie un endpoint HTTP sau HTTPS.",
    );
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "").replace(/\/v1$/, "");
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
      typeof input.lmStudioBaseUrl !== "string" ||
      typeof input.lmStudioModel !== "string" ||
      typeof input.geminiModel !== "string" ||
      (input.openaiModel !== undefined &&
        typeof input.openaiModel !== "string") ||
      (input.geminiApiKey !== undefined &&
        typeof input.geminiApiKey !== "string") ||
      (input.clearGeminiApiKey !== undefined &&
        typeof input.clearGeminiApiKey !== "boolean") ||
      (input.openaiApiKey !== undefined &&
        typeof input.openaiApiKey !== "string") ||
      (input.clearOpenaiApiKey !== undefined &&
        typeof input.clearOpenaiApiKey !== "boolean")
    ) {
      throw new Error("Setările AI nu sunt valide.");
    }
    if (!isProviderId(input.provider)) {
      throw new Error("Providerul AI nu este valid.");
    }
    const existing = this.repository.get() ?? defaultRecord();
    const ollamaBaseUrl = normalizeOllamaBaseUrl(input.ollamaBaseUrl);
    const ollamaModel = validateModel(input.ollamaModel, "Ollama");
    const lmStudioBaseUrl = normalizeLmStudioBaseUrl(input.lmStudioBaseUrl);
    const lmStudioModel = validateModel(input.lmStudioModel, "LM Studio");
    const geminiModel = validateModel(input.geminiModel, "Gemini");
    const openaiModel = validateModel(
      input.openaiModel ?? existing.openaiModel,
      "OpenAI",
    );
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
    const openaiApiKey = input.openaiApiKey?.trim();
    if (
      openaiApiKey !== undefined &&
      (openaiApiKey.length < 10 || openaiApiKey.length > 512)
    ) {
      throw new Error("Cheia OpenAI API nu este validă.");
    }
    const encryptedOpenaiApiKey =
      input.clearOpenaiApiKey === true
        ? undefined
        : openaiApiKey === undefined
          ? existing.encryptedOpenaiApiKey
          : this.options.secrets.encrypt(openaiApiKey);
    if (input.provider === "gemini" && encryptedGeminiApiKey === undefined) {
      throw new Error("Configurează cheia Gemini API înainte de activare.");
    }
    if (input.provider === "openai" && encryptedOpenaiApiKey === undefined) {
      throw new Error("Configurează cheia OpenAI API înainte de activare.");
    }
    const saved: ApplicationAiSettingsRecord = {
      provider: input.provider,
      ollamaBaseUrl,
      ollamaModel,
      lmStudioBaseUrl,
      lmStudioModel,
      geminiModel,
      ...(encryptedGeminiApiKey === undefined ? {} : { encryptedGeminiApiKey }),
      openaiModel,
      ...(encryptedOpenaiApiKey === undefined ? {} : { encryptedOpenaiApiKey }),
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

  public async getModelPricing(
    provider: "gemini" | "openai",
    modelInput: string,
  ): Promise<AiModelPricing> {
    if (
      (provider !== "gemini" && provider !== "openai") ||
      typeof modelInput !== "string"
    ) {
      throw new Error("Modelul pentru prețuri nu este valid.");
    }
    const model = validateModel(modelInput, provider);
    if (model.length === 0) {
      throw new Error("Selectează un model înainte de a încărca prețurile.");
    }
    const cached = this.repository.getModelPricing(provider, model);
    const now = this.options.now();
    if (cached !== undefined && Date.parse(cached.expiresAt) > now.getTime()) {
      return { status: "available", ...cached };
    }

    try {
      const entry = await this.fetchLiteLlmPricing(provider, model);
      if (entry === undefined) {
        return this.unavailablePricing(
          provider,
          model,
          "Modelul nu a fost găsit în catalogul LiteLLM.",
          cached,
        );
      }
      const inputPerMillionUsd = finiteNonNegative(
        entry["input_cost_per_token"],
      );
      const outputPerMillionUsd = finiteNonNegative(
        entry["output_cost_per_token"],
      );
      if (
        inputPerMillionUsd === undefined ||
        outputPerMillionUsd === undefined
      ) {
        return this.unavailablePricing(
          provider,
          model,
          "Catalogul LiteLLM nu conține ambele prețuri necesare pentru acest model.",
          cached,
        );
      }
      const cachedInput = finiteNonNegative(
        entry["cache_read_input_token_cost"],
      );
      const fetchedAt = now.toISOString();
      const record = this.repository.saveModelPricing({
        provider,
        model,
        source: "litellm",
        inputPerMillionUsd: inputPerMillionUsd * 1_000_000,
        outputPerMillionUsd: outputPerMillionUsd * 1_000_000,
        ...(cachedInput === undefined
          ? {}
          : { cachedInputPerMillionUsd: cachedInput * 1_000_000 }),
        matchedModelId: String(entry["id"]),
        fetchedAt,
        expiresAt: new Date(now.getTime() + MODEL_PRICING_TTL_MS).toISOString(),
      });
      return { status: "available", ...record };
    } catch (error) {
      return this.unavailablePricing(
        provider,
        model,
        error instanceof Error
          ? `Prețurile LiteLLM nu au putut fi încărcate: ${error.message}`
          : "Prețurile LiteLLM nu au putut fi încărcate.",
        cached,
      );
    }
  }

  public saveModelPricing(input: SaveAiModelPricingInput): AiModelPricing {
    if (
      typeof input !== "object" ||
      input === null ||
      (input.provider !== "gemini" && input.provider !== "openai") ||
      typeof input.model !== "string" ||
      (input.inputPerMillionUsd !== undefined &&
        typeof input.inputPerMillionUsd !== "number") ||
      (input.outputPerMillionUsd !== undefined &&
        typeof input.outputPerMillionUsd !== "number")
    ) {
      throw new Error("Prețurile manuale nu sunt valide.");
    }
    const model = validateModel(input.model, input.provider);
    const inputPrice = input.inputPerMillionUsd;
    const outputPrice = input.outputPerMillionUsd;
    for (const value of [inputPrice, outputPrice]) {
      if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
        throw new Error("Prețurile trebuie să fie numere pozitive sau zero.");
      }
    }
    if (
      model.length === 0 ||
      (inputPrice === undefined && outputPrice === undefined)
    ) {
      throw new Error("Completează cel puțin unul dintre prețurile opționale.");
    }
    const now = this.options.now();
    const record = this.repository.saveModelPricing({
      provider: input.provider,
      model,
      source: "manual",
      ...(inputPrice === undefined ? {} : { inputPerMillionUsd: inputPrice }),
      ...(outputPrice === undefined
        ? {}
        : { outputPerMillionUsd: outputPrice }),
      fetchedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + MODEL_PRICING_TTL_MS).toISOString(),
    });
    return { status: "available", ...record };
  }

  public estimateCachedUsageCost(
    provider: Exclude<AiProviderId, "none">,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
  ): number | undefined {
    if (provider === "ollama" || provider === "lm_studio") return 0;
    const pricing = this.repository.getModelPricing(provider, model);
    if (
      pricing === undefined ||
      Date.parse(pricing.expiresAt) <= this.options.now().getTime() ||
      pricing.inputPerMillionUsd === undefined ||
      pricing.outputPerMillionUsd === undefined
    ) {
      return undefined;
    }
    return (
      (usage.inputTokens * pricing.inputPerMillionUsd +
        usage.outputTokens * pricing.outputPerMillionUsd) /
      1_000_000
    );
  }

  public preloadModels(): void {
    const record = this.repository.get() ?? defaultRecord();
    const providers: Exclude<AiProviderId, "none">[] = [];
    if (record.encryptedGeminiApiKey !== undefined) providers.push("gemini");
    if (record.encryptedOpenaiApiKey !== undefined) providers.push("openai");
    if (record.provider === "ollama") providers.push("ollama");
    if (record.provider === "lm_studio") providers.push("lm_studio");
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

  public async evaluateVisualCheck(
    input: AiVisualCheckInput,
  ): Promise<AiVisualCheckResult> {
    const prompt = input.prompt.trim();
    if (
      prompt.length < 3 ||
      prompt.length > 4000 ||
      !["image/jpeg", "image/png"].includes(input.mimeType) ||
      !Array.isArray(input.imagesBase64) ||
      input.imagesBase64.length === 0 ||
      !input.imagesBase64.every(
        (img) =>
          typeof img === "string" &&
          img.length > 0 &&
          /^[A-Za-z0-9+/]+={0,2}$/.test(img),
      ) ||
      input.imagesBase64.reduce((sum, img) => sum + img.length, 0) > 100_000_000
    ) {
      throw new Error("Cererea pentru verificarea vizuală nu este validă.");
    }
    const settings = this.get();
    const providerId = input.aiProvider || settings.provider;
    if (providerId === "none") {
      throw new Error(
        "Activează un provider AI și selectează un model cu suport vision pentru verificarea vizuală.",
      );
    }
    const model =
      input.aiModel ||
      (providerId === "ollama"
        ? settings.ollama.model
        : providerId === "lm_studio"
          ? settings.lmStudio.model
          : providerId === "gemini"
            ? settings.gemini.model
            : settings.openai.model);
    if (model.trim().length === 0) {
      throw new Error(
        "Selectează un model cu suport vision în setările providerului AI activ.",
      );
    }
    return this.createProvider(providerId).evaluateVisualCheck({
      prompt,
      model,
      imagesBase64: input.imagesBase64,
      mimeType: input.mimeType,
    });
  }

  public async decideVisualAction(
    input: AiVisualActionInput,
  ): Promise<AiVisualActionResult> {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.instruction !== "string" ||
      input.instruction.trim().length < 3 ||
      input.instruction.length > 4000 ||
      typeof input.imageBase64 !== "string" ||
      input.imageBase64.length === 0 ||
      input.imageBase64.length > 20_000_000 ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(input.imageBase64) ||
      !["image/jpeg", "image/png"].includes(input.mimeType) ||
      !Number.isInteger(input.actionCount) ||
      input.actionCount < 0 ||
      input.actionCount > 5 ||
      input.maxActions !== 5 ||
      !Array.isArray(input.history) ||
      input.history.length > 5
    ) {
      throw new Error("Cererea acțiunii vizuale nu este validă.");
    }
    const settings = this.get();
    const providerId = input.aiProvider ?? settings.provider;
    if (providerId === "none") {
      throw new Error("Activează un provider AI pentru acțiunea vizuală.");
    }
    const model =
      input.aiModel ||
      (providerId === "ollama"
        ? settings.ollama.model
        : providerId === "lm_studio"
          ? settings.lmStudio.model
          : providerId === "gemini"
            ? settings.gemini.model
            : settings.openai.model);
    if (model.trim().length === 0) {
      throw new Error("Selectează un model cu suport vision.");
    }
    return this.createProvider(providerId).decideVisualAction({
      model,
      instruction: input.instruction.trim(),
      imageBase64: input.imageBase64,
      mimeType: input.mimeType,
      actionCount: input.actionCount,
      maxActions: 5,
      history: input.history,
    });
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
    if (providerId === "lm_studio") {
      return new LmStudioAIProvider({
        baseUrl: record.lmStudioBaseUrl,
        fetch: this.options.fetch,
      });
    }
    if (providerId === "openai") {
      if (record.encryptedOpenaiApiKey === undefined) {
        throw new Error("Cheia OpenAI API nu este configurată.");
      }
      return new OpenAiProvider({
        apiKey: this.options.secrets.decrypt(record.encryptedOpenaiApiKey),
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

  private async fetchLiteLlmPricing(
    provider: "gemini" | "openai",
    model: string,
  ): Promise<UnknownObject | undefined> {
    const wanted = normalizeCatalogModelId(provider, model);
    for (let page = 1; page <= 20; page += 1) {
      const url = new URL(LITELLM_CATALOG_URL);
      url.searchParams.set("provider", provider);
      url.searchParams.set("page_size", "100");
      url.searchParams.set("page", String(page));
      const response = await this.options.fetch(url, {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const body = asObject(await response.json());
      const data = Array.isArray(body?.["data"]) ? body["data"] : [];
      const match = data.map(asObject).find((entry) => {
        const id = entry?.["id"];
        return (
          typeof id === "string" &&
          normalizeCatalogModelId(provider, id) === wanted
        );
      });
      if (match !== undefined) return match;
      if (body?.["has_more"] !== true) return undefined;
    }
    return undefined;
  }

  private unavailablePricing(
    provider: "gemini" | "openai",
    model: string,
    message: string,
    cached: ReturnType<ApplicationAiSettingsRepository["getModelPricing"]>,
  ): AiModelPricing {
    return {
      provider,
      model,
      status: "unavailable",
      message,
      ...(cached?.source === "manual" && cached.inputPerMillionUsd !== undefined
        ? { staleManualInputPerMillionUsd: cached.inputPerMillionUsd }
        : {}),
      ...(cached?.source === "manual" &&
      cached.outputPerMillionUsd !== undefined
        ? { staleManualOutputPerMillionUsd: cached.outputPerMillionUsd }
        : {}),
    };
  }

  private requireProvider(providerId: Exclude<AiProviderId, "none">): void {
    if (
      providerId !== "ollama" &&
      providerId !== "lm_studio" &&
      providerId !== "gemini" &&
      providerId !== "openai"
    ) {
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
      lmStudio: {
        baseUrl: record.lmStudioBaseUrl,
        model: record.lmStudioModel,
      },
      gemini: {
        model: record.geminiModel,
        apiKeyConfigured: record.encryptedGeminiApiKey !== undefined,
      },
      openai: {
        model: record.openaiModel,
        apiKeyConfigured: record.encryptedOpenaiApiKey !== undefined,
      },
      ...(record.updatedAt.length === 0 ? {} : { updatedAt: record.updatedAt }),
    };
  }
}
