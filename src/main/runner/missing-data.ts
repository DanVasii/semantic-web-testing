import type { Page } from "playwright-core";

import type { DatasetPrimitive } from "../../shared/test-model.js";
import type { ActionStep } from "../../shared/test-model.js";
import type {
  MissingDataDetails,
  MissingDataInputKind,
} from "../../shared/runner.js";
import { resolveUniqueLocator } from "./locator-resolver.js";
import { StepExecutionError } from "./step-executor.js";

const getInputKind = (
  tagName: string,
  type: string | null,
): MissingDataInputKind => {
  if (tagName === "select") return "select";
  if (type === "password") return "password";
  if (type === "checkbox") return "checkbox";
  if (type === "radio") return "radio";
  return "text";
};

export const inspectMissingInput = async (
  page: Page,
  step: ActionStep,
): Promise<MissingDataDetails> => {
  const definition = step.target?.primary;
  if (definition === undefined) {
    throw new StepExecutionError(
      "invalid_test",
      `Pasul ${step.id} nu are locator pentru input.`,
    );
  }
  const valueKey = step.valueKey ?? step.inputFieldId ?? step.target?.fieldId;
  if (valueKey === undefined) {
    throw new StepExecutionError(
      "invalid_test",
      `Pasul ${step.id} nu are valueKey sau fieldId.`,
    );
  }
  const fieldId =
    step.inputFieldId ?? step.target?.fieldId ?? step.valueKey ?? valueKey;
  const locator = await resolveUniqueLocator(page, definition);
  const input = await locator.evaluate((element) => ({
    tagName: element.tagName.toLowerCase(),
    type: element.getAttribute("type")?.toLowerCase() ?? null,
  }));

  return {
    fieldId,
    valueKey,
    inputKind: getInputKind(input.tagName, input.type),
    locator: structuredClone(definition),
  };
};

export const readManualInputValue = async (
  page: Page,
  details: MissingDataDetails,
): Promise<DatasetPrimitive> => {
  const locator = await resolveUniqueLocator(page, details.locator);
  switch (details.inputKind) {
    case "checkbox":
      return locator.isChecked();
    case "radio":
      if (!(await locator.isChecked())) {
        throw new StepExecutionError(
          "missing_data",
          "Selectează o opțiune radio înainte de Continue.",
        );
      }
      return locator.inputValue();
    case "password":
    case "select":
    case "text":
      return locator.inputValue();
  }
};
