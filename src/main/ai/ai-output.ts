import type {
  AiSimilarTestProposal,
  AiStepEditProposal,
  AiTask,
} from "../../shared/ai.js";
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

export const FORM_TEST_GENERATION_OUTPUT_SCHEMA: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    summary: { type: "string", minLength: 1, maxLength: 2000 },
    scenarios: {
      type: "array",
      minItems: 1,
      maxItems: 20,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          id: { type: "string", minLength: 1, maxLength: 100 },
          name: { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", maxLength: 1000 },
          kind: { type: "string", enum: ["valid", "negative"] },
          values: {
            type: "array",
            maxItems: 100,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                fieldId: { type: "string" },
                value: { type: ["string", "number", "boolean"] },
              },
              required: ["fieldId", "value"],
            },
          },
          omittedFieldIds: {
            type: "array",
            maxItems: 100,
            items: { type: "string" },
          },
          invalidFieldIds: {
            type: "array",
            maxItems: 100,
            items: { type: "string" },
          },
          expectedMessages: {
            type: "array",
            maxItems: 20,
            items: { type: "string", maxLength: 500 },
          },
        },
        required: [
          "id",
          "name",
          "description",
          "kind",
          "values",
          "omittedFieldIds",
          "invalidFieldIds",
          "expectedMessages",
        ],
      },
    },
  },
  required: ["summary", "scenarios"],
};

const simpleLocatorSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    type: { type: "string", enum: [...SIMPLE_LOCATOR_TYPES] },
    operator: { type: "string", enum: [...MATCH_OPERATORS] },
    value: { type: "string", minLength: 1 },
    role: { type: "string" },
    attribute: { type: "string" },
  },
  required: ["type", "operator", "value"],
};

const targetSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: { primary: simpleLocatorSchema },
  required: ["primary"],
};

const looseCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: simpleLocatorSchema,
    state: {
      type: "string",
      enum: [
        "visible",
        "hidden",
        "enabled",
        "disabled",
        "checked",
        "unchecked",
      ],
    },
    operator: { type: "string", enum: [...MATCH_OPERATORS] },
    value: { type: "string" },
    caseSensitive: { type: "boolean" },
    jsSnippet: { type: "string" },
    expectedResult: {},
    prompt: { type: "string" },
    minimumConfidence: {
      type: "number",
      minimum: 0,
      maximum: 1,
      description: "Permis exclusiv când checkType este visual.",
    },
    strategy: { type: "string", enum: ["auto", "dom", "visual"] },
    expectedTexts: {
      type: "array",
      maxItems: 20,
      items: { type: "string" },
    },
    matchMode: { type: "string", enum: ["any", "all", "exact"] },
    ignoreDiacritics: { type: "boolean" },
    visualPrompt: { type: "string" },
    visualFallback: { type: "boolean" },
  },
};

const elementOrTextCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    target: simpleLocatorSchema,
    state: {
      type: "string",
      enum: [
        "visible",
        "hidden",
        "enabled",
        "disabled",
        "checked",
        "unchecked",
      ],
    },
    operator: { type: "string", enum: [...MATCH_OPERATORS] },
    value: { type: "string" },
    caseSensitive: { type: "boolean" },
  },
  required: ["target"],
};

const urlCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    operator: { type: "string", enum: [...MATCH_OPERATORS] },
    value: { type: "string" },
    caseSensitive: { type: "boolean" },
  },
  required: ["operator", "value"],
};

const jsEvalCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    jsSnippet: { type: "string" },
    expectedResult: {},
  },
  required: ["jsSnippet"],
};

const visualCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    prompt: { type: "string", minLength: 3, maxLength: 4000 },
    minimumConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["prompt"],
};

const adaptiveCheckConfigSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    strategy: { type: "string", enum: ["auto", "dom", "visual"] },
    expectedTexts: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 1000 },
    },
    matchMode: { type: "string", enum: ["any", "all", "exact"] },
    target: simpleLocatorSchema,
    caseSensitive: { type: "boolean" },
    ignoreDiacritics: { type: "boolean" },
    visualPrompt: { type: "string", minLength: 3, maxLength: 4000 },
    visualFallback: { type: "boolean" },
    minimumConfidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["strategy", "expectedTexts", "matchMode", "visualFallback"],
};

