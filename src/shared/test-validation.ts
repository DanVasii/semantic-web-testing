import {
  ACTION_TYPES,
  MATCH_OPERATORS,
  RELATIVE_LOCATOR_RELATIONS,
  SIMPLE_LOCATOR_TYPES,
  WAIT_TYPES,
  type DeclarativeTestDefinition,
  type TestDataset,
} from "./test-model.js";

export type ValidationIssueCode =
  | "invalid_json"
  | "invalid_type"
  | "missing_property"
  | "unknown_property"
  | "unsafe_property"
  | "forbidden_code_field"
  | "invalid_value"
  | "invalid_format"
  | "duplicate_id"
  | "limit_exceeded";

export interface ValidationIssue {
  path: string;
  code: ValidationIssueCode;
  message: string;
}

export type ValidationResult<T> =
  | { valid: true; data: T; issues: [] }
  | { valid: false; issues: ValidationIssue[] };

type JsonRecord = Record<string, unknown>;

const MAX_ISSUES = 100;
const MAX_DEPTH = 40;
const MAX_STRING_LENGTH = 100_000;
const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const FIELD_ID_PATTERN = /^[a-z_][a-z0-9_]*$/;
const DANGEROUS_PROPERTIES = new Set(["__proto__", "constructor", "prototype"]);
const CODE_FIELD_NAMES = new Set([
  "callback",
  "code",
  "command",
  "eval",
  "evaluate",
  "executable",
  "expression",
  "function",
  "javascript",
  "playwright",
  "script",
  "shell",
]);

class ValidationContext {
  public readonly issues: ValidationIssue[] = [];
  private readonly scanned = new WeakSet<object>();

  public add(path: string, code: ValidationIssueCode, message: string): void {
    if (this.issues.length < MAX_ISSUES) {
      this.issues.push({ path, code, message });
    }
  }

  public scanSafety(value: unknown, path = "$", depth = 0): void {
    if (depth > MAX_DEPTH) {
      this.add(path, "limit_exceeded", "Structura JSON este prea adâncă.");
      return;
    }
    if (
      typeof value === "function" ||
      typeof value === "symbol" ||
      typeof value === "bigint" ||
      value === undefined
    ) {
      this.add(
        path,
        "invalid_type",
        "Documentul trebuie să conțină numai valori JSON.",
      );
      return;
    }
    if (typeof value === "string" && value.length > MAX_STRING_LENGTH) {
      this.add(path, "limit_exceeded", "Textul depășește limita permisă.");
      return;
    }
    if (typeof value !== "object" || value === null) {
      return;
    }
    if (this.scanned.has(value)) {
      this.add(path, "invalid_value", "Referințele circulare nu sunt permise.");
      return;
    }
    this.scanned.add(value);
    if (Array.isArray(value)) {
      if (value.length > 10_000) {
        this.add(
          path,
          "limit_exceeded",
          "Lista depășește numărul maxim de elemente.",
        );
      }
      value.forEach((item, index) => {
        this.scanSafety(item, `${path}[${index}]`, depth + 1);
      });
      return;
    }

    const prototype = Object.getPrototypeOf(value) as unknown;
    if (prototype !== Object.prototype && prototype !== null) {
      this.add(
        path,
        "invalid_type",
        "Sunt acceptate numai obiecte JSON simple.",
      );
      return;
    }
    for (const [key, item] of Object.entries(value)) {
      const propertyPath = `${path}.${key}`;
      if (DANGEROUS_PROPERTIES.has(key)) {
        this.add(
          propertyPath,
          "unsafe_property",
          `Proprietatea periculoasă „${key}” nu este permisă.`,
        );
      }
      if (CODE_FIELD_NAMES.has(key.toLowerCase())) {
        this.add(
          propertyPath,
          "forbidden_code_field",
          `Câmpul executabil „${key}” nu este permis.`,
        );
      }
      this.scanSafety(item, propertyPath, depth + 1);
    }
  }
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const requireRecord = (
  value: unknown,
  path: string,
  context: ValidationContext,
): JsonRecord | undefined => {
  if (!isRecord(value)) {
    context.add(path, "invalid_type", "Valoarea trebuie să fie un obiect.");
    return undefined;
  }
  return value;
};

const allowOnly = (
  record: JsonRecord,
  allowed: readonly string[],
  path: string,
  context: ValidationContext,
): void => {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(record)) {
    if (!allowedSet.has(key)) {
      context.add(
        `${path}.${key}`,
        "unknown_property",
        `Proprietatea necunoscută „${key}” nu este permisă.`,
      );
    }
  }
};

const requireProperties = (
  record: JsonRecord,
  required: readonly string[],
  path: string,
  context: ValidationContext,
): void => {
  for (const property of required) {
    if (!Object.hasOwn(record, property)) {
      context.add(
        `${path}.${property}`,
        "missing_property",
        `Proprietatea „${property}” este obligatorie.`,
      );
    }
  }
};

const validateString = (
  value: unknown,
  path: string,
  context: ValidationContext,
  options: { min?: number; max?: number } = {},
): value is string => {
  if (typeof value !== "string") {
    context.add(path, "invalid_type", "Valoarea trebuie să fie text.");
    return false;
  }
  if ((options.min ?? 0) > value.length) {
    context.add(path, "invalid_value", "Textul este prea scurt.");
  }
  if (value.length > (options.max ?? MAX_STRING_LENGTH)) {
    context.add(path, "limit_exceeded", "Textul este prea lung.");
  }
  return true;
};

