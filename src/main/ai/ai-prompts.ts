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

const limitContext = (
  source: JsonValue,
  maxArrayItems = MAX_ARRAY_ITEMS,
  maxContextValueBytes = MAX_CONTEXT_VALUE_BYTES,
): ContextLimitResult => {
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
      if (consumedBytes + bytes > maxContextValueBytes) {
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
      if (value.length > maxArrayItems) omittedPaths.push(`${path}[...]`);
      return value
        .slice(0, maxArrayItems)
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
    "Editează declarativ pasul selectat conform instrucțiunii utilizatorului. Pentru verificări de rezultat fără selector sigur folosește checkType adaptive. Pune mesajele concrete oferite explicit în expectedTexts; nu inventa sinonime sau cuvinte-cheie. Folosește strategy auto și visualFallback true: expectedTexts nevid produce DOM determinist, iar lista goală produce verificare vizuală. Folosește js_eval numai pentru condiții DOM tehnice care nu pot fi exprimate prin mesaje.",
  create_step:
    "Generează exact un singur pas declarativ conform descrierii utilizatorului și tipului cerut. Folosește exact stepId din context. Pentru un check de rezultat fără selector sigur folosește checkType adaptive cu config {strategy:'auto', expectedTexts:[], matchMode:'any', visualPrompt, visualFallback:true, minimumConfidence:0.6}. Copiază în expectedTexts numai mesajele concrete oferite explicit. Dacă lista are valori, runnerul verifică DOM; dacă este goală, folosește imaginea. Nu genera js_eval cu document.body.innerText și nu inventa selectori sau cuvinte-cheie.",
  adapt_run:
    "Construiește un plan temporar numai pentru următoarea rulare. Poți modifica pașii existenți și poți insera acțiuni declarative lângă un ID existent. Folosește locatorii din flow și semanticInteractionMap; nu inventa locatori și nu transforma un ID valid într-un pas de alt tip. Starea finală a înregistrării NU este starea inițială a rulării. Pentru calendare, folosește markerul vizual lună/an și repeatUntil exclusiv pe controlul real Next sau Previous, nu pe scroll/input și nu un repeat calculat relativ la data înregistrată. Pentru zi folosește șablonul real din calendarRuntimeHints (de exemplu atributul data-date) și înlocuiește data din el; nu presupune convenția calendar-day-YYYY-MM-DD dacă aceasta nu apare în context. Nu folosi containerul calendarului și nu pune datasetValue pe calendar_select. datasetValue este numai pentru select_option. Verificarea condiției are loc la runtime înainte și după fiecare click. Returnează întotdeauna changes și insertions. ATENȚIE: dacă utilizatorul cere orice schimbare, cele două liste NU pot fi ambele goale. Pentru o altă dată, trebuie să existe cel puțin patch-ul sau inserarea zilei și, când luna/anul diferă, planul de navigare sau selectare a anului. Nu modifica testul salvat și nu genera cod.",
  generate_test:
    "Creează o variantă a testului-sursă conform instrucțiunii. Nu rescrie pașii neschimbați: întoarce numai changes, insertions și removals. Folosește exclusiv aliasurile ref pentru pașii existenți. Pentru fiecare ref existent folosește cel mult una dintre operațiile change sau removal și nu repeta același ref în changes ori removals. O inserare poate fi ancorată de pasul pe care îl înlocuiește. Nu adăuga primaryLocator unui check care nu are selector și nu returna niciodată un locator cu value gol. Dataseturile NU sunt pași; modifică valorile numai în datasets. Pentru pași noi folosește ID-uri cu prefixul ai-. Pentru verificări de rezultat fără selector sigur folosește checkType adaptive cu config complet: strategy auto, expectedTexts numai din mesajele concrete oferite explicit, matchMode any, visualPrompt descriptiv, visualFallback true și minimumConfidence 0.6. Lista expectedTexts goală înseamnă verificare vizuală. Nu genera js_eval bazat pe document.body.innerText și nu inventa mesaje, sinonime, cuvinte-cheie sau selectori.",
  generate_form_tests:
    "Analizează separat fiecare câmp al formularului și generează o matrice concisă de scenarii independente. Include exact un flux valid complet, apoi câte un caz negativ izolat pentru fiecare regulă observabilă relevantă: required omis, format/type invalid, minlength/maxlength, min/max/step, pattern, opțiuni și consimțământ obligatoriu. Nu combina mai multe erori fără cerere explicită și nu inventa reguli absente din metadate. Folosește exact ID-urile câmpurilor din context. Pentru input type=file nu returna niciodată nume, valori sau căi de fișier și nu îl trata drept text: aplicația creează pasul upload_file și injectează automat un fixture local valid ales după accept/extensie și sensul câmpului; pentru validarea required îl poți include numai în omittedFieldIds. Nu returna valori pentru câmpurile email; aplicația injectează adresa configurată prin IMAP. Datele non-email trebuie să fie coerente în cadrul scenariului și distincte între teste, folosind tokenul și ID-ul scenariului când este natural. expectedMessages trebuie să conțină numai texte concrete prezente în context sau oferite de utilizator; altfel lasă lista goală pentru verificarea vizuală. În description, descrie doar scopul scenariului și rezultatul așteptat la final (ex. 'Afișează mesaj de succes' sau 'Eroare la câmpul X'); NU instrui verificarea datelor introduse, deoarece verificarea are loc DUPĂ submit, când formularul se golește. Nu inventa selectori, pași ori mesaje.",
  repair_locator:
    "Propune un locator semantic principal și maximum cinci fallback-uri pentru pasul eșuat. Folosește numai tipurile permise de schemă.",
  evaluate_post_run:
    "Evaluează împreună dovezile post-run MySQL și IMAP față de instrucțiunea comună și valorile efective ale datasetului. Corelează valorile dintre dataset, rândurile bazei de date și mesajele primite. Un client existent nu trebuie reinserat: formularea «s-a creat clientul» nu implică un insert nou decât dacă se cere explicit o adresă nouă sau unică. Nu presupune date absente. Pentru fiecare sursă întoarce verdict, explicație și dovezi scurte. Dacă dovezile sunt insuficiente, folosește status inconclusive.",
  select_google_pay_card:
    "Alege codul exact al scenariului Google Pay TEST care corespunde descrierii utilizatorului. Primești exclusiv un JSON array complet cu codurile disponibile. Nu deduce scenariul din tipul sau rețeaua unui card și nu inventa un cod. Returnează scenarioCode null dacă niciun cod nu corespunde suficient de clar. Explică pe scurt alegerea.",
};

const systemInstruction =
  "Ești un analizor pentru teste web declarative. Răspunzi exclusiv cu JSON conform schemei. Nu furnizezi și nu execuți cod, scripturi, comenzi sau tool calls. Nu modifici direct testul; rezultatul este doar o propunere care va necesita aprobare umană.";

export const createAiRequestPreview = (
  settings: AiSettingsSummary,
  input: CreateAiRequestPreviewInput,
): AiRequestPreview => {
  const limited = limitContext(
    input.context,
    input.task === "select_google_pay_card"
      ? Number.POSITIVE_INFINITY
      : MAX_ARRAY_ITEMS,
    input.task === "select_google_pay_card"
      ? Number.POSITIVE_INFINITY
      : MAX_CONTEXT_VALUE_BYTES,
  );
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
      : provider === "lm_studio"
        ? settings.lmStudio.model
        : provider === "gemini"
          ? settings.gemini.model
          : provider === "openai"
            ? settings.openai.model
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