const createdStepSchema: JsonValue = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["action"] },
        actionType: { type: "string", enum: [...ACTION_TYPES] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        whyExplanation: { type: "string" },
        target: targetSchema,
        inputFieldId: { type: "string" },
        valueKey: { type: "string" },
        valueStrategy: { type: "string", enum: ["dataset", "manual"] },
        url: { type: "string" },
        key: { type: "string" },
        scrollX: { type: "number" },
        scrollY: { type: "number" },
        scrollMode: { type: "string", enum: ["dom", "wheel"] },
        fallbacks: {
          type: "array",
          maxItems: 3,
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              locator: simpleLocatorSchema,
              humanDescription: { type: "string" },
              whyExplanation: { type: "string" },
            },
            required: ["locator", "humanDescription", "whyExplanation"],
          },
        },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "actionType",
        "title",
        "humanDescription",
        "whyExplanation",
        "fallbacks",
        "enabled",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["check"] },
        checkType: { type: "string", enum: ["adaptive"] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        config: adaptiveCheckConfigSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "checkType",
        "title",
        "humanDescription",
        "config",
        "timeoutMs",
        "enabled",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["check"] },
        checkType: { type: "string", enum: ["element", "text"] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        config: elementOrTextCheckConfigSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "checkType",
        "title",
        "humanDescription",
        "config",
        "timeoutMs",
        "enabled",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["check"] },
        checkType: { type: "string", enum: ["url"] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        config: urlCheckConfigSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "checkType",
        "title",
        "humanDescription",
        "config",
        "timeoutMs",
        "enabled",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["check"] },
        checkType: { type: "string", enum: ["js_eval"] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        config: jsEvalCheckConfigSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "checkType",
        "title",
        "humanDescription",
        "config",
        "timeoutMs",
        "enabled",
      ],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string" },
        type: { type: "string", enum: ["check"] },
        checkType: { type: "string", enum: ["visual"] },
        title: { type: "string" },
        humanDescription: { type: "string" },
        config: visualCheckConfigSchema,
        timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
        enabled: { type: "boolean" },
      },
      required: [
        "id",
        "type",
        "checkType",
        "title",
        "humanDescription",
        "config",
        "timeoutMs",
        "enabled",
      ],
    },
  ],
};

const editableStepPatchSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: { type: "string" },
    humanDescription: { type: "string" },
    whyExplanation: { type: "string" },
    instructions: { type: "string" },
    primaryLocator: simpleLocatorSchema,
    checkType: {
      type: "string",
      enum: ["element", "text", "url", "js_eval", "visual", "adaptive"],
    },
    checkConfig: looseCheckConfigSchema,
    timeoutMs: { type: "integer", minimum: 0, maximum: 120000 },
  },
};

const stepChangeSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    stepId: { type: "string" },
    patch: editableStepPatchSchema,
    rationale: { type: "string" },
  },
  required: ["stepId", "patch", "rationale"],
};

const runStepPatchSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    primaryLocator: simpleLocatorSchema,
    repeat: { type: "integer", minimum: 0, maximum: 24 },
    repeatUntil: {
      type: "object",
      additionalProperties: false,
      properties: {
        target: simpleLocatorSchema,
        operator: { type: "string", enum: [...MATCH_OPERATORS] },
        value: { type: "string" },
        maxAttempts: { type: "integer", minimum: 1, maximum: 24 },
      },
      required: ["target", "operator", "value", "maxAttempts"],
    },
    datasetValue: { type: "string" },
  },
};

const runStepChangeSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    stepId: { type: "string" },
    patch: runStepPatchSchema,
    rationale: { type: "string" },
  },
  required: ["stepId", "patch", "rationale"],
};

const runStepInsertionSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    anchorStepId: { type: "string" },
    position: { type: "string", enum: ["before", "after"] },
    action: {
      type: "object",
      additionalProperties: false,
      properties: {
        actionType: {
          type: "string",
          enum: [
            "click",
            "calendar_select",
            "select_option",
            "wait_for_element",
          ],
        },
        title: { type: "string" },
        humanDescription: { type: "string" },
        whyExplanation: { type: "string" },
        primaryLocator: simpleLocatorSchema,
        datasetValue: { type: "string" },
        repeat: { type: "integer", minimum: 0, maximum: 24 },
        repeatUntil: {
          type: "object",
          additionalProperties: false,
          properties: {
            target: simpleLocatorSchema,
            operator: { type: "string", enum: [...MATCH_OPERATORS] },
            value: { type: "string" },
            maxAttempts: { type: "integer", minimum: 1, maximum: 24 },
          },
          required: ["target", "operator", "value", "maxAttempts"],
        },
      },
      required: [
        "actionType",
        "title",
        "humanDescription",
        "whyExplanation",
        "primaryLocator",
      ],
    },
    rationale: { type: "string" },
  },
  required: ["anchorStepId", "position", "action", "rationale"],
};

