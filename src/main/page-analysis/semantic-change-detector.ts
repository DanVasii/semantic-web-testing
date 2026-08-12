import type {
  SemanticChangeCategory,
  SemanticChangeMetric,
  SemanticChangeSummary,
} from "../../shared/page-analysis.js";
import type { SemanticAnalysis } from "../../shared/semantic-analysis.js";
import type { CapturedElement, CapturedForm } from "./page-capture.js";

export interface SemanticComparisonSnapshot {
  dom: string;
  interactiveElements: CapturedElement[];
  forms: CapturedForm[];
  semanticAnalysis: SemanticAnalysis;
}

export interface SemanticChangeDetectorInput {
  previousPageVersionId: string;
  currentPageVersionId: string;
  previous: SemanticComparisonSnapshot;
  current: SemanticComparisonSnapshot;
  threshold: number;
}

interface NormalizationStats {
  dynamicIds: number;
  tokens: number;
}

const TOKEN_ATTRIBUTE_PATTERN =
  /^(?:csrf|xsrf|token|nonce|auth|authorization|session|sessionid|request-id|trace-id)$/i;
const TOKEN_VALUE_PATTERN =
  /(?:eyJ[a-zA-Z0-9_-]{12,}\.[a-zA-Z0-9_-]{8,}|[a-f0-9]{24,}|[a-zA-Z0-9_-]{32,})/g;
const UUID_PATTERN =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;
const DYNAMIC_ID_PATTERN =
  /^(?:react|vue|ember|headlessui|radix|mui|generated|auto)[-_:.]|\d{6,}|[a-f0-9]{12,}$/i;

const normalizeText = (value: string): string =>
  value.replaceAll(/\s+/g, " ").trim().toLocaleLowerCase("ro");

const sanitizeValue = (value: string, stats: NormalizationStats): string => {
  const withoutUuids = value.replace(UUID_PATTERN, () => {
    stats.tokens += 1;
    return "[token]";
  });
  return withoutUuids.replace(TOKEN_VALUE_PATTERN, () => {
    stats.tokens += 1;
    return "[token]";
  });
};

