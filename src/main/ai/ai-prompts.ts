import type {
  AiRequestPreview,
  AiSettingsSummary,
  AiTask,
  CreateAiRequestPreviewInput,
} from "../../shared/ai.js";
import type { JsonValue } from "../../shared/persistence.js";
import { AI_OUTPUT_SCHEMAS } from "./ai-output.js";

const MAX_CONTEXT_VALUE_BYTES = 20_000;
const MAX_STRING_LENGTH = 1_000;
const MAX_ARRAY_ITEMS = 40;
const MAX_DEPTH = 6;
const sensitiveKeyPattern =
  /password|passphrase|secret|api[_-]?key|authorization|cookie|session|token|rawhtml|html|stylesheet|css|screenshot/i;

interface ContextLimitResult {
  context: JsonValue;
  omittedPaths: string[];
}

const valueBytes = (value: JsonValue): number =>
  Buffer.byteLength(JSON.stringify(value), "utf8");

const limitContext = (source: JsonValue): ContextLimitResult => {
  const omittedPaths: string[] = [];
  let consumedBytes = 0;

  const visit = (value: JsonValue, path: string, depth: number): JsonValue => {
    if (depth > MAX_DEPTH) {
      omittedPaths.push(path);
      return "[omis: adâncime maximă]";
    }
    if (typeof value === "string") {
      const limited =
        value.length > MAX_STRING_LENGTH
          ? `${value.slice(0, MAX_STRING_LENGTH)}…`
          : value;
      if (limited !== value) omittedPaths.push(path);
      const bytes = Buffer.byteLength(limited, "utf8");
      if (consumedBytes + bytes > MAX_CONTEXT_VALUE_BYTES) {
        omittedPaths.push(path);
        return "[omis: limita de context]";
      }
      consumedBytes += bytes;
      return limited;
    }
    if (value === null || typeof value !== "object") {
      consumedBytes += Buffer.byteLength(String(value), "utf8");
      return value;
    }
    if (Array.isArray(value)) {
      if (value.length > MAX_ARRAY_ITEMS) omittedPaths.push(`${path}[...]`);
      return value
        .slice(0, MAX_ARRAY_ITEMS)
        .map((item, index) => visit(item, `${path}[${index}]`, depth + 1));
    }
    const result: Record<string, JsonValue> = {};
    for (const [key, nested] of Object.entries(value).slice(0, 80)) {
      const nestedPath = path.length === 0 ? key : `${path}.${key}`;
      if (sensitiveKeyPattern.test(key)) {
        omittedPaths.push(nestedPath);
        continue;
      }
      result[key] = visit(nested, nestedPath, depth + 1);
    }
    if (Object.keys(value).length > 80) omittedPaths.push(`${path}.*`);
    return result;
  };

  return {
    context: visit(source, "$", 0),
    omittedPaths: [...new Set(omittedPaths)].slice(0, 200),
  };
};

const taskInstructions: Record<AiTask, string> = {
  analyze_step:
    "Analizează un singur pas înregistrat și propune doar denumiri și explicații semantice. Nu executa nimic.",
  edit_step:
    "Editează declarativ pasul selectat conform instrucțiunii utilizatorului. Propune schimbarea pasului curent și numai schimbările downstream strict necesare. Folosește exact ID-urile de pas din context, nu modifica pașii anteriori și nu genera cod.",
  generate_test:
    "Transformă înregistrarea furnizată într-o propunere declarativă de pași de test. Nu genera cod și nu inventa date confidențiale.",
  repair_locator:
    "Propune un locator semantic principal și maximum cinci fallback-uri pentru pasul eșuat. Folosește numai tipurile permise de schemă.",
};

const systemInstruction =
  "Ești un analizor pentru teste web declarative. Răspunzi exclusiv cu JSON conform schemei. Nu furnizezi și nu execuți cod, scripturi, comenzi sau tool calls. Nu modifici direct testul; rezultatul este doar o propunere care va necesita aprobare umană.";

export const createAiRequestPreview = (
  settings: AiSettingsSummary,
  input: CreateAiRequestPreviewInput,
): AiRequestPreview => {
  const limited = limitContext(input.context);
  const serializedContext = JSON.stringify(limited.context, null, 2);
  const outputSchema = structuredClone(AI_OUTPUT_SCHEMAS[input.task]);
  const prompt = [
    taskInstructions[input.task],
    "Contextul permis și limitat este:",
    serializedContext,
    "Returnează exact structura JSON solicitată, fără proprietăți suplimentare.",
  ].join("\n\n");
  const provider = input.provider ?? settings.provider;
  const configuredModel =
    provider === "ollama"
      ? settings.ollama.model
      : provider === "gemini"
        ? settings.gemini.model
        : "";
  const model = input.model?.trim() || configuredModel;
  return {
    task: input.task,
    provider,
    model,
    systemInstruction,
    prompt,
    outputSchema,
    contextPreview: limited.context,
    estimatedInputTokens: Math.max(
      1,
      Math.ceil(
        (systemInstruction.length +
          prompt.length +
          JSON.stringify(outputSchema).length) /
          4,
      ),
    ),
    originalContextBytes: valueBytes(input.context),
    sentContextBytes: valueBytes(limited.context),
    omittedPaths: limited.omittedPaths,
  };
};