const datasetPrimitiveSchema: JsonValue = {
  type: ["string", "number", "boolean", "null"],
};

const similarTestDatasetSchema: JsonValue = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: { type: "string" },
    values: {
      type: "array",
      maxItems: 100,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          key: { type: "string" },
          value: datasetPrimitiveSchema,
        },
        required: ["key", "value"],
      },
    },
  },
  required: ["name", "values"],
};

export const createAiSimilarTestOutputSchema = (
  existingStepIds?: readonly string[],
): JsonValue => {
  const existingStepIdSchema: JsonValue =
    existingStepIds === undefined
      ? { type: "string" }
      : { type: "string", enum: [...existingStepIds] };
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      name: { type: "string" },
      description: { type: "string" },
      datasets: {
        type: "array",
        maxItems: 20,
        items: similarTestDatasetSchema,
      },
      changes: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            stepId: existingStepIdSchema,
            patch: editableStepPatchSchema,
            rationale: { type: "string" },
          },
          required: ["stepId", "patch", "rationale"],
        },
      },
      insertions: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            anchorStepId: existingStepIdSchema,
            position: { type: "string", enum: ["before", "after"] },
            step: createdStepSchema,
            rationale: { type: "string" },
          },
          required: ["anchorStepId", "position", "step", "rationale"],
        },
      },
      removals: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            stepId: existingStepIdSchema,
            rationale: { type: "string" },
          },
          required: ["stepId", "rationale"],
        },
      },
    },
    required: [
      "summary",
      "name",
      "description",
      "datasets",
      "changes",
      "insertions",
      "removals",
    ],
  };
};