const validateBoolean = (
  value: unknown,
  path: string,
  context: ValidationContext,
): value is boolean => {
  if (typeof value !== "boolean") {
    context.add(path, "invalid_type", "Valoarea trebuie să fie booleană.");
    return false;
  }
  return true;
};

const validateNumber = (
  value: unknown,
  path: string,
  context: ValidationContext,
  options: {
    integer?: boolean;
    min?: number;
    max?: number;
  } = {},
): value is number => {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (options.integer === true && !Number.isInteger(value))
  ) {
    context.add(
      path,
      "invalid_type",
      "Valoarea trebuie să fie un număr valid.",
    );
    return false;
  }
  if (options.min !== undefined && value < options.min) {
    context.add(path, "invalid_value", `Valoarea minimă este ${options.min}.`);
  }
  if (options.max !== undefined && value > options.max) {
    context.add(path, "invalid_value", `Valoarea maximă este ${options.max}.`);
  }
  return true;
};

const validateEnum = <T extends string>(
  value: unknown,
  allowed: readonly T[],
  path: string,
  context: ValidationContext,
): value is T => {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    context.add(
      path,
      "invalid_value",
      `Valoarea trebuie să fie una dintre: ${allowed.join(", ")}.`,
    );
    return false;
  }
  return true;
};

const validateId = (
  value: unknown,
  path: string,
  context: ValidationContext,
): value is string => {
  if (!validateString(value, path, context, { min: 1, max: 200 })) {
    return false;
  }
  if (!ID_PATTERN.test(value)) {
    context.add(path, "invalid_format", "Identificatorul nu este valid.");
    return false;
  }
  return true;
};

const validateFieldId = (
  value: unknown,
  path: string,
  context: ValidationContext,
): value is string => {
  if (!validateString(value, path, context, { min: 1, max: 120 })) {
    return false;
  }
  if (!FIELD_ID_PATTERN.test(value)) {
    context.add(
      path,
      "invalid_format",
      "fieldId trebuie să conțină litere mici, cifre și underscore.",
    );
    return false;
  }
  return true;
};

const validateDateTime = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  if (
    validateString(value, path, context, { min: 1, max: 100 }) &&
    Number.isNaN(Date.parse(value))
  ) {
    context.add(path, "invalid_format", "Data trebuie să fie în format ISO.");
  }
};

const validateHttpUrl = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  if (!validateString(value, path, context, { min: 1, max: 4096 })) {
    return;
  }
  try {
    const url = new URL(value);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      throw new Error("Protocol invalid");
    }
  } catch {
    context.add(
      path,
      "invalid_format",
      "URL-ul trebuie să fie HTTP(S), complet și fără credențiale.",
    );
  }
};

const validateLocatorValue = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  if (typeof value === "string") {
    validateString(value, path, context, { min: 1, max: 10_000 });
    return;
  }
  if (!Array.isArray(value)) {
    context.add(
      path,
      "invalid_type",
      "Valoarea locatorului trebuie să fie text sau listă de texte.",
    );
    return;
  }
  if (value.length === 0 || value.length > 100) {
    context.add(
      path,
      "limit_exceeded",
      "Lista locatorului trebuie să conțină între 1 și 100 de valori.",
    );
  }
  value.forEach((item, index) => {
    validateString(item, `${path}[${index}]`, context, {
      min: 1,
      max: 1000,
    });
  });
};

