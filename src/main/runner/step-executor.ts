import type { Locator, Page } from "playwright-core";

import type { JsonValue } from "../../shared/persistence.js";
import type {
  ActionStep,
  CheckStep,
  LocatorDefinition,
  TestFlowItem,
  WaitDefinition,
} from "../../shared/test-model.js";
import type { RunnerErrorCode } from "../../shared/runner.js";
import {
  LocatorResolutionError,
  matchesValue,
  resolveLocator,
  resolveUniqueLocator,
} from "./locator-resolver.js";

export interface StepExecutionResult {
  locatorUsed?: JsonValue;
  logs: JsonValue[];
}

export class StepExecutionError extends Error {
  public constructor(
    public readonly code: RunnerErrorCode,
    message: string,
    public readonly count?: number,
  ) {
    super(message);
    this.name = "StepExecutionError";
  }
}

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const requireTarget = (step: ActionStep): LocatorDefinition => {
  if (step.target === undefined) {
    throw new StepExecutionError(
      "invalid_test",
      `Pasul ${step.id} nu are locator țintă.`,
    );
  }
  return step.target.primary;
};

const resolveTarget = async (
  page: Page,
  step: ActionStep,
  locatorOverride?: LocatorDefinition,
): Promise<{ definition: LocatorDefinition; locator: Locator }> => {
  const definition = locatorOverride ?? requireTarget(step);
  try {
    return {
      definition,
      locator: await resolveUniqueLocator(page, definition),
    };
  } catch (error) {
    if (error instanceof LocatorResolutionError) {
      throw new StepExecutionError(error.code, error.message, error.count);
    }
    throw error;
  }
};

const resolveInputValue = (
  step: ActionStep,
  dataset: Record<string, string>,
): string => {
  if (step.valueStrategy === "manual") {
    throw new StepExecutionError(
      "missing_data",
      `Pasul ${step.id} necesită o valoare introdusă manual.`,
    );
  }
  const key = step.valueKey;
  if (key === undefined || !(key in dataset)) {
    throw new StepExecutionError(
      "missing_data",
      `Valoarea „${key ?? step.inputFieldId ?? "necunoscută"}” lipsește din dataset.`,
    );
  }
  return dataset[key] ?? "";
};

const applyWait = async (
  page: Page,
  wait: WaitDefinition | undefined,
): Promise<void> => {
  if (wait === undefined) return;
  switch (wait.type) {
    case "none":
      return;
    case "dom_stable":
      await page.waitForLoadState("domcontentloaded");
      return;
    case "network_idle":
      await page.waitForLoadState("networkidle");
      return;
    case "timeout":
      await page.waitForTimeout(wait.timeoutMs ?? 0);
      return;
    case "element": {
      if (wait.target === undefined) return;
      const locator = await resolveUniqueLocator(page, wait.target);
      await locator.waitFor({
        state: "visible",
        ...(wait.timeoutMs === undefined ? {} : { timeout: wait.timeoutMs }),
      });
      return;
    }
    case "url":
      if (wait.value !== undefined) {
        await page.waitForURL(wait.value, {
          ...(wait.timeoutMs === undefined ? {} : { timeout: wait.timeoutMs }),
        });
      }
  }
};

const executeAction = async (
  page: Page,
  step: ActionStep,
  dataset: Record<string, string>,
  locatorOverride?: LocatorDefinition,
): Promise<StepExecutionResult> => {
  let locatorUsed: JsonValue | undefined;
  switch (step.actionType) {
    case "navigate":
      await page.goto(step.url ?? "", { waitUntil: "domcontentloaded" });
      break;
    case "click":
    case "choose_repeated_item":
    case "calendar_select": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.click();
      break;
    }
    case "fill": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.fill(resolveInputValue(step, dataset));
      break;
    }
    case "select_option": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.selectOption(resolveInputValue(step, dataset));
      break;
    }
    case "check": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.check();
      break;
    }
    case "uncheck": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.uncheck();
      break;
    }
    case "press_key":
      if (step.target === undefined) {
        await page.keyboard.press(step.key ?? "");
      } else {
        const target = await resolveTarget(page, step, locatorOverride);
        locatorUsed = asJson(target.definition);
        await target.locator.press(step.key ?? "");
      }
      break;
    case "scroll":
      if (step.target === undefined) {
        await page.mouse.wheel(0, 700);
      } else {
        const target = await resolveTarget(page, step, locatorOverride);
        locatorUsed = asJson(target.definition);
        await target.locator.scrollIntoViewIfNeeded();
      }
      break;
    case "wait_for_element": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.waitFor({ state: "visible" });
      break;
    }
    case "wait_for_url":
      await page.waitForURL(step.url ?? "");
      break;
    case "manual_intervention":
      throw new StepExecutionError(
        "unsupported_step",
        "Intervenția manuală va fi disponibilă în grupa dedicată.",
      );
  }
  await applyWait(page, step.waitAfter);
  return {
    ...(locatorUsed === undefined ? {} : { locatorUsed }),
    logs: [
      {
        level: "info",
        message: `Acțiunea ${step.actionType} a fost executată.`,
      },
    ],
  };
};

