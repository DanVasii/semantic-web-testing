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
const MAX_DEPTH = 9;
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
  adapt_run:
    "Construiește un plan temporar numai pentru următoarea rulare. Poți modifica pașii existenți și poți insera acțiuni declarative lângă un ID existent. Folosește locatorii din flow și semanticInteractionMap; nu inventa locatori și nu transforma un ID valid într-un pas de alt tip. Starea finală a înregistrării NU este starea inițială a rulării. Pentru calendare, folosește markerul vizual lună/an și repeatUntil exclusiv pe controlul real Next sau Previous, nu pe scroll/input și nu un repeat calculat relativ la data înregistrată. Pentru zi folosește șablonul real din calendarRuntimeHints (de exemplu atributul data-date) și înlocuiește data din el; nu presupune convenția calendar-day-YYYY-MM-DD dacă aceasta nu apare în context. Nu folosi containerul calendarului și nu pune datasetValue pe calendar_select. datasetValue este numai pentru select_option. Verificarea condiției are loc la runtime înainte și după fiecare click. Returnează întotdeauna changes și insertions. ATENȚIE: dacă utilizatorul cere orice schimbare, cele două liste NU pot fi ambele goale. Pentru o altă dată, trebuie să existe cel puțin patch-ul sau inserarea zilei și, când luna/anul diferă, planul de navigare sau selectare a anului. Nu modifica testul salvat și nu genera cod.",
  generate_test:
    "Transformă înregistrarea furnizată într-o propunere declarativă de pași de test. Nu genera cod și nu inventa date confidențiale.",
  repair_locator:
    "Propune un locator semantic principal și maximum cinci fallback-uri pentru pasul eșuat. Folosește numai tipurile permise de schemă.",
  evaluate_post_run:
    "Evaluează împreună dovezile post-run MySQL și IMAP față de instrucțiunea comună și valorile efective ale datasetului. Corelează valorile dintre dataset, rândurile bazei de date și mesajele primite. Un client existent nu trebuie reinserat: formularea «s-a creat clientul» nu implică un insert nou decât dacă se cere explicit o adresă nouă sau unică. Nu presupune date absente. Pentru fiecare sursă întoarce verdict, explicație și dovezi scurte. Dacă dovezile sunt insuficiente, folosește status inconclusive.",
};

const systemInstruction =
  "Ești un analizor pentru teste web declarative. Răspunzi exclusiv cu JSON conform schemei. Nu furnizezi și nu execuți cod, scripturi, comenzi sau tool calls. Nu modifici direct testul; rezultatul este doar o propunere care va necesita aprobare umană.";

export const createAiRequestPreview = (
  settings: AiSettingsSummary,
  input: CreateAiRequestPreviewInput,
): AiRequestPreview => {
  const limited = limitContext(input.context);
  // Whitespace-ul JSON nu aduce informație modelului, dar este tokenizat și taxat.
  const serializedContext = JSON.stringify(limited.context);
  const outputSchema = structuredClone(
    input.outputSchema ?? AI_OUTPUT_SCHEMAS[input.task],
  );
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