const validateLocator = (
  value: unknown,
  path: string,
  context: ValidationContext,
  depth = 0,
): void => {
  if (depth > 20) {
    context.add(path, "limit_exceeded", "Locatorul este prea adânc.");
    return;
  }
  const locator = requireRecord(value, path, context);
  if (locator === undefined) {
    return;
  }
  const type = locator.type;
  if (
    typeof type === "string" &&
    (SIMPLE_LOCATOR_TYPES as readonly string[]).includes(type)
  ) {
    allowOnly(
      locator,
      ["type", "operator", "value", "caseSensitive", "role", "attribute"],
      path,
      context,
    );
    requireProperties(locator, ["type", "operator", "value"], path, context);
    validateEnum(type, SIMPLE_LOCATOR_TYPES, `${path}.type`, context);
    validateEnum(
      locator.operator,
      MATCH_OPERATORS,
      `${path}.operator`,
      context,
    );
    validateLocatorValue(locator.value, `${path}.value`, context);
    if (locator.caseSensitive !== undefined) {
      validateBoolean(locator.caseSensitive, `${path}.caseSensitive`, context);
    }
    if (type === "role") {
      validateString(locator.role, `${path}.role`, context, {
        min: 1,
        max: 100,
      });
    } else if (locator.role !== undefined) {
      context.add(
        `${path}.role`,
        "invalid_value",
        "Câmpul role este permis numai locatorului de tip role.",
      );
    }
    if (type === "data_attribute") {
      if (
        validateString(locator.attribute, `${path}.attribute`, context, {
          min: 1,
          max: 200,
        }) &&
        !/^(?:data-|aria-)[a-zA-Z0-9_.:-]+$/.test(locator.attribute)
      ) {
        context.add(
          `${path}.attribute`,
          "invalid_format",
          "Este permis numai un atribut data-* sau aria-*.",
        );
      }
    } else if (locator.attribute !== undefined) {
      context.add(
        `${path}.attribute`,
        "invalid_value",
        "Câmpul attribute este permis numai locatorului data_attribute.",
      );
    }
    if (locator.operator === "regex" && typeof locator.value === "string") {
      try {
        void new RegExp(locator.value);
      } catch {
        context.add(
          `${path}.value`,
          "invalid_format",
          "Expresia regulată nu este validă.",
        );
      }
    }
    return;
  }

  if (type === "relative") {
    allowOnly(locator, ["type", "anchor", "relation", "target"], path, context);
    requireProperties(
      locator,
      ["type", "anchor", "relation", "target"],
      path,
      context,
    );
    validateEnum(
      locator.relation,
      RELATIVE_LOCATOR_RELATIONS,
      `${path}.relation`,
      context,
    );
    validateLocator(locator.anchor, `${path}.anchor`, context, depth + 1);
    validateLocator(locator.target, `${path}.target`, context, depth + 1);
    return;
  }

  if (type === "repeated_component") {
    allowOnly(
      locator,
      ["type", "container", "filters", "targetInsideContainer"],
      path,
      context,
    );
    requireProperties(
      locator,
      ["type", "container", "filters", "targetInsideContainer"],
      path,
      context,
    );
    validateLocator(locator.container, `${path}.container`, context, depth + 1);
    if (!Array.isArray(locator.filters)) {
      context.add(
        `${path}.filters`,
        "invalid_type",
        "Filtrele trebuie să fie o listă.",
      );
    } else {
      if (locator.filters.length === 0 || locator.filters.length > 50) {
        context.add(
          `${path}.filters`,
          "limit_exceeded",
          "Componenta repetitivă trebuie să aibă între 1 și 50 de filtre.",
        );
      }
      locator.filters.forEach((filterValue, index) => {
        validateComponentFilter(
          filterValue,
          `${path}.filters[${index}]`,
          context,
          depth + 1,
        );
      });
    }
    validateLocator(
      locator.targetInsideContainer,
      `${path}.targetInsideContainer`,
      context,
      depth + 1,
    );
    return;
  }

  context.add(
    `${path}.type`,
    "invalid_value",
    "Tipul locatorului nu este suportat.",
  );
};

const validateComponentFilter = (
  value: unknown,
  path: string,
  context: ValidationContext,
  depth: number,
): void => {
  const filter = requireRecord(value, path, context);
  if (filter === undefined) {
    return;
  }
  allowOnly(
    filter,
    ["field", "operator", "value", "caseSensitive"],
    path,
    context,
  );
  requireProperties(filter, ["field", "operator", "value"], path, context);
  validateLocator(filter.field, `${path}.field`, context, depth + 1);
  validateEnum(filter.operator, MATCH_OPERATORS, `${path}.operator`, context);
  validateLocatorValue(filter.value, `${path}.value`, context);
  if (filter.caseSensitive !== undefined) {
    validateBoolean(filter.caseSensitive, `${path}.caseSensitive`, context);
  }
};

const validateTarget = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const target = requireRecord(value, path, context);
  if (target === undefined) {
    return;
  }
  allowOnly(target, ["fieldId", "primary", "stability"], path, context);
  requireProperties(target, ["primary"], path, context);
  if (target.fieldId !== undefined) {
    validateFieldId(target.fieldId, `${path}.fieldId`, context);
  }
  validateLocator(target.primary, `${path}.primary`, context);
  if (target.stability !== undefined) {
    validateNumber(target.stability, `${path}.stability`, context, {
      min: 0,
      max: 1,
    });
  }
};

const validateFallback = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const fallback = requireRecord(value, path, context);
  if (fallback === undefined) {
    return;
  }
  allowOnly(
    fallback,
    ["locator", "humanDescription", "whyExplanation"],
    path,
    context,
  );
  requireProperties(
    fallback,
    ["locator", "humanDescription", "whyExplanation"],
    path,
    context,
  );
  validateLocator(fallback.locator, `${path}.locator`, context);
  validateString(
    fallback.humanDescription,
    `${path}.humanDescription`,
    context,
    { min: 1, max: 2000 },
  );
  validateString(fallback.whyExplanation, `${path}.whyExplanation`, context, {
    min: 1,
    max: 2000,
  });
};

const validateWait = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const wait = requireRecord(value, path, context);
  if (wait === undefined) {
    return;
  }
  allowOnly(wait, ["type", "timeoutMs", "target", "value"], path, context);
  requireProperties(wait, ["type"], path, context);
  const typeValid = validateEnum(
    wait.type,
    WAIT_TYPES,
    `${path}.type`,
    context,
  );
  if (wait.timeoutMs !== undefined) {
    validateNumber(wait.timeoutMs, `${path}.timeoutMs`, context, {
      integer: true,
      min: 0,
      max: 3_600_000,
    });
  }
  if (wait.target !== undefined) {
    validateLocator(wait.target, `${path}.target`, context);
  }
  if (wait.value !== undefined) {
    validateString(wait.value, `${path}.value`, context, {
      min: 1,
      max: 4096,
    });
  }
  if (typeValid && wait.type === "element" && wait.target === undefined) {
    context.add(
      `${path}.target`,
      "missing_property",
      "Așteptarea după element necesită target.",
    );
  }
  if (typeValid && wait.type === "url" && wait.value === undefined) {
    context.add(
      `${path}.value`,
      "missing_property",
      "Așteptarea după URL necesită value.",
    );
  }
  if (typeValid && wait.type === "timeout" && wait.timeoutMs === undefined) {
    context.add(
      `${path}.timeoutMs`,
      "missing_property",
      "Așteptarea timeout necesită timeoutMs.",
    );
  }
};