const executeElementCheck = async (
  page: Page,
  step: CheckStep,
): Promise<StepExecutionResult> => {
  if (!("state" in step.config) || !("target" in step.config)) {
    throw new StepExecutionError("invalid_test", "Config element invalid.");
  }
  const candidates = resolveLocator(page, step.config.target);
  const count = await candidates.count();
  if (step.config.state === "hidden" && count === 0) {
    return { logs: [{ level: "info", message: "Elementul este absent." }] };
  }
  if (count !== 1) {
    throw new StepExecutionError(
      count === 0 ? "locator_not_found" : "locator_ambiguous",
      count === 0
        ? "Locatorul verificării nu a găsit niciun element."
        : `Verificarea este ambiguă: ${count} elemente.`,
      count,
    );
  }
  const state = step.config.state;
  const passed =
    state === "visible"
      ? await candidates.isVisible()
      : state === "hidden"
        ? !(await candidates.isVisible())
        : state === "enabled"
          ? await candidates.isEnabled()
          : state === "disabled"
            ? !(await candidates.isEnabled())
            : state === "checked"
              ? await candidates.isChecked()
              : !(await candidates.isChecked());
  if (!passed) {
    throw new StepExecutionError(
      "step_failed",
      `Condiția elementului „${state}” nu este îndeplinită.`,
    );
  }
  return {
    locatorUsed: asJson(step.config.target),
    logs: [{ level: "info", message: `Condiție element: ${state}.` }],
  };
};

const executeCheck = async (
  page: Page,
  step: CheckStep,
): Promise<StepExecutionResult> => {
  if (step.checkType === "element") return executeElementCheck(page, step);
  if (
    step.checkType === "text" &&
    "target" in step.config &&
    "operator" in step.config &&
    "value" in step.config
  ) {
    const locator = await resolveUniqueLocator(page, step.config.target);
    const text = (await locator.textContent()) ?? "";
    if (
      !matchesValue(
        text,
        step.config.value,
        step.config.operator,
        step.config.caseSensitive,
      )
    ) {
      throw new StepExecutionError(
        "step_failed",
        "Textul elementului nu corespunde verificării.",
      );
    }
    return {
      locatorUsed: asJson(step.config.target),
      logs: [{ level: "info", message: "Text verificat cu succes." }],
    };
  }
  if (
    step.checkType === "url" &&
    "operator" in step.config &&
    "value" in step.config
  ) {
    if (
      !matchesValue(
        page.url(),
        step.config.value,
        step.config.operator,
        step.config.caseSensitive,
      )
    ) {
      throw new StepExecutionError(
        "step_failed",
        "URL-ul curent nu corespunde verificării.",
      );
    }
    return { logs: [{ level: "info", message: "URL verificat cu succes." }] };
  }
  throw new StepExecutionError(
    "unsupported_step",
    `Verificarea ${step.checkType} aparține unei grupe ulterioare.`,
  );
};

export const executeFlowItem = (
  page: Page,
  item: TestFlowItem,
  dataset: Record<string, string>,
  locatorOverride?: LocatorDefinition,
): Promise<StepExecutionResult> => {
  if (item.type === "action")
    return executeAction(page, item, dataset, locatorOverride);
  if (item.type === "check") return executeCheck(page, item);
  throw new StepExecutionError(
    "unsupported_step",
    `Pasul ${item.type} aparține unei grupe ulterioare.`,
  );
};
