import type { AiTask } from "../../shared/ai.js";
import type { JsonValue } from "../../shared/persistence.js";
import {
  ACTION_TYPES,
  MATCH_OPERATORS,
  SIMPLE_LOCATOR_TYPES,
} from "../../shared/test-model.js";

const stringArraySchema: JsonValue = {
  type: "array",
  items: { type: "string" },
  maxItems: 10,
};

const simpleLocatorSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: [...SIMPLE_LOCATOR_TYPES] },
    operator: { type: "string", enum: [...MATCH_OPERATORS] },
    value: { type: "string" },
    role: { type: "string" },
    attribute: { type: "string" },
  },
  required: ["type", "operator", "value"],
};

export const AI_OUTPUT_SCHEMAS: Record<AiTask, JsonValue> = {
  analyze_step: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      suggestedTitle: { type: "string" },
      humanDescription: { type: "string" },
      whyExplanation: { type: "string" },
      downstreamSuggestions: stringArraySchema,
    },
    required: [
      "summary",
      "suggestedTitle",
      "humanDescription",
      "whyExplanation",
      "downstreamSuggestions",
    ],
  },
  generate_test: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      steps: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            actionType: { type: "string", enum: [...ACTION_TYPES] },
            title: { type: "string" },
            humanDescription: { type: "string" },
            whyExplanation: { type: "string" },
            targetHint: { type: "string" },
          },
          required: [
            "actionType",
            "title",
            "humanDescription",
            "whyExplanation",
          ],
        },
      },
      downstreamSuggestions: stringArraySchema,
    },
    required: ["summary", "steps", "downstreamSuggestions"],
  },
  repair_locator: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      stepId: { type: "string" },
      primaryLocator: simpleLocatorSchema,
      fallbackLocators: {
        type: "array",
        maxItems: 5,
        items: simpleLocatorSchema,
      },
      rationale: { type: "string" },
    },
    required: [
      "summary",
      "stepId",
      "primaryLocator",
      "fallbackLocators",
      "rationale",
    ],
  },
};

type JsonObject = { [key: string]: JsonValue };

const isObject = (value: unknown): value is JsonObject =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireExactKeys = (
  value: JsonObject,
  required: readonly string[],
  optional: readonly string[] = [],
): void => {
  const allowed = new Set([...required, ...optional]);
  if (
    required.some((key) => !(key in value)) ||
    Object.keys(value).some((key) => !allowed.has(key))
  ) {
    throw new Error("Output-ul AI nu respectă schema strictă.");
  }
};

const requireString = (
  value: JsonValue | undefined,
  label: string,
  maxLength = 2_000,
): string => {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > maxLength
  ) {
    throw new Error(`Output-ul AI conține ${label} invalid.`);
  }
  return value;
};

const requireStringArray = (
  value: JsonValue | undefined,
  label: string,
  maxItems: number,
): string[] => {
  if (
    !Array.isArray(value) ||
    value.length > maxItems ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length === 0 ||
        item.length > 1_000,
    )
  ) {
    throw new Error(`Output-ul AI conține ${label} invalid.`);
  }
  return value as string[];
};

const forbiddenKeyPattern =
  /^(code|script|javascript|typescript|shell|command|function|eval|executable)$/i;
const forbiddenTextPattern =
  /```|<script\b|javascript:|child_process|powershell(?:\.exe)?|cmd\.exe|eval\s*\(|new\s+Function\s*\(/i;

const assertNoArbitraryCode = (value: JsonValue): void => {
  if (typeof value === "string") {
    if (forbiddenTextPattern.test(value)) {
      throw new Error("Output-ul AI conține cod arbitrar și a fost respins.");
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(assertNoArbitraryCode);
    return;
  }
  if (isObject(value)) {
    for (const [key, nested] of Object.entries(value)) {
      if (forbiddenKeyPattern.test(key)) {
        throw new Error("Output-ul AI conține cod arbitrar și a fost respins.");
      }
      assertNoArbitraryCode(nested);
    }
  }
};

const validateSimpleLocator = (value: JsonValue | undefined): void => {
  if (!isObject(value)) {
    throw new Error("Output-ul AI conține un locator invalid.");
  }
  requireExactKeys(value, ["type", "operator", "value"], ["role", "attribute"]);
  const type = requireString(value.type, "tip de locator", 100);
  const operator = requireString(value.operator, "operator", 100);
  requireString(value.value, "valoare locator");
  if (!(SIMPLE_LOCATOR_TYPES as readonly string[]).includes(type)) {
    throw new Error("Output-ul AI conține un tip de locator nepermis.");
  }
  if (!(MATCH_OPERATORS as readonly string[]).includes(operator)) {
    throw new Error("Output-ul AI conține un operator nepermis.");
  }
  if (value.role !== undefined) requireString(value.role, "rol", 100);
  if (value.attribute !== undefined) {
    requireString(value.attribute, "atribut", 100);
  }
};

export const validateAiOutput = (task: AiTask, value: unknown): JsonValue => {
  if (!isObject(value)) {
    throw new Error("Output-ul AI trebuie să fie un obiect JSON.");
  }
  assertNoArbitraryCode(value);

  if (task === "analyze_step") {
    requireExactKeys(value, [
      "summary",
      "suggestedTitle",
      "humanDescription",
      "whyExplanation",
      "downstreamSuggestions",
    ]);
    requireString(value.summary, "rezumat");
    requireString(value.suggestedTitle, "titlu", 300);
    requireString(value.humanDescription, "descriere");
    requireString(value.whyExplanation, "explicație");
    requireStringArray(value.downstreamSuggestions, "sugestii", 10);
    return value;
  }

  if (task === "generate_test") {
    requireExactKeys(value, ["summary", "steps", "downstreamSuggestions"]);
    requireString(value.summary, "rezumat");
    requireStringArray(value.downstreamSuggestions, "sugestii", 10);
    if (!Array.isArray(value.steps) || value.steps.length > 100) {
      throw new Error("Output-ul AI conține o listă de pași invalidă.");
    }
    for (const step of value.steps) {
      if (!isObject(step)) {
        throw new Error("Output-ul AI conține un pas invalid.");
      }
      requireExactKeys(
        step,
        ["actionType", "title", "humanDescription", "whyExplanation"],
        ["targetHint"],
      );
      const actionType = requireString(step.actionType, "tip de acțiune", 100);
      if (!(ACTION_TYPES as readonly string[]).includes(actionType)) {
        throw new Error("Output-ul AI conține o acțiune nepermisă.");
      }
      requireString(step.title, "titlu pas", 300);
      requireString(step.humanDescription, "descriere pas");
      requireString(step.whyExplanation, "explicație pas");
      if (step.targetHint !== undefined) {
        requireString(step.targetHint, "indiciu țintă");
      }
    }
    return value;
  }

  requireExactKeys(value, [
    "summary",
    "stepId",
    "primaryLocator",
    "fallbackLocators",
    "rationale",
  ]);
  requireString(value.summary, "rezumat");
  requireString(value.stepId, "ID pas", 200);
  validateSimpleLocator(value.primaryLocator);
  if (
    !Array.isArray(value.fallbackLocators) ||
    value.fallbackLocators.length > 5
  ) {
    throw new Error("Output-ul AI conține fallback-uri invalide.");
  }
  value.fallbackLocators.forEach(validateSimpleLocator);
  requireString(value.rationale, "motivație");
  return value;
};