const validateRepeatUntil = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const condition = requireRecord(value, path, context);
  if (condition === undefined) return;
  allowOnly(
    condition,
    ["target", "operator", "value", "maxAttempts"],
    path,
    context,
  );
  requireProperties(
    condition,
    ["target", "operator", "value", "maxAttempts"],
    path,
    context,
  );
  validateLocator(condition.target, `${path}.target`, context);
  validateEnum(
    condition.operator,
    MATCH_OPERATORS,
    `${path}.operator`,
    context,
  );
  validateString(condition.value, `${path}.value`, context, {
    min: 1,
    max: 1_000,
  });
  validateNumber(condition.maxAttempts, `${path}.maxAttempts`, context, {
    integer: true,
    min: 1,
    max: 24,
  });
};

const validateActionStep = (
  action: JsonRecord,
  path: string,
  context: ValidationContext,
): void => {
  const allowed = [
    "id",
    "type",
    "actionType",
    "title",
    "humanDescription",
    "whyExplanation",
    "pageId",
    "target",
    "inputFieldId",
    "valueKey",
    "valueStrategy",
    "url",
    "key",
    "scrollX",
    "scrollY",
    "repeat",
    "repeatUntil",
    "waitAfter",
    "fallbacks",
    "enabled",
  ] as const;
  allowOnly(action, allowed, path, context);
  requireProperties(
    action,
    [
      "id",
      "type",
      "actionType",
      "title",
      "humanDescription",
      "whyExplanation",
      "fallbacks",
      "enabled",
    ],
    path,
    context,
  );
  validateId(action.id, `${path}.id`, context);
  const actionType = action.actionType;
  const actionTypeValid = validateEnum(
    actionType,
    ACTION_TYPES,
    `${path}.actionType`,
    context,
  );
  validateString(action.title, `${path}.title`, context, {
    min: 1,
    max: 200,
  });
  validateString(action.humanDescription, `${path}.humanDescription`, context, {
    min: 1,
    max: 4000,
  });
  validateString(action.whyExplanation, `${path}.whyExplanation`, context, {
    min: 1,
    max: 4000,
  });
  if (action.pageId !== undefined) {
    validateId(action.pageId, `${path}.pageId`, context);
  }
  if (action.target !== undefined) {
    validateTarget(action.target, `${path}.target`, context);
  }
  if (action.inputFieldId !== undefined) {
    validateFieldId(action.inputFieldId, `${path}.inputFieldId`, context);
  }
  if (action.valueKey !== undefined) {
    validateFieldId(action.valueKey, `${path}.valueKey`, context);
  }
  if (action.valueStrategy !== undefined) {
    validateEnum(
      action.valueStrategy,
      ["dataset", "manual"] as const,
      `${path}.valueStrategy`,
      context,
    );
  }
  if (action.url !== undefined) {
    validateHttpUrl(action.url, `${path}.url`, context);
  }
  if (action.key !== undefined) {
    validateString(action.key, `${path}.key`, context, {
      min: 1,
      max: 100,
    });
  }
  if (action.scrollX !== undefined) {
    validateNumber(action.scrollX, `${path}.scrollX`, context, {
      integer: true,
      min: -100000,
      max: 100000,
    });
  }
  if (action.scrollY !== undefined) {
    validateNumber(action.scrollY, `${path}.scrollY`, context, {
      integer: true,
      min: -100000,
      max: 100000,
    });
  }
  if (action.repeat !== undefined) {
    validateNumber(action.repeat, `${path}.repeat`, context, {
      integer: true,
      min: 0,
      max: 24,
    });
  }
  if (action.repeatUntil !== undefined) {
    validateRepeatUntil(action.repeatUntil, `${path}.repeatUntil`, context);
  }
  if (action.repeat !== undefined && action.repeatUntil !== undefined) {
    context.add(
      `${path}.repeatUntil`,
      "invalid_value",
      "repeat și repeatUntil nu pot fi folosite împreună.",
    );
  }
  if (action.waitAfter !== undefined) {
    validateWait(action.waitAfter, `${path}.waitAfter`, context);
  }
  if (!Array.isArray(action.fallbacks)) {
    context.add(
      `${path}.fallbacks`,
      "invalid_type",
      "Fallback-urile trebuie să fie o listă.",
    );
  } else {
    if (action.fallbacks.length > 3) {
      context.add(
        `${path}.fallbacks`,
        "limit_exceeded",
        "Un pas poate avea maximum 3 fallback-uri.",
      );
    }
    action.fallbacks.forEach((fallback, index) => {
      validateFallback(fallback, `${path}.fallbacks[${index}]`, context);
    });
  }
  validateBoolean(action.enabled, `${path}.enabled`, context);

  if (!actionTypeValid) {
    return;
  }
  const targetActions = new Set([
    "click",
    "fill",
    "select_option",
    "check",
    "uncheck",
    "wait_for_element",
    "choose_repeated_item",
    "calendar_select",
  ]);
  if (targetActions.has(actionType) && action.target === undefined) {
    context.add(
      `${path}.target`,
      "missing_property",
      `Acțiunea ${actionType} necesită target.`,
    );
  }
  if (
    ["navigate", "wait_for_url"].includes(actionType) &&
    action.url === undefined
  ) {
    context.add(
      `${path}.url`,
      "missing_property",
      `Acțiunea ${actionType} necesită URL.`,
    );
  }
  if (
    ["fill", "select_option"].includes(actionType) &&
    action.inputFieldId === undefined
  ) {
    context.add(
      `${path}.inputFieldId`,
      "missing_property",
      `Acțiunea ${actionType} necesită inputFieldId.`,
    );
  }
  if (
    ["fill", "select_option"].includes(actionType) &&
    action.valueStrategy === undefined
  ) {
    context.add(
      `${path}.valueStrategy`,
      "missing_property",
      `Acțiunea ${actionType} necesită valueStrategy.`,
    );
  }
  if (
    ["fill", "select_option"].includes(actionType) &&
    action.valueStrategy === "dataset" &&
    action.valueKey === undefined
  ) {
    context.add(
      `${path}.valueKey`,
      "missing_property",
      "Valorile din dataset necesită valueKey.",
    );
  }
  if (actionType === "press_key" && action.key === undefined) {
    context.add(
      `${path}.key`,
      "missing_property",
      "Acțiunea press_key necesită key.",
    );
  }
  if (
    action.repeatUntil !== undefined &&
    !["click", "choose_repeated_item", "calendar_select"].includes(actionType)
  ) {
    context.add(
      `${path}.repeatUntil`,
      "invalid_value",
      `Acțiunea ${actionType} nu poate folosi repeatUntil.`,
    );
  }
};

