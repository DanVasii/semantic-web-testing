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
  if (type === "file") return "file";
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
  const locator = await resolveUniqueLocator(page, definition, {
    waitForMs: 45_000,
    ...(step.target?.frame === undefined
      ? { searchAllFrames: true }
      : { frame: step.target.frame, searchAllFrames: true }),
  });
  const input = await locator.evaluate((element) => ({
    tagName: element.tagName.toLowerCase(),
    type: element.getAttribute("type")?.toLowerCase() ?? null,
  }));

  return {
    fieldId,
    valueKey,
    inputKind: getInputKind(input.tagName, input.type),
    locator: structuredClone(definition),
    ...(step.target?.frame === undefined
      ? {}
      : { frame: structuredClone(step.target.frame) }),
  };
};

export const readManualInputValue = async (
  page: Page,
  details: MissingDataDetails,
): Promise<DatasetPrimitive> => {
  const locator = await resolveUniqueLocator(page, details.locator, {
    waitForMs: 45_000,
    ...(details.frame === undefined
      ? { searchAllFrames: true }
      : { frame: details.frame, searchAllFrames: true }),
  });
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
    case "file": {
      const selectedName = await locator.evaluate((element) => {
        if (
          !(element instanceof HTMLInputElement) ||
          element.files?.[0] === undefined
        ) {
          return "";
        }
        return element.files[0].name;
      });
      if (selectedName.length === 0) {
        throw new StepExecutionError(
          "missing_data",
          "Selectează un fișier în browser înainte de Continue.",
        );
      }
      return selectedName;
    }
    case "password":
    case "select":
    case "text":
      return locator.inputValue();
  }
};