export const AI_OUTPUT_SCHEMAS: Record<AiTask, JsonValue> = {
  select_google_pay_card: {
    type: "object",
    additionalProperties: false,
    properties: {
      scenarioCode: { type: ["string", "null"], maxLength: 100 },
      reason: { type: "string", minLength: 1, maxLength: 1000 },
    },
    required: ["scenarioCode", "reason"],
  },
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
  edit_step: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      currentStepChange: stepChangeSchema,
      downstreamChanges: {
        type: "array",
        maxItems: 10,
        items: stepChangeSchema,
      },
    },
    required: ["summary", "currentStepChange", "downstreamChanges"],
  },
  create_step: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      step: createdStepSchema,
    },
    required: ["summary", "step"],
  },
  adapt_run: {
    type: "object",
    additionalProperties: false,
    properties: {
      summary: { type: "string" },
      changes: {
        type: "array",
        maxItems: 30,
        items: runStepChangeSchema,
      },
      insertions: {
        type: "array",
        maxItems: 20,
        items: runStepInsertionSchema,
      },
    },
    required: ["summary", "changes", "insertions"],
  },
  generate_test: createAiSimilarTestOutputSchema(),
  generate_form_tests: FORM_TEST_GENERATION_OUTPUT_SCHEMA,
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
  evaluate_post_run: {
    type: "object",
    additionalProperties: false,
    properties: {
      status: {
        type: "string",
        enum: ["passed", "failed", "inconclusive"],
      },
      summary: { type: "string" },
      findings: {
        type: "array",
        maxItems: 20,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            source: { type: "string", enum: ["mysql", "imap"] },
            passed: { type: "boolean" },
            message: { type: "string" },
            evidence: {
              type: "array",
              maxItems: 20,
              items: { type: "string" },
            },
          },
          required: ["source", "passed", "message", "evidence"],
        },
      },
    },
    required: ["status", "summary", "findings"],
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
  const missing = required.filter((key) => !(key in value));
  const unexpected = Object.keys(value).filter((key) => !allowed.has(key));
  if (missing.length > 0 || unexpected.length > 0) {
    const details = [
      missing.length === 0 ? "" : `lipsesc: ${missing.join(", ")}`,
      unexpected.length === 0
        ? ""
        : `nu sunt permise: ${unexpected.join(", ")}`,
    ]
      .filter(Boolean)
      .join("; ");
    throw new Error(
      `Output-ul AI nu respectă schema strictă (${details.slice(0, 300)}).`,
    );
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

const editablePatchKeys = [
  "title",
  "humanDescription",
  "whyExplanation",
  "instructions",
  "primaryLocator",
  "checkType",
  "checkConfig",
  "timeoutMs",
] as const;

const validateStepChange = (value: JsonValue | undefined): void => {
  if (!isObject(value)) {
    throw new Error("Output-ul AI conține o schimbare de pas invalidă.");
  }
  requireExactKeys(value, ["stepId", "patch", "rationale"]);
  requireString(value.stepId, "ID pas", 200);
  requireString(value.rationale, "motivație");
  if (!isObject(value.patch)) {
    throw new Error("Output-ul AI conține un patch de pas invalid.");
  }
  requireExactKeys(value.patch, [], editablePatchKeys);
  if (Object.keys(value.patch).length === 0) {
    throw new Error("Output-ul AI conține un patch gol.");
  }
  if (value.patch.title !== undefined) {
    requireString(value.patch.title, "titlu", 300);
  }
  if (value.patch.humanDescription !== undefined) {
    requireString(value.patch.humanDescription, "descriere");
  }
  if (value.patch.whyExplanation !== undefined) {
    requireString(value.patch.whyExplanation, "explicație");
  }
  if (value.patch.instructions !== undefined) {
    requireString(value.patch.instructions, "instrucțiuni");
  }
  if (value.patch.primaryLocator !== undefined) {
    validateSimpleLocator(value.patch.primaryLocator);
  }
  if (
    value.patch.checkType !== undefined &&
    (typeof value.patch.checkType !== "string" ||
      !["element", "text", "url", "js_eval", "visual", "adaptive"].includes(
        value.patch.checkType,
      ))
  ) {
    throw new Error("Output-ul AI conține un tip de check nepermis.");
  }
  if (
    value.patch.checkConfig !== undefined &&
    !isObject(value.patch.checkConfig)
  ) {
    throw new Error("Output-ul AI conține o configurație de check invalidă.");
  }
  if (
    value.patch.timeoutMs !== undefined &&
    (typeof value.patch.timeoutMs !== "number" ||
      !Number.isInteger(value.patch.timeoutMs) ||
      value.patch.timeoutMs < 0 ||
      value.patch.timeoutMs > 120_000)
  ) {
    throw new Error("Output-ul AI conține un timeout de check invalid.");
  }
};

const normalizeSimilarTestChanges = (value: JsonValue[]): JsonValue[] => {
  const normalized: JsonValue[] = [];
  const indexByStepId = new Map<string, number>();

  for (const rawChange of value) {
    if (!isObject(rawChange) || !isObject(rawChange.patch)) {
      normalized.push(rawChange);
      continue;
    }
    const change = structuredClone(rawChange);
    const patch = change.patch;
    if (!isObject(patch)) {
      normalized.push(change);
      continue;
    }
    if (
      isObject(patch.primaryLocator) &&
      typeof patch.primaryLocator.value === "string" &&
      patch.primaryLocator.value.trim().length === 0
    ) {
      delete patch.primaryLocator;
    }
    if (Object.keys(patch).length === 0) continue;
    if (typeof change.stepId !== "string") {
      normalized.push(change);
      continue;
    }
    const existingIndex = indexByStepId.get(change.stepId);
    if (existingIndex === undefined) {
      indexByStepId.set(change.stepId, normalized.length);
      normalized.push(change);
      continue;
    }
    const existing = normalized[existingIndex];
    if (!isObject(existing) || !isObject(existing.patch)) {
      normalized.push(change);
      continue;
    }
    existing.patch = { ...existing.patch, ...patch };
    if (typeof change.rationale === "string") {
      existing.rationale = change.rationale;
    }
  }

  return normalized;
};

export const normalizeAiSimilarTestProposalOutput = (
  value: Record<string, JsonValue>,
): Record<string, JsonValue> => {
  const normalized = structuredClone(value);
  if (Array.isArray(normalized.changes)) {
    normalized.changes = normalizeSimilarTestChanges(normalized.changes);
  }
  if (Array.isArray(normalized.removals)) {
    const seen = new Set<string>();
    normalized.removals = normalized.removals.filter((removal) => {
      if (!isObject(removal) || typeof removal.stepId !== "string") return true;
      if (seen.has(removal.stepId)) return false;
      seen.add(removal.stepId);
      return true;
    });
    if (Array.isArray(normalized.changes)) {
      normalized.changes = normalized.changes.filter(
        (change) =>
          !isObject(change) ||
          typeof change.stepId !== "string" ||
          !seen.has(change.stepId),
      );
    }
  }
  return normalized;
};

export const validateAiStepEditProposal = (
  value: unknown,
): AiStepEditProposal => {
  if (!isObject(value)) {
    throw new Error("Output-ul AI trebuie să fie un obiect JSON.");
  }
  assertNoArbitraryCode(value);
  requireExactKeys(value, [
    "summary",
    "currentStepChange",
    "downstreamChanges",
  ]);
  requireString(value.summary, "rezumat");
  validateStepChange(value.currentStepChange);
  if (
    !Array.isArray(value.downstreamChanges) ||
    value.downstreamChanges.length > 10
  ) {
    throw new Error("Output-ul AI conține schimbări downstream invalide.");
  }
  value.downstreamChanges.forEach(validateStepChange);
  return value as unknown as AiStepEditProposal;
};

export const validateAiSimilarTestProposal = (
  value: unknown,
): AiSimilarTestProposal => {
  if (!isObject(value)) {
    throw new Error("Propunerea AI pentru test trebuie să fie un obiect JSON.");
  }
  assertNoArbitraryCode(value);
  const proposal = normalizeAiSimilarTestProposalOutput(value);
  requireExactKeys(proposal, [
    "summary",
    "name",
    "description",
    "datasets",
    "changes",
    "insertions",
    "removals",
  ]);
  requireString(proposal.summary, "rezumat test");
  requireString(proposal.name, "nume test", 120);
  if (
    typeof proposal.description !== "string" ||
    proposal.description.length > 500
  ) {
    throw new Error("Propunerea AI conține o descriere invalidă.");
  }
  if (!Array.isArray(proposal.datasets) || proposal.datasets.length > 20) {
    throw new Error("Propunerea AI conține dataset-uri invalide.");
  }
  for (const dataset of proposal.datasets) {
    if (!isObject(dataset)) throw new Error("Dataset AI invalid.");
    requireExactKeys(dataset, ["name", "values"]);
    requireString(dataset.name, "nume dataset", 120);
    if (!Array.isArray(dataset.values) || dataset.values.length > 100) {
      throw new Error("Valorile dataset-ului AI sunt invalide.");
    }
    const keys = new Set<string>();
    for (const entry of dataset.values) {
      if (!isObject(entry)) throw new Error("Valoare dataset AI invalidă.");
      requireExactKeys(entry, ["key", "value"]);
      const key = requireString(entry.key, "cheie dataset", 120);
      if (keys.has(key))
        throw new Error("Dataset-ul AI conține chei duplicate.");
      keys.add(key);
      if (
        entry.value !== null &&
        typeof entry.value !== "string" &&
        typeof entry.value !== "number" &&
        typeof entry.value !== "boolean"
      ) {
        throw new Error("Dataset-ul AI conține o valoare nepermisă.");
      }
    }
  }
  if (!Array.isArray(proposal.changes) || proposal.changes.length > 100) {
    throw new Error("Propunerea AI conține schimbări invalide.");
  }
  proposal.changes.forEach(validateStepChange);
  if (!Array.isArray(proposal.insertions) || proposal.insertions.length > 100) {
    throw new Error("Propunerea AI conține inserări invalide.");
  }
  for (const insertion of proposal.insertions) {
    if (!isObject(insertion) || !isObject(insertion.step)) {
      throw new Error("Propunerea AI conține o inserare invalidă.");
    }
    requireExactKeys(insertion, [
      "anchorStepId",
      "position",
      "step",
      "rationale",
    ]);
    requireString(insertion.anchorStepId, "ID ancoră", 200);
    requireString(insertion.rationale, "motivație inserare");
    if (insertion.position !== "before" && insertion.position !== "after") {
      throw new Error("Poziția inserării AI este invalidă.");
    }
    if (insertion.step.type !== "action" && insertion.step.type !== "check") {
      throw new Error("AI poate insera numai acțiuni sau verificări.");
    }
    if (
      insertion.step.type === "action" &&
      (typeof insertion.step.actionType !== "string" ||
        !(ACTION_TYPES as readonly string[]).includes(
          insertion.step.actionType,
        ))
    ) {
      throw new Error("Output-ul AI conține o acțiune nepermisă.");
    }
  }
  if (!Array.isArray(proposal.removals) || proposal.removals.length > 100) {
    throw new Error("Propunerea AI conține eliminări invalide.");
  }
  for (const removal of proposal.removals) {
    if (!isObject(removal)) throw new Error("Eliminare AI invalidă.");
    requireExactKeys(removal, ["stepId", "rationale"]);
    requireString(removal.stepId, "ID pas eliminat", 200);
    requireString(removal.rationale, "motivație eliminare");
  }
  return proposal as unknown as AiSimilarTestProposal;
};

const validateRunRepeatUntil = (value: JsonValue | undefined): void => {
  if (!isObject(value)) {
    throw new Error("Planul AI conține o condiție de repetare invalidă.");
  }
  requireExactKeys(value, ["target", "operator", "value", "maxAttempts"]);
  validateSimpleLocator(value.target);
  const operator = requireString(value.operator, "operator de oprire", 100);
  if (!(MATCH_OPERATORS as readonly string[]).includes(operator)) {
    throw new Error("Planul AI conține un operator de oprire nepermis.");
  }
  requireString(value.value, "valoare de oprire", 1_000);
  if (
    typeof value.maxAttempts !== "number" ||
    !Number.isInteger(value.maxAttempts) ||
    value.maxAttempts < 1 ||
    value.maxAttempts > 24
  ) {
    throw new Error("Planul AI conține o limită de repetare invalidă.");
  }
};

export const validateAiRunPlanProposal = (
  value: unknown,
): import("../../shared/ai.js").AiRunPlanProposal => {
  if (!isObject(value)) {
    throw new Error("Planul AI de rulare trebuie să fie un obiect JSON.");
  }
  assertNoArbitraryCode(value);
  requireExactKeys(value, ["summary", "changes", "insertions"]);
  const summary = requireString(value.summary, "rezumat plan");
  if (!Array.isArray(value.changes) || value.changes.length > 30) {
    throw new Error("Planul AI conține o listă de schimbări invalidă.");
  }
  const changes = value.changes.map((change) => {
    if (!isObject(change)) {
      throw new Error("Planul AI conține o schimbare invalidă.");
    }
    requireExactKeys(change, ["stepId", "patch", "rationale"]);
    const stepId = requireString(change.stepId, "ID pas", 200);
    const rationale = requireString(change.rationale, "motivație");
    if (!isObject(change.patch)) {
      throw new Error("Planul AI conține un patch invalid.");
    }
    requireExactKeys(
      change.patch,
      [],
      ["primaryLocator", "repeat", "repeatUntil", "datasetValue"],
    );
    if (Object.keys(change.patch).length === 0) {
      throw new Error("Planul AI conține un patch gol.");
    }
    if (change.patch.primaryLocator !== undefined) {
      validateSimpleLocator(change.patch.primaryLocator);
    }
    if (
      change.patch.repeat !== undefined &&
      (typeof change.patch.repeat !== "number" ||
        !Number.isInteger(change.patch.repeat) ||
        change.patch.repeat < 0 ||
        change.patch.repeat > 24)
    ) {
      throw new Error("Planul AI conține un număr de repetări invalid.");
    }
    if (change.patch.repeatUntil !== undefined) {
      validateRunRepeatUntil(change.patch.repeatUntil);
    }
    if (
      change.patch.repeat !== undefined &&
      change.patch.repeatUntil !== undefined
    ) {
      throw new Error(
        "Planul AI nu poate combina repeat cu repeatUntil în același pas.",
      );
    }
    if (
      change.patch.datasetValue !== undefined &&
      (typeof change.patch.datasetValue !== "string" ||
        change.patch.datasetValue.length > 1_000)
    ) {
      throw new Error("Planul AI conține o valoare temporară invalidă.");
    }
    return {
      stepId,
      patch: {
        ...(change.patch.primaryLocator === undefined
          ? {}
          : {
              primaryLocator: structuredClone(
                change.patch.primaryLocator,
              ) as import("../../shared/ai.js").AiRunStepPatch["primaryLocator"],
            }),
        ...(change.patch.repeat === undefined
          ? {}
          : { repeat: change.patch.repeat }),
        ...(change.patch.repeatUntil === undefined
          ? {}
          : {
              repeatUntil: structuredClone(
                change.patch.repeatUntil,
              ) as NonNullable<
                import("../../shared/ai.js").AiRunStepPatch["repeatUntil"]
              >,
            }),
        ...(change.patch.datasetValue === undefined
          ? {}
          : { datasetValue: change.patch.datasetValue }),
      },
      rationale,
    };
  });
  if (new Set(changes.map(({ stepId }) => stepId)).size !== changes.length) {
    throw new Error("Planul AI modifică același pas de mai multe ori.");
  }
  if (!Array.isArray(value.insertions) || value.insertions.length > 20) {
    throw new Error("Planul AI conține o listă de inserări invalidă.");
  }
  const insertions = value.insertions.map((insertion) => {
    if (!isObject(insertion)) {
      throw new Error("Planul AI conține o inserare invalidă.");
    }
    requireExactKeys(insertion, [
      "anchorStepId",
      "position",
      "action",
      "rationale",
    ]);
    const anchorStepId = requireString(
      insertion.anchorStepId,
      "ID pas ancoră",
      200,
    );
    const position = requireString(insertion.position, "poziție inserare", 20);
    if (position !== "before" && position !== "after") {
      throw new Error("Planul AI conține o poziție de inserare invalidă.");
    }
    const rationale = requireString(insertion.rationale, "motivație inserare");
    if (!isObject(insertion.action)) {
      throw new Error("Planul AI conține o acțiune inserată invalidă.");
    }
    requireExactKeys(
      insertion.action,
      [
        "actionType",
        "title",
        "humanDescription",
        "whyExplanation",
        "primaryLocator",
      ],
      ["datasetValue", "repeat", "repeatUntil"],
    );
    const actionType = requireString(
      insertion.action.actionType,
      "tip acțiune inserată",
      100,
    );
    if (
      ![
        "click",
        "calendar_select",
        "select_option",
        "wait_for_element",
      ].includes(actionType)
    ) {
      throw new Error("Planul AI conține o acțiune inserată nepermisă.");
    }
    const title = requireString(insertion.action.title, "titlu inserare", 300);
    const humanDescription = requireString(
      insertion.action.humanDescription,
      "descriere inserare",
    );
    const whyExplanation = requireString(
      insertion.action.whyExplanation,
      "explicație inserare",
    );
    validateSimpleLocator(insertion.action.primaryLocator);
    if (
      insertion.action.repeat !== undefined &&
      (typeof insertion.action.repeat !== "number" ||
        !Number.isInteger(insertion.action.repeat) ||
        insertion.action.repeat < 0 ||
        insertion.action.repeat > 24)
    ) {
      throw new Error("Planul AI conține repeat invalid într-o inserare.");
    }
    if (insertion.action.repeatUntil !== undefined) {
      validateRunRepeatUntil(insertion.action.repeatUntil);
    }
    if (
      insertion.action.repeat !== undefined &&
      insertion.action.repeatUntil !== undefined
    ) {
      throw new Error(
        "Planul AI nu poate combina repeat cu repeatUntil într-o inserare.",
      );
    }
    if (
      (insertion.action.repeat !== undefined ||
        insertion.action.repeatUntil !== undefined) &&
      !["click", "calendar_select"].includes(actionType)
    ) {
      throw new Error("Acțiunea inserată nu poate fi repetată.");
    }
    const datasetValue =
      insertion.action.datasetValue === undefined
        ? undefined
        : requireString(
            insertion.action.datasetValue,
            "valoare inserare",
            1_000,
          );
    if (actionType === "select_option" && datasetValue === undefined) {
      throw new Error("Selectarea inserată necesită datasetValue.");
    }
    if (
      !["select_option", "calendar_select"].includes(actionType) &&
      datasetValue !== undefined
    ) {
      throw new Error("datasetValue nu este permis pentru acțiunea inserată.");
    }
    return {
      anchorStepId,
      position,
      action: {
        actionType,
        title,
        humanDescription,
        whyExplanation,
        primaryLocator: structuredClone(
          insertion.action.primaryLocator,
        ) as import("../../shared/ai.js").AiRunStepInsertion["action"]["primaryLocator"],
        ...(datasetValue === undefined ? {} : { datasetValue }),
        ...(insertion.action.repeat === undefined
          ? {}
          : { repeat: insertion.action.repeat }),
        ...(insertion.action.repeatUntil === undefined
          ? {}
          : {
              repeatUntil: structuredClone(
                insertion.action.repeatUntil,
              ) as import("../../shared/ai.js").AiRunStepInsertion["action"]["repeatUntil"],
            }),
      },
      rationale,
    } as import("../../shared/ai.js").AiRunStepInsertion;
  });
  return { summary, changes, insertions };
};

export const validateAiOutput = (task: AiTask, value: unknown): JsonValue => {
  if (!isObject(value)) {
    throw new Error("Output-ul AI trebuie să fie un obiect JSON.");
  }
  assertNoArbitraryCode(value);

  if (task === "select_google_pay_card") {
    requireExactKeys(value, ["scenarioCode", "reason"]);
    if (
      value.scenarioCode !== null &&
      (typeof value.scenarioCode !== "string" ||
        value.scenarioCode.length === 0 ||
        value.scenarioCode.length > 100)
    ) {
      throw new Error(
        "Output-ul AI conține un cod de scenariu Google Pay invalid.",
      );
    }
    requireString(value.reason, "motiv alegere Google Pay", 1000);
    return value;
  }

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

  if (task === "edit_step") {
    return validateAiStepEditProposal(value) as unknown as JsonValue;
  }

  if (task === "create_step") {
    requireExactKeys(value, ["summary", "step"]);
    requireString(value.summary, "rezumat");
    if (!isObject(value.step)) {
      throw new Error("Output-ul AI conține un pas invalid.");
    }
    if (value.step.type !== "action" && value.step.type !== "check") {
      throw new Error("Output-ul AI conține un tip de pas nepermis.");
    }
    return value;
  }

  if (task === "adapt_run") {
    return validateAiRunPlanProposal(value) as unknown as JsonValue;
  }

  if (task === "generate_test") {
    return validateAiSimilarTestProposal(value) as unknown as JsonValue;
  }

  if (task === "generate_form_tests") {
    requireExactKeys(value, ["summary", "scenarios"]);
    requireString(value.summary, "rezumat formular", 2000);
    if (
      !Array.isArray(value.scenarios) ||
      value.scenarios.length === 0 ||
      value.scenarios.length > 20
    ) {
      throw new Error("Output-ul AI conține o listă de scenarii invalidă.");
    }
    for (const scenario of value.scenarios) {
      if (!isObject(scenario)) {
        throw new Error(
          "Output-ul AI conține un scenariu de formular invalid.",
        );
      }
      requireExactKeys(scenario, [
        "id",
        "name",
        "description",
        "kind",
        "values",
        "omittedFieldIds",
        "invalidFieldIds",
        "expectedMessages",
      ]);
      requireString(scenario.id, "ID scenariu", 100);
      requireString(scenario.name, "nume scenariu", 120);
      if (
        typeof scenario.description !== "string" ||
        scenario.description.length > 1000
      ) {
        throw new Error(
          "Output-ul AI conține o descriere de scenariu invalidă.",
        );
      }
      if (scenario.kind !== "valid" && scenario.kind !== "negative") {
        throw new Error("Output-ul AI conține un tip de scenariu invalid.");
      }
      if (!Array.isArray(scenario.values) || scenario.values.length > 100) {
        throw new Error("Output-ul AI conține valori de formular invalide.");
      }
      for (const entry of scenario.values) {
        if (!isObject(entry)) {
          throw new Error(
            "Output-ul AI conține o valoare de formular invalidă.",
          );
        }
        requireExactKeys(entry, ["fieldId", "value"]);
        requireString(entry.fieldId, "ID câmp", 300);
        if (!["string", "number", "boolean"].includes(typeof entry.value)) {
          throw new Error("Output-ul AI conține o valoare de câmp invalidă.");
        }
      }
      requireStringArray(scenario.omittedFieldIds, "câmpuri omise", 100);
      requireStringArray(scenario.invalidFieldIds, "câmpuri invalide", 100);
      requireStringArray(scenario.expectedMessages, "mesaje așteptate", 20);
    }
    return value;
  }

  if (task === "evaluate_post_run") {
    requireExactKeys(value, ["status", "summary", "findings"]);
    const status = requireString(value.status, "status evaluare", 50);
    if (!["passed", "failed", "inconclusive"].includes(status)) {
      throw new Error("Output-ul AI conține un status post-run invalid.");
    }
    requireString(value.summary, "rezumat evaluare");
    if (!Array.isArray(value.findings) || value.findings.length > 20) {
      throw new Error("Output-ul AI conține findings post-run invalide.");
    }
    for (const finding of value.findings) {
      if (!isObject(finding)) {
        throw new Error("Output-ul AI conține un finding invalid.");
      }
      requireExactKeys(finding, ["source", "passed", "message", "evidence"]);
      const source = requireString(finding.source, "sursă finding", 20);
      if (!["mysql", "imap"].includes(source)) {
        throw new Error("Output-ul AI conține o sursă post-run invalidă.");
      }
      if (typeof finding.passed !== "boolean") {
        throw new Error("Output-ul AI conține un verdict invalid.");
      }
      requireString(finding.message, "mesaj finding");
      requireStringArray(finding.evidence, "dovezi", 20);
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