const validateElementCheck = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const config = requireRecord(value, path, context);
  if (!config) {
    return;
  }
  allowOnly(config, ["target", "state"], path, context);
  requireProperties(config, ["target", "state"], path, context);
  validateLocator(config.target, `${path}.target`, context);
  validateEnum(
    config.state,
    [
      "visible",
      "hidden",
      "enabled",
      "disabled",
      "checked",
      "unchecked",
    ] as const,
    `${path}.state`,
    context,
  );
};

const validateTextCheck = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const config = requireRecord(value, path, context);
  if (!config) {
    return;
  }
  allowOnly(
    config,
    ["target", "operator", "value", "caseSensitive"],
    path,
    context,
  );
  requireProperties(config, ["target", "operator", "value"], path, context);
  validateLocator(config.target, `${path}.target`, context);
  validateEnum(config.operator, MATCH_OPERATORS, `${path}.operator`, context);
  validateLocatorValue(config.value, `${path}.value`, context);
  if (config.caseSensitive !== undefined) {
    validateBoolean(config.caseSensitive, `${path}.caseSensitive`, context);
  }
};

const validateUrlCheck = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const config = requireRecord(value, path, context);
  if (!config) {
    return;
  }
  allowOnly(config, ["operator", "value", "caseSensitive"], path, context);
  requireProperties(config, ["operator", "value"], path, context);
  validateEnum(config.operator, MATCH_OPERATORS, `${path}.operator`, context);
  validateString(config.value, `${path}.value`, context, {
    min: 1,
    max: 4096,
  });
  if (config.caseSensitive !== undefined) {
    validateBoolean(config.caseSensitive, `${path}.caseSensitive`, context);
  }
};

const validateMysqlCheck = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const config = requireRecord(value, path, context);
  if (!config) {
    return;
  }
  allowOnly(config, ["tableNames", "identities"], path, context);
  requireProperties(config, ["tableNames", "identities"], path, context);
  if (!Array.isArray(config.tableNames) || config.tableNames.length === 0) {
    context.add(
      `${path}.tableNames`,
      "invalid_type",
      "Check-ul MySQL necesită cel puțin un tabel.",
    );
  } else {
    config.tableNames.forEach((name, index) => {
      validateString(name, `${path}.tableNames[${index}]`, context, {
        min: 1,
        max: 200,
      });
    });
  }
  if (!Array.isArray(config.identities)) {
    context.add(
      `${path}.identities`,
      "invalid_type",
      "Identitățile tabelelor trebuie să fie o listă.",
    );
  } else {
    config.identities.forEach((identityValue, index) => {
      const identityPath = `${path}.identities[${index}]`;
      const identity = requireRecord(identityValue, identityPath, context);
      if (!identity) {
        return;
      }
      allowOnly(identity, ["tableName", "columns"], identityPath, context);
      requireProperties(
        identity,
        ["tableName", "columns"],
        identityPath,
        context,
      );
      validateString(identity.tableName, `${identityPath}.tableName`, context, {
        min: 1,
        max: 200,
      });
      if (!Array.isArray(identity.columns) || identity.columns.length === 0) {
        context.add(
          `${identityPath}.columns`,
          "invalid_type",
          "Identitatea necesită cel puțin o coloană.",
        );
      } else {
        identity.columns.forEach((column, columnIndex) => {
          validateString(
            column,
            `${identityPath}.columns[${columnIndex}]`,
            context,
            { min: 1, max: 200 },
          );
        });
      }
    });
  }
};

