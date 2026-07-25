import type {
  RecorderElementSnapshot,
  RecorderRawEvent,
  RecorderStepDraft,
} from "../../shared/recorder.js";
import type {
  ActionStep,
  LocatorDefinition,
  LocatorFallback,
  SimpleLocator,
} from "../../shared/test-model.js";

export interface RecorderStepBuilderOptions {
  createId: () => string;
  pageId?: string;
}

const compactText = (value: string | undefined): string | undefined => {
  const compacted = value?.replace(/\s+/g, " ").trim();
  return compacted === undefined || compacted.length === 0
    ? undefined
    : compacted.slice(0, 200);
};

export const toSemanticFieldId = (value: string): string => {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
  return normalized.length === 0 ? "recorded_field" : normalized;
};

const elementName = (target: RecorderElementSnapshot): string =>
  compactText(
    target.label ??
      target.ariaLabel ??
      target.text ??
      target.placeholder ??
      target.name ??
      target.id,
  ) ?? target.tagName;

const escapeCssIdentifier = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]/g, (character) => {
    const codePoint = character.codePointAt(0)?.toString(16) ?? "0";
    return `\\${codePoint} `;
  });

const simpleLocatorCandidates = (
  target: RecorderElementSnapshot,
): SimpleLocator[] => {
  const candidates: SimpleLocator[] = [];
  const testId =
    target.dataAttributes["data-testid"] ??
    target.dataAttributes["data-test"] ??
    target.dataAttributes["data-cy"];
  if (testId !== undefined) {
    candidates.push({
      type: "data_attribute",
      attribute:
        target.dataAttributes["data-testid"] === testId
          ? "data-testid"
          : target.dataAttributes["data-test"] === testId
            ? "data-test"
            : "data-cy",
      operator: "equals",
      value: testId,
    });
  }
  const label = compactText(target.label);
  if (label !== undefined) {
    candidates.push({ type: "label", operator: "equals", value: label });
  }
  const accessibleName = compactText(target.ariaLabel ?? target.text);
  if (target.role !== undefined && accessibleName !== undefined) {
    candidates.push({
      type: "role",
      role: target.role,
      operator: "equals",
      value: accessibleName,
    });
  }
  const placeholder = compactText(target.placeholder);
  if (placeholder !== undefined) {
    candidates.push({
      type: "placeholder",
      operator: "equals",
      value: placeholder,
    });
  }
  if (target.id !== undefined && target.id.length > 0) {
    candidates.push({
      type: "css",
      operator: "equals",
      value: `#${escapeCssIdentifier(target.id)}`,
    });
  }
  if (target.name !== undefined && target.name.length > 0) {
    const escapedName = target.name.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
    candidates.push({
      type: "css",
      operator: "equals",
      value: `${target.tagName}[name="${escapedName}"]`,
    });
  }
  const title = compactText(target.title);
  if (title !== undefined) {
    candidates.push({ type: "title", operator: "equals", value: title });
  }
  const text = compactText(target.text);
  if (text !== undefined) {
    candidates.push({ type: "text", operator: "equals", value: text });
  }
  if (target.cssPath !== undefined && target.cssPath.length > 0) {
    candidates.push({
      type: "css",
      operator: "equals",
      value: target.cssPath,
    });
  }
  return candidates.filter(
    (candidate, index, all) =>
      all.findIndex(
        (other) => JSON.stringify(other) === JSON.stringify(candidate),
      ) === index,
  );
};

const fallbackFrom = (
  locator: LocatorDefinition,
  index: number,
): LocatorFallback => ({
  locator,
  humanDescription: `Locator semantic alternativ ${index + 1}`,
  whyExplanation:
    "Este derivat din atribute accesibile sau stabile capturate de recorder.",
});

const targetDefinition = (
  target: RecorderElementSnapshot,
  fieldId: string | undefined,
): Pick<ActionStep, "target" | "fallbacks"> => {
  const candidates = simpleLocatorCandidates(target);
  const inside = candidates[0] ?? {
    type: "css",
    operator: "equals",
    value: target.tagName,
  };
  let primary: LocatorDefinition = inside;
  if (target.repeated !== undefined) {
    const distinguishingText = compactText(
      target.repeated.distinguishingText,
    );
    primary = {
      type: "repeated_component",
      container: structuredClone(target.repeated.containerLocator),
      filters:
        distinguishingText === undefined
          ? []
          : [
              {
                field: {
                  type: "text",
                  operator: "equals",
                  value: distinguishingText,
                },
                operator: "contains",
                value: distinguishingText,
              },
            ],
      targetInsideContainer: inside,
    };
  }
  return {
    target: {
      ...(fieldId === undefined ? {} : { fieldId }),
      primary,
    },
    fallbacks: candidates
      .filter(
        (candidate) => JSON.stringify(candidate) !== JSON.stringify(inside),
      )
      .slice(0, 3)
      .map(fallbackFrom),
  };
};