export const normalizeDomForComparison = (
  dom: string,
): { value: string; stats: NormalizationStats } => {
  const stats: NormalizationStats = { dynamicIds: 0, tokens: 0 };
  const withoutVolatileNodes = dom
    .replaceAll(/<!--[\s\S]*?-->/g, "")
    .replaceAll(
      /<(?:script|noscript)[^>]*>[\s\S]*?<\/(?:script|noscript)>/gi,
      "",
    );
  const normalizedAttributes = withoutVolatileNodes.replace(
    /\s([:\w-]+)\s*=\s*(["'])(.*?)\2/g,
    (_match, rawName: string, quote: string, rawValue: string) => {
      const name = rawName.toLocaleLowerCase("en");
      if (TOKEN_ATTRIBUTE_PATTERN.test(name)) {
        stats.tokens += 1;
        return ` ${name}=${quote}[token]${quote}`;
      }
      if (name === "id" && DYNAMIC_ID_PATTERN.test(rawValue)) {
        stats.dynamicIds += 1;
        return ` id=${quote}[dynamic-id]${quote}`;
      }
      return ` ${name}=${quote}${sanitizeValue(rawValue, stats)}${quote}`;
    },
  );
  return {
    value: normalizeText(normalizedAttributes),
    stats,
  };
};

const stableAttributes = (
  attributes: Record<string, string>,
  stats: NormalizationStats,
): string =>
  Object.entries(attributes)
    .filter(([name, value]) => {
      if (TOKEN_ATTRIBUTE_PATTERN.test(name)) {
        stats.tokens += 1;
        return false;
      }
      if (name === "id" && DYNAMIC_ID_PATTERN.test(value)) {
        stats.dynamicIds += 1;
        return false;
      }
      return [
        "aria-label",
        "href",
        "name",
        "placeholder",
        "role",
        "title",
        "type",
      ].includes(name);
    })
    .map(([name, value]) => `${name}=${sanitizeValue(value, stats)}`)
    .sort()
    .join("|");

const elementSignature = (
  element: CapturedElement,
  stats: NormalizationStats,
): string =>
  [
    element.tag,
    stableAttributes(element.attributes, stats),
    normalizeText(element.text).slice(0, 180),
    element.formPath === null ? "" : element.formPath.replaceAll(/\d+/g, "#"),
  ].join("::");

const formSignature = (
  form: CapturedForm,
  elementsByPath: Map<string, CapturedElement>,
  stats: NormalizationStats,
): string => {
  const action = (() => {
    try {
      const url = new URL(form.action);
      return `${url.origin}${url.pathname}`;
    } catch {
      return sanitizeValue(form.action, stats);
    }
  })();
  const fields = form.fieldPaths
    .map((path) => elementsByPath.get(path))
    .filter((element): element is CapturedElement => element !== undefined)
    .map((element) => elementSignature(element, stats))
    .sort();
  return [
    normalizeText(form.name),
    form.method.toUpperCase(),
    action,
    fields.join("~~"),
  ].join("::");
};

const labelSignatures = (analysis: SemanticAnalysis): string[] =>
  analysis.elements.map((element) =>
    [
      element.fieldId,
      element.role,
      normalizeText(element.label ?? ""),
      normalizeText(element.accessibleName),
    ].join("::"),
  );

const repeatedSignatures = (analysis: SemanticAnalysis): string[] =>
  analysis.repeatedComponents.map((component) =>
    [
      component.id,
      normalizeText(component.semanticName),
      String(component.repeatedCount),
      component.childFields
        .map(
          (field) =>
            `${field.fieldId}:${field.role}:${normalizeText(field.accessibleName)}`,
        )
        .sort()
        .join("|"),
      component.actions
        .map(
          (field) =>
            `${field.fieldId}:${field.role}:${normalizeText(field.accessibleName)}`,
        )
        .sort()
        .join("|"),
    ].join("::"),
  );

const frequency = (values: string[]): Map<string, number> => {
  const result = new Map<string, number>();
  for (const value of values) result.set(value, (result.get(value) ?? 0) + 1);
  return result;
};

const metric = (
  category: SemanticChangeCategory,
  previousValues: string[],
  currentValues: string[],
): SemanticChangeMetric => {
  const previous = frequency(previousValues);
  const current = frequency(currentValues);
  const keys = new Set([...previous.keys(), ...current.keys()]);
  let intersection = 0;
  let union = 0;
  let added = 0;
  let removed = 0;
  for (const key of keys) {
    const before = previous.get(key) ?? 0;
    const after = current.get(key) ?? 0;
    intersection += Math.min(before, after);
    union += Math.max(before, after);
    if (after > before) added += after - before;
    if (before > after) removed += before - after;
  }
  return {
    category,
    score: union === 0 ? 0 : Number((1 - intersection / union).toFixed(4)),
    previousCount: previousValues.length,
    currentCount: currentValues.length,
    added,
    removed,
  };
};

const domTokens = (value: string): string[] =>
  value
    .split(/(?=<)|(?<=>)|\s+/)
    .map(normalizeText)
    .filter((token) => token.length > 0);

export const detectSemanticChange = (
  input: SemanticChangeDetectorInput,
): SemanticChangeSummary => {
  if (
    !Number.isFinite(input.threshold) ||
    input.threshold < 0 ||
    input.threshold > 1
  ) {
    throw new Error("Pragul schimbării semantice trebuie să fie între 0 și 1.");
  }
  const previousDom = normalizeDomForComparison(input.previous.dom);
  const currentDom = normalizeDomForComparison(input.current.dom);
  const previousStats: NormalizationStats = {
    dynamicIds: previousDom.stats.dynamicIds,
    tokens: previousDom.stats.tokens,
  };
  const currentStats: NormalizationStats = {
    dynamicIds: currentDom.stats.dynamicIds,
    tokens: currentDom.stats.tokens,
  };
  const previousElementsByPath = new Map(
    input.previous.interactiveElements.map((element) => [
      element.path,
      element,
    ]),
  );
  const currentElementsByPath = new Map(
    input.current.interactiveElements.map((element) => [element.path, element]),
  );
  const metrics = [
    metric("dom", domTokens(previousDom.value), domTokens(currentDom.value)),
    metric(
      "interactive_elements",
      input.previous.interactiveElements.map((element) =>
        elementSignature(element, previousStats),
      ),
      input.current.interactiveElements.map((element) =>
        elementSignature(element, currentStats),
      ),
    ),
    metric(
      "forms",
      input.previous.forms.map((form) =>
        formSignature(form, previousElementsByPath, previousStats),
      ),
      input.current.forms.map((form) =>
        formSignature(form, currentElementsByPath, currentStats),
      ),
    ),
    metric(
      "labels",
      labelSignatures(input.previous.semanticAnalysis),
      labelSignatures(input.current.semanticAnalysis),
    ),
    metric(
      "repeated_components",
      repeatedSignatures(input.previous.semanticAnalysis),
      repeatedSignatures(input.current.semanticAnalysis),
    ),
  ] satisfies SemanticChangeMetric[];
  const weights: Record<SemanticChangeCategory, number> = {
    dom: 0.1,
    interactive_elements: 0.35,
    forms: 0.2,
    labels: 0.2,
    repeated_components: 0.15,
  };
  const score = Number(
    metrics
      .reduce((total, item) => total + item.score * weights[item.category], 0)
      .toFixed(4),
  );
  return {
    previousPageVersionId: input.previousPageVersionId,
    currentPageVersionId: input.currentPageVersionId,
    score,
    threshold: input.threshold,
    exceeded: score >= input.threshold,
    metrics,
    ignoredDynamicIds: previousStats.dynamicIds + currentStats.dynamicIds,
    ignoredTokens: previousStats.tokens + currentStats.tokens,
  };
};