const validateImapCheck = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  const config = requireRecord(value, path, context);
  if (!config) {
    return;
  }
  const allowed = [
    "accountId",
    "receivedAfterTestStart",
    "sender",
    "recipient",
    "subjectEquals",
    "subjectContains",
    "bodyContains",
    "mailbox",
  ] as const;
  allowOnly(config, allowed, path, context);
  requireProperties(
    config,
    ["accountId", "receivedAfterTestStart"],
    path,
    context,
  );
  validateId(config.accountId, `${path}.accountId`, context);
  if (config.receivedAfterTestStart !== true) {
    context.add(
      `${path}.receivedAfterTestStart`,
      "invalid_value",
      "Filtrul receivedAfterTestStart trebuie să fie activ.",
    );
  }
  for (const property of allowed.slice(2)) {
    if (config[property] !== undefined) {
      validateString(config[property], `${path}.${property}`, context, {
        max: property === "bodyContains" ? 10_000 : 1000,
      });
    }
  }
};

const validateCheckStep = (
  check: JsonRecord,
  path: string,
  context: ValidationContext,
): void => {
  allowOnly(
    check,
    [
      "id",
      "type",
      "checkType",
      "title",
      "humanDescription",
      "config",
      "enabled",
    ],
    path,
    context,
  );
  requireProperties(
    check,
    [
      "id",
      "type",
      "checkType",
      "title",
      "humanDescription",
      "config",
      "enabled",
    ],
    path,
    context,
  );
  validateId(check.id, `${path}.id`, context);
  const checkTypeValid = validateEnum(
    check.checkType,
    ["element", "text", "url", "mysql", "imap"] as const,
    `${path}.checkType`,
    context,
  );
  validateString(check.title, `${path}.title`, context, {
    min: 1,
    max: 200,
  });
  validateString(check.humanDescription, `${path}.humanDescription`, context, {
    min: 1,
    max: 4000,
  });
  validateBoolean(check.enabled, `${path}.enabled`, context);
  if (!checkTypeValid) {
    return;
  }
  switch (check.checkType) {
    case "element":
      validateElementCheck(check.config, `${path}.config`, context);
      break;
    case "text":
      validateTextCheck(check.config, `${path}.config`, context);
      break;
    case "url":
      validateUrlCheck(check.config, `${path}.config`, context);
      break;
    case "mysql":
      validateMysqlCheck(check.config, `${path}.config`, context);
      break;
    case "imap":
      validateImapCheck(check.config, `${path}.config`, context);
      break;
  }
};

const validateBreakpoint = (
  breakpoint: JsonRecord,
  path: string,
  context: ValidationContext,
): void => {
  allowOnly(
    breakpoint,
    ["id", "type", "title", "instructions", "enabled"],
    path,
    context,
  );
  requireProperties(breakpoint, ["id", "type", "enabled"], path, context);
  validateId(breakpoint.id, `${path}.id`, context);
  if (breakpoint.title !== undefined) {
    validateString(breakpoint.title, `${path}.title`, context, { max: 200 });
  }
  if (breakpoint.instructions !== undefined) {
    validateString(breakpoint.instructions, `${path}.instructions`, context, {
      max: 4000,
    });
  }
  validateBoolean(breakpoint.enabled, `${path}.enabled`, context);
};

const validateManualIntervention = (
  manual: JsonRecord,
  path: string,
  context: ValidationContext,
): void => {
  allowOnly(
    manual,
    [
      "id",
      "type",
      "title",
      "instructions",
      "humanDescription",
      "whyExplanation",
      "completionShortcut",
      "enabled",
    ],
    path,
    context,
  );
  requireProperties(
    manual,
    [
      "id",
      "type",
      "title",
      "instructions",
      "humanDescription",
      "whyExplanation",
      "enabled",
    ],
    path,
    context,
  );
  validateId(manual.id, `${path}.id`, context);
  for (const property of [
    "title",
    "instructions",
    "humanDescription",
    "whyExplanation",
  ] as const) {
    validateString(manual[property], `${path}.${property}`, context, {
      min: 1,
      max: property === "title" ? 200 : 4000,
    });
  }
  if (manual.completionShortcut !== undefined) {
    validateString(
      manual.completionShortcut,
      `${path}.completionShortcut`,
      context,
      { min: 1, max: 100 },
    );
  }
  validateBoolean(manual.enabled, `${path}.enabled`, context);
};

const validateFlowItem = (
  value: unknown,
  path: string,
  context: ValidationContext,
): string | undefined => {
  const item = requireRecord(value, path, context);
  if (!item) {
    return undefined;
  }
  const type = item.type;
  if (type === "action") {
    validateActionStep(item, path, context);
  } else if (type === "check") {
    validateCheckStep(item, path, context);
  } else if (type === "breakpoint") {
    validateBreakpoint(item, path, context);
  } else if (type === "manual_intervention") {
    validateManualIntervention(item, path, context);
  } else {
    context.add(
      `${path}.type`,
      "invalid_value",
      "Elementul flow-ului are un tip necunoscut.",
    );
  }
  return typeof item.id === "string" ? item.id : undefined;
};

const isPrimitive = (value: unknown): boolean =>
  value === null ||
  typeof value === "string" ||
  typeof value === "number" ||
  typeof value === "boolean";

const validatePrimitive = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  if (
    !isPrimitive(value) ||
    (typeof value === "number" && !Number.isFinite(value))
  ) {
    context.add(
      path,
      "invalid_type",
      "Valoarea trebuie să fie text, număr, boolean sau null.",
    );
  }
  if (typeof value === "string") {
    validateString(value, path, context, { max: MAX_STRING_LENGTH });
  }
};