const baseStep = (
  event: RecorderRawEvent,
  options: RecorderStepBuilderOptions,
  title: string,
  humanDescription: string,
): ActionStep => ({
  id: options.createId(),
  type: "action",
  actionType: "click",
  title,
  humanDescription,
  whyExplanation:
    "Pas generat semantic din rol, label, text și atribute stabile; poate fi revizuit înainte de adăugare.",
  ...(options.pageId === undefined ? {} : { pageId: options.pageId }),
  fallbacks: [],
  enabled: true,
});

export const buildRecorderStep = (
  event: RecorderRawEvent,
  options: RecorderStepBuilderOptions,
): RecorderStepDraft => {
  if (event.type === "navigate") {
    return {
      step: {
        ...baseStep(
          event,
          options,
          "Navighează la pagina înregistrată",
          `Deschide ${event.url}.`,
        ),
        actionType: "navigate",
        url: event.url,
      },
    };
  }
  if (event.type === "scroll") {
    return {
      step: {
        ...baseStep(
          event,
          options,
          "Derulează pagina",
          "Derulează pagina până la zona relevantă următoare.",
        ),
        actionType: "scroll",
        scrollX: Math.round(event.scrollX ?? 0),
        scrollY: Math.round(event.scrollY ?? 0),
      },
    };
  }

  const target = event.target;
  if (target === undefined) {
    throw new Error(`Evenimentul ${event.type} nu are element țintă.`);
  }
  const name = elementName(target);
  const isInput = ["fill", "select", "checkbox", "radio"].includes(event.type);
  const fieldId = isInput
    ? toSemanticFieldId(
        target.name ??
          target.label ??
          target.ariaLabel ??
          target.id ??
          name,
      )
    : undefined;
  const locator = targetDefinition(target, fieldId);

  switch (event.type) {
    case "click":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `Apasă ${name}`,
            `Apasă elementul „${name}”.`,
          ),
          actionType: "click",
          ...locator,
        },
      };
    case "fill":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `Completează ${name}`,
            `Completează câmpul „${name}” cu valoarea din dataset.`,
          ),
          actionType: "fill",
          ...locator,
          inputFieldId: fieldId,
          valueKey: fieldId,
          valueStrategy: "dataset",
        },
        capturedValue: event.value ?? "",
        capturedInputKind:
          target.inputType === "password" ? "password" : "text",
      };
    case "select":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `Selectează ${name}`,
            `Alege în „${name}” opțiunea din dataset.`,
          ),
          actionType: "select_option",
          ...locator,
          inputFieldId: fieldId,
          valueKey: fieldId,
          valueStrategy: "dataset",
        },
        capturedValue: event.value ?? "",
        capturedInputKind: "select",
      };
    case "checkbox":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `${event.checked === false ? "Debifează" : "Bifează"} ${name}`,
            `${event.checked === false ? "Debifează" : "Bifează"} controlul „${name}” conform datasetului.`,
          ),
          actionType: event.checked === false ? "uncheck" : "check",
          ...locator,
          inputFieldId: fieldId,
          valueKey: fieldId,
          valueStrategy: "dataset",
        },
        capturedValue: event.checked ?? false,
        capturedInputKind: "checkbox",
      };
    case "radio":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `Alege ${name}`,
            `Selectează opțiunea radio „${name}” conform datasetului.`,
          ),
          actionType: "check",
          ...locator,
          inputFieldId: fieldId,
          valueKey: fieldId,
          valueStrategy: "dataset",
        },
        capturedValue: event.value ?? true,
        capturedInputKind: "radio",
      };
    case "press_key":
      return {
        step: {
          ...baseStep(
            event,
            options,
            `Apasă tasta ${event.key ?? "înregistrată"}`,
            `Apasă tasta ${event.key ?? "înregistrată"} pe „${name}”.`,
          ),
          actionType: "press_key",
          ...locator,
          key: event.key ?? "Enter",
        },
      };
    default:
      throw new Error(`Eveniment recorder nesuportat: ${event.type}.`);
  }
};