const validateDatasetValue = (
  value: unknown,
  path: string,
  context: ValidationContext,
): void => {
  if (isPrimitive(value)) {
    validatePrimitive(value, path, context);
    return;
  }
  const item = requireRecord(value, path, context);
  if (!item) {
    return;
  }
  if (item.type === "fixed") {
    allowOnly(item, ["type", "value"], path, context);
    requireProperties(item, ["type", "value"], path, context);
    validatePrimitive(item.value, `${path}.value`, context);
    return;
  }
  if (item.type !== "generated") {
    context.add(
      `${path}.type`,
      "invalid_value",
      "Valoarea dataset-ului are un tip necunoscut.",
    );
    return;
  }
  const strategy = item.strategy;
  if (
    typeof strategy !== "string" ||
    ![
      "timestamp",
      "uuid",
      "random_number",
      "unique_email",
      "current_date",
      "current_date_plus_days",
      "current_date_minus_days",
      "random_choice",
      "template",
    ].includes(strategy)
  ) {
    context.add(
      `${path}.strategy`,
      "invalid_value",
      "Strategia valorii generate nu este suportată.",
    );
    return;
  }
  const base = ["type", "strategy"];
  switch (strategy) {
    case "timestamp":
    case "uuid":
      allowOnly(item, base, path, context);
      requireProperties(item, base, path, context);
      break;
    case "random_number":
      allowOnly(item, [...base, "min", "max"], path, context);
      requireProperties(item, [...base, "min", "max"], path, context);
      if (
        validateNumber(item.min, `${path}.min`, context) &&
        validateNumber(item.max, `${path}.max`, context) &&
        item.min > item.max
      ) {
        context.add(
          `${path}.max`,
          "invalid_value",
          "max trebuie să fie mai mare sau egal cu min.",
        );
      }
      break;
    case "unique_email":
      allowOnly(item, [...base, "template"], path, context);
      requireProperties(item, base, path, context);
      if (item.template !== undefined) {
        validateString(item.template, `${path}.template`, context, {
          max: 1000,
        });
      }
      break;
    case "current_date":
      allowOnly(item, [...base, "format"], path, context);
      requireProperties(item, base, path, context);
      if (item.format !== undefined) {
        validateString(item.format, `${path}.format`, context, { max: 100 });
      }
      break;
    case "current_date_plus_days":
    case "current_date_minus_days":
      allowOnly(item, [...base, "days", "format"], path, context);
      requireProperties(item, [...base, "days"], path, context);
      validateNumber(item.days, `${path}.days`, context, {
        integer: true,
        min: 0,
        max: 36_500,
      });
      if (item.format !== undefined) {
        validateString(item.format, `${path}.format`, context, { max: 100 });
      }
      break;
    case "random_choice":
      allowOnly(item, [...base, "choices"], path, context);
      requireProperties(item, [...base, "choices"], path, context);
      if (!Array.isArray(item.choices) || item.choices.length === 0) {
        context.add(
          `${path}.choices`,
          "invalid_type",
          "random_choice necesită cel puțin o valoare.",
        );
      } else {
        item.choices.forEach((choice, index) => {
          validatePrimitive(choice, `${path}.choices[${index}]`, context);
        });
      }
      break;
    case "template":
      allowOnly(item, [...base, "template"], path, context);
      requireProperties(item, [...base, "template"], path, context);
      validateString(item.template, `${path}.template`, context, {
        min: 1,
        max: 10_000,
      });
      break;
  }
};

const validateDatasetInternal = (
  value: unknown,
  path: string,
  context: ValidationContext,
  expectedTestId?: string,
): string | undefined => {
  const dataset = requireRecord(value, path, context);
  if (!dataset) {
    return undefined;
  }
  allowOnly(
    dataset,
    ["id", "testId", "name", "values", "createdAt", "updatedAt"],
    path,
    context,
  );
  requireProperties(
    dataset,
    ["id", "testId", "name", "values", "createdAt", "updatedAt"],
    path,
    context,
  );
  const idValid = validateId(dataset.id, `${path}.id`, context);
  const testIdValid = validateId(dataset.testId, `${path}.testId`, context);
  if (
    testIdValid &&
    expectedTestId !== undefined &&
    dataset.testId !== expectedTestId
  ) {
    context.add(
      `${path}.testId`,
      "invalid_value",
      "Dataset-ul trebuie să aparțină testului curent.",
    );
  }
  validateString(dataset.name, `${path}.name`, context, {
    min: 1,
    max: 120,
  });
  const values = requireRecord(dataset.values, `${path}.values`, context);
  if (values) {
    if (Object.keys(values).length > 1000) {
      context.add(
        `${path}.values`,
        "limit_exceeded",
        "Dataset-ul poate avea maximum 1000 de valori.",
      );
    }
    for (const [fieldId, datasetValue] of Object.entries(values)) {
      validateFieldId(fieldId, `${path}.values.${fieldId}`, context);
      validateDatasetValue(datasetValue, `${path}.values.${fieldId}`, context);
    }
  }
  validateDateTime(dataset.createdAt, `${path}.createdAt`, context);
  validateDateTime(dataset.updatedAt, `${path}.updatedAt`, context);
  return idValid && typeof dataset.id === "string" ? dataset.id : undefined;
};

export const validateTestDataset = (
  value: unknown,
): ValidationResult<TestDataset> => {
  const context = new ValidationContext();
  context.scanSafety(value);
  validateDatasetInternal(value, "$", context);
  return context.issues.length === 0
    ? { valid: true, data: value as TestDataset, issues: [] }
    : { valid: false, issues: context.issues };
};

export const validateDeclarativeTest = (
  value: unknown,
): ValidationResult<DeclarativeTestDefinition> => {
  const context = new ValidationContext();
  context.scanSafety(value);
  const test = requireRecord(value, "$", context);
  if (!test) {
    return { valid: false, issues: context.issues };
  }
  allowOnly(
    test,
    [
      "schemaVersion",
      "id",
      "projectId",
      "name",
      "description",
      "status",
      "version",
      "wipeBeforeRun",
      "startMode",
      "startUrl",
      "createdAt",
      "updatedAt",
      "flowItems",
      "datasets",
    ],
    "$",
    context,
  );
  requireProperties(
    test,
    [
      "schemaVersion",
      "id",
      "projectId",
      "name",
      "status",
      "version",
      "wipeBeforeRun",
      "startMode",
      "startUrl",
      "createdAt",
      "updatedAt",
      "flowItems",
      "datasets",
    ],
    "$",
    context,
  );
  if (test.schemaVersion !== 1) {
    context.add(
      "$.schemaVersion",
      "invalid_value",
      "Este suportată numai schemaVersion 1.",
    );
  }
  const idValid = validateId(test.id, "$.id", context);
  validateId(test.projectId, "$.projectId", context);
  validateString(test.name, "$.name", context, { min: 1, max: 120 });
  if (test.description !== undefined) {
    validateString(test.description, "$.description", context, { max: 2000 });
  }
  validateEnum(
    test.status,
    ["draft", "valid", "invalidated"] as const,
    "$.status",
    context,
  );
  validateNumber(test.version, "$.version", context, {
    integer: true,
    min: 1,
  });
  validateBoolean(test.wipeBeforeRun, "$.wipeBeforeRun", context);
  validateEnum(
    test.startMode,
    ["base_url", "current_page"] as const,
    "$.startMode",
    context,
  );
  validateHttpUrl(test.startUrl, "$.startUrl", context);
  validateDateTime(test.createdAt, "$.createdAt", context);
  validateDateTime(test.updatedAt, "$.updatedAt", context);

  const flowIds = new Set<string>();
  if (!Array.isArray(test.flowItems)) {
    context.add(
      "$.flowItems",
      "invalid_type",
      "flowItems trebuie să fie o listă.",
    );
  } else {
    test.flowItems.forEach((item, index) => {
      const itemId = validateFlowItem(item, `$.flowItems[${index}]`, context);
      if (itemId) {
        if (flowIds.has(itemId)) {
          context.add(
            `$.flowItems[${index}].id`,
            "duplicate_id",
            `ID-ul de flow „${itemId}” este duplicat.`,
          );
        }
        flowIds.add(itemId);
      }
    });
  }

  const datasetIds = new Set<string>();
  if (!Array.isArray(test.datasets)) {
    context.add(
      "$.datasets",
      "invalid_type",
      "datasets trebuie să fie o listă.",
    );
  } else {
    const expectedTestId =
      idValid && typeof test.id === "string" ? test.id : undefined;
    test.datasets.forEach((dataset, index) => {
      const datasetId = validateDatasetInternal(
        dataset,
        `$.datasets[${index}]`,
        context,
        expectedTestId,
      );
      if (datasetId) {
        if (datasetIds.has(datasetId)) {
          context.add(
            `$.datasets[${index}].id`,
            "duplicate_id",
            `ID-ul de dataset „${datasetId}” este duplicat.`,
          );
        }
        datasetIds.add(datasetId);
      }
    });
  }

  return context.issues.length === 0
    ? {
        valid: true,
        data: value as DeclarativeTestDefinition,
        issues: [],
      }
    : { valid: false, issues: context.issues };
};

export const parseDeclarativeTestJson = (
  json: string,
): ValidationResult<DeclarativeTestDefinition> => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {
      valid: false,
      issues: [
        {
          path: "$",
          code: "invalid_json",
          message: "Fișierul nu conține JSON valid.",
        },
      ],
    };
  }
  return validateDeclarativeTest(value);
};

export const parseTestDatasetJson = (
  json: string,
): ValidationResult<TestDataset> => {
  let value: unknown;
  try {
    value = JSON.parse(json) as unknown;
  } catch {
    return {
      valid: false,
      issues: [
        {
          path: "$",
          code: "invalid_json",
          message: "Fișierul nu conține JSON valid.",
        },
      ],
    };
  }
  return validateTestDataset(value);
};

export class TestSchemaValidationError extends Error {
  public constructor(public readonly issues: ValidationIssue[]) {
    super(issues[0]?.message ?? "Documentul testului nu este valid.");
    this.name = "TestSchemaValidationError";
  }
}

export const assertValidDeclarativeTest = (
  value: unknown,
): DeclarativeTestDefinition => {
  const result = validateDeclarativeTest(value);
  if (!result.valid) {
    throw new TestSchemaValidationError(result.issues);
  }
  return result.data;
};

export const assertValidTestDataset = (value: unknown): TestDataset => {
  const result = validateTestDataset(value);
  if (!result.valid) {
    throw new TestSchemaValidationError(result.issues);
  }
  return result.data;
};
