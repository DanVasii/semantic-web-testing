import type { Locator, Page } from "playwright-core";

import type { JsonValue } from "../../shared/persistence.js";
import type {
  ActionStep,
  CheckStep,
  LocatorDefinition,
  TestFlowItem,
  WaitDefinition,
} from "../../shared/test-model.js";
import { RunnerError, type RunnerErrorCode } from "../../shared/runner.js";
import {
  LocatorResolutionError,
  matchesValue,
  resolveLocator,
  resolveUniqueLocator,
} from "./locator-resolver.js";

export interface StepExecutionResult {
  locatorUsed?: JsonValue;
  logs: JsonValue[];
  warnings?: Array<{ code: string; message: string }>;
}

export class StepExecutionError extends RunnerError {
  public constructor(
    code: RunnerErrorCode,
    message: string,
    public readonly count?: number,
  ) {
    super(code, message, {
      ...(count === undefined ? {} : { count }),
      retryable: ![
        "dataset_missing",
        "invalid_test",
        "unsupported_step",
      ].includes(code),
    });
    this.name = "StepExecutionError";
  }
}

const classifyBrowserOperationError = (
  error: unknown,
  operation: "navigation" | "wait_for_url",
): StepExecutionError => {
  const message = error instanceof Error ? error.message : String(error);
  const normalized =
    `${error instanceof Error ? error.name : ""} ${message}`.toLowerCase();

  if (
    normalized.includes("target closed") ||
    normalized.includes("browser has been closed") ||
    normalized.includes("browser disconnected") ||
    normalized.includes("page has been closed") ||
    normalized.includes("context has been closed")
  ) {
    return new StepExecutionError(
      "browser_disconnected",
      "Browserul s-a deconectat în timpul rulării.",
    );
  }

  if (normalized.includes("timeout")) {
    return new StepExecutionError(
      "navigation_timeout",
      operation === "navigation"
        ? "Navigarea nu s-a finalizat în timpul permis."
        : "URL-ul așteptat nu a fost atins în timpul permis.",
    );
  }

  return new StepExecutionError("step_failed", message);
};

const LOCATOR_APPEARANCE_TIMEOUT_MS = 1_500;
const EMBEDDED_INPUT_APPEARANCE_TIMEOUT_MS = 45_000;
const REVEAL_TIMEOUT_MS = 800;
const CLICK_ACTIONABILITY_TIMEOUT_MS = 3_000;

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
  const isFallback = locatorOverride !== undefined;
  const preferInteractive = [
    "click",
    "choose_repeated_item",
    "calendar_select",
  ].includes(step.actionType);
  try {
    if (step.target?.frame !== undefined) {
      return {
        definition,
        locator: await resolveUniqueLocator(page, definition, {
          waitForMs: isFallback ? 0 : EMBEDDED_INPUT_APPEARANCE_TIMEOUT_MS,
          waitForState: "visible",
          frame: step.target.frame,
          preferInteractive,
          requireEnabled: true,
          searchAllFrames: true,
        }),
      };
    }
    try {
      return {
        definition,
        locator: await resolveUniqueLocator(page, definition, {
          waitForMs: isFallback ? 0 : LOCATOR_APPEARANCE_TIMEOUT_MS,
          waitForState: "visible",
          preferInteractive,
          requireEnabled: true,
        }),
      };
    } catch (error) {
      if (
        !(error instanceof LocatorResolutionError) ||
        error.code !== "locator_not_found"
      ) {
        throw error;
      }
    }
    return {
      definition,
      locator: await resolveUniqueLocator(page, definition, {
        waitForMs: isFallback
          ? 0
          : step.actionType === "fill" || step.actionType === "upload_file"
            ? EMBEDDED_INPUT_APPEARANCE_TIMEOUT_MS
            : 0,
        waitForState: "visible",
        preferInteractive,
        requireEnabled: true,
        searchAllFrames: true,
      }),
    };
  } catch (error) {
    if (error instanceof LocatorResolutionError) {
      throw new StepExecutionError(error.code, error.message, error.count);
    }
    throw error;
  }
};

const clickLocator = async (locator: Locator): Promise<void> => {
  try {
    await locator.click({ timeout: CLICK_ACTIONABILITY_TIMEOUT_MS });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const normalized = message.toLowerCase();
    if (
      normalized.includes("not visible") ||
      normalized.includes("not enabled") ||
      normalized.includes("not stable") ||
      normalized.includes("intercepts pointer events") ||
      normalized.includes("detached") ||
      normalized.includes("waiting for element to be")
    ) {
      throw new StepExecutionError(
        "locator_not_found",
        `Elementul a fost găsit, dar nu a devenit acționabil în ${CLICK_ACTIONABILITY_TIMEOUT_MS / 1_000} secunde.`,
      );
    }
    throw error;
  }
};

const revealTargetIfNeeded = async (
  page: Page,
  step: ActionStep,
  locatorOverride?: LocatorDefinition,
): Promise<JsonValue[]> => {
  if (step.revealBefore === undefined || step.revealBefore.length === 0) {
    return [];
  }
  const target = resolveLocator(page, locatorOverride ?? requireTarget(step));
  if ((await target.count()) === 1 && (await target.isVisible())) return [];

  for (const preparation of step.revealBefore) {
    const definitions = [
      preparation.target.primary,
      ...preparation.fallbacks.map(({ locator }) => locator),
    ];
    for (const definition of definitions) {
      try {
        const trigger = await resolveUniqueLocator(page, definition, {
          waitForMs: REVEAL_TIMEOUT_MS,
          waitForState: "visible",
        });
        await trigger.hover({ timeout: REVEAL_TIMEOUT_MS });
        await target.waitFor({ state: "visible", timeout: REVEAL_TIMEOUT_MS });
        if ((await target.count()) === 1 && (await target.isVisible())) {
          return [
            {
              level: "info",
              message:
                "Ținta ascunsă a fost afișată automat prin hover pe un element înregistrat.",
            },
          ];
        }
      } catch {
        // Următorul locator sau candidat poate dezvălui ținta.
      }
    }
  }
  return [
    {
      level: "warning",
      message:
        "Pregătirile hover înregistrate nu au făcut ținta vizibilă; se continuă cu rezolvarea normală.",
    },
  ];
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

const hasDatasetInput = (step: ActionStep): boolean =>
  step.valueStrategy !== undefined || step.valueKey !== undefined;

const booleanInputValue = (
  step: ActionStep,
  dataset: Record<string, string>,
): boolean =>
  !["", "0", "false", "no", "off"].includes(
    resolveInputValue(step, dataset).trim().toLowerCase(),
  );

const repeatUntilSatisfied = async (
  page: Page,
  condition: NonNullable<ActionStep["repeatUntil"]>,
): Promise<boolean> => {
  const marker = await resolveUniqueLocator(page, condition.target, {
    waitForMs: LOCATOR_APPEARANCE_TIMEOUT_MS,
  });
  let controlValue = "";
  try {
    controlValue = (await marker.inputValue()).trim();
  } catch {
    // Headings and other textual markers do not expose an input value.
  }
  const text = (await marker.textContent())?.trim();
  const ariaLabel = await marker.getAttribute("aria-label");
  const value = await marker.getAttribute("value");
  const actual = controlValue || text || ariaLabel || value || "";
  return matchesValue(actual, condition.value, condition.operator);
};

const applyWait = async (
  page: Page,
  wait: WaitDefinition | undefined,
): Promise<Array<{ code: string; message: string }>> => {
  if (wait === undefined) return [];
  switch (wait.type) {
    case "none":
      return [];
    case "dom_stable":
      await page.waitForLoadState("domcontentloaded");
      return [];
    case "network_idle":
      await page.waitForLoadState("networkidle");
      return [];
    case "timeout":
      await page.waitForTimeout(wait.timeoutMs ?? 0);
      return [];
    case "element": {
      if (wait.target === undefined) return [];
      const locator = await resolveUniqueLocator(page, wait.target);
      await locator.waitFor({
        state: "visible",
        ...(wait.timeoutMs === undefined ? {} : { timeout: wait.timeoutMs }),
      });
      return [];
    }
    case "url":
      if (wait.value !== undefined) {
        try {
          const expected = wait.value;
          await page.waitForURL(
            wait.warningOnly === true
              ? (url) => {
                  const actual = new URL(url.toString());
                  actual.search = "";
                  actual.hash = "";
                  const prefix = expected.endsWith("/**")
                    ? expected.slice(0, -3).replace(/\/$/, "")
                    : undefined;
                  const normalizedActual =
                    `${actual.origin}${actual.pathname}`.replace(/\/$/, "");
                  const normalizedExpected = expected.replace(/\/$/, "");
                  return prefix === undefined
                    ? normalizedActual === normalizedExpected
                    : normalizedActual === prefix ||
                        normalizedActual.startsWith(`${prefix}/`);
                }
              : expected,
            {
              ...(wait.timeoutMs === undefined
                ? {}
                : { timeout: wait.timeoutMs }),
            },
          );
        } catch (error) {
          if (wait.warningOnly === true) {
            return [
              {
                code: "navigation_destination_mismatch",
                message: `Click-ul nu a navigat la ruta așteptată ${wait.value}. URL actual: ${page.url()}.`,
              },
            ];
          }
          throw classifyBrowserOperationError(error, "wait_for_url");
        }
      }
      return [];
  }
};

const executeAction = async (
  page: Page,
  step: ActionStep,
  dataset: Record<string, string>,
  locatorOverride?: LocatorDefinition,
): Promise<StepExecutionResult> => {
  let locatorUsed: JsonValue | undefined;
  let executionCount: number | undefined;
  const preparationLogs: JsonValue[] = [];
  switch (step.actionType) {
    case "navigate":
      try {
        await page.goto(step.url ?? "", { waitUntil: "domcontentloaded" });
      } catch (error) {
        throw classifyBrowserOperationError(error, "navigation");
      }
      break;
    case "hover": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.hover();
      break;
    }
    case "click":
    case "choose_repeated_item":
    case "calendar_select": {
      preparationLogs.push(
        ...(await revealTargetIfNeeded(page, step, locatorOverride)),
      );
      if (step.repeatUntil !== undefined) {
        executionCount = 0;
        while (!(await repeatUntilSatisfied(page, step.repeatUntil))) {
          if (executionCount >= step.repeatUntil.maxAttempts) {
            throw new StepExecutionError(
              "step_failed",
              `Condiția vizuală nu a fost atinsă după ${step.repeatUntil.maxAttempts} încercări.`,
            );
          }
          const target = await resolveTarget(page, step, locatorOverride);
          locatorUsed = asJson(target.definition);
          await clickLocator(target.locator);
          executionCount += 1;
        }
      } else {
        executionCount = step.repeat ?? 1;
        for (let index = 0; index < executionCount; index += 1) {
          const target = await resolveTarget(page, step, locatorOverride);
          locatorUsed = asJson(target.definition);
          await clickLocator(target.locator);
        }
      }
      break;
    }
    case "fill": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.fill(resolveInputValue(step, dataset));
      break;
    }
    case "upload_file": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.setInputFiles(resolveInputValue(step, dataset));
      break;
    }
    case "select_option": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      const requested = resolveInputValue(step, dataset);
      let selected: string[] = [];
      try {
        selected = await target.locator.selectOption(
          { value: requested },
          { timeout: 2_000 },
        );
      } catch {
        // Dataseturile recorderului folosesc de regulă value, iar importurile
        // pot folosi textul vizibil. Eșecul primei interpretări este recuperabil.
      }
      if (selected.length === 0) {
        try {
          selected = await target.locator.selectOption(
            { label: requested },
            { timeout: 5_000 },
          );
        } catch {
          // Eroarea coerentă de mai jos păstrează pasul ușor de diagnosticat.
        }
      }
      if (selected.length === 0) {
        throw new StepExecutionError(
          "step_failed",
          `Opțiunea „${requested}” nu există în combobox.`,
        );
      }
      break;
    }
    case "check": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      if (hasDatasetInput(step) && !booleanInputValue(step, dataset)) {
        await target.locator.uncheck();
      } else {
        await target.locator.check();
      }
      break;
    }
    case "uncheck": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      if (hasDatasetInput(step) && booleanInputValue(step, dataset)) {
        await target.locator.check();
      } else {
        await target.locator.uncheck();
      }
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
      if (step.scrollMode === "wheel") {
        if (step.target === undefined) {
          const center = await page.evaluate(() => ({
            x: Math.max(1, Math.round(innerWidth / 2)),
            y: Math.max(1, Math.round(innerHeight / 2)),
          }));
          await page.mouse.move(center.x, center.y);
        } else {
          const target = await resolveTarget(page, step, locatorOverride);
          locatorUsed = asJson(target.definition);
          await target.locator.hover();
        }
        await page.mouse.wheel(step.scrollX ?? 0, step.scrollY ?? 700);
        await page.waitForTimeout(50);
      } else if (step.target === undefined) {
        await page.evaluate(
          ({ deltaX, deltaY }) => {
            window.scrollBy({
              left: deltaX,
              top: deltaY,
              behavior: "auto",
            });
          },
          { deltaX: step.scrollX ?? 0, deltaY: step.scrollY ?? 700 },
        );
      } else {
        const target = await resolveTarget(page, step, locatorOverride);
        locatorUsed = asJson(target.definition);
        await target.locator.evaluate(
          (element, { deltaX, deltaY }) => {
            element.scrollBy({
              left: deltaX,
              top: deltaY,
              behavior: "auto",
            });
          },
          { deltaX: step.scrollX ?? 0, deltaY: step.scrollY ?? 700 },
        );
      }
      break;
    case "wait_for_element": {
      const target = await resolveTarget(page, step, locatorOverride);
      locatorUsed = asJson(target.definition);
      await target.locator.waitFor({ state: "visible" });
      break;
    }
    case "wait_for_url":
      try {
        await page.waitForURL(step.url ?? "");
      } catch (error) {
        throw classifyBrowserOperationError(error, "wait_for_url");
      }
      break;
    case "manual_intervention":
      throw new StepExecutionError(
        "unsupported_step",
        "Intervenția manuală va fi disponibilă în grupa dedicată.",
      );
  }
  const waitWarnings = await applyWait(page, step.waitAfter);
  return {
    ...(locatorUsed === undefined ? {} : { locatorUsed }),
    logs: [
      ...preparationLogs,
      {
        level: "info",
        message:
          executionCount === 0 && step.repeatUntil === undefined
            ? `Acțiunea ${step.actionType} a fost omisă de planul temporar.`
            : step.repeatUntil !== undefined
              ? `Acțiunea ${step.actionType} a fost executată de ${executionCount ?? 0} ori, până la atingerea markerului vizual „${step.repeatUntil.value}”.`
              : `Acțiunea ${step.actionType} a fost executată${
                  (executionCount ?? 1) > 1
                    ? ` de ${executionCount ?? 1} ori`
                    : ""
                }.`,
      },
      ...waitWarnings.map((warning) => ({
        level: "warning",
        code: warning.code,
        message: warning.message,
      })),
    ],
    ...(waitWarnings.length === 0 ? {} : { warnings: waitWarnings }),
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

const executeCheckOnce = async (
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
  if (step.checkType === "js_eval" && "jsSnippet" in step.config) {
    let result: unknown;
    try {
      result = await page.evaluate(step.config.jsSnippet);
    } catch (error) {
      throw new StepExecutionError(
        "step_failed",
        `Evaluarea codului a eșuat: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    if (step.config.expectedResult !== undefined) {
      const resultString = JSON.stringify(result);
      const expectedString = JSON.stringify(step.config.expectedResult);
      if (resultString !== expectedString) {
        throw new StepExecutionError(
          "step_failed",
          `Evaluarea JS a returnat un rezultat neașteptat. Am primit: ${resultString}, ne așteptam la: ${expectedString}`,
        );
      }
    } else if (
      typeof result === "object" &&
      result !== null &&
      "passed" in result
    ) {
      const asObj = result as {
        passed?: boolean;
        message?: string;
        actualValue?: unknown;
      };
      if (asObj.passed === false) {
        throw new StepExecutionError(
          "step_failed",
          `Evaluarea JS a eșuat: ${asObj.message ?? "Fără mesaj suplimentar"} (A obținut: ${JSON.stringify(asObj.actualValue)})`,
        );
      }
    } else if (!result) {
      throw new StepExecutionError(
        "step_failed",
        `Evaluarea JS a returnat o valoare "falsy" (${JSON.stringify(result)}).`,
      );
    }

    return { logs: [{ level: "info", message: "Evaluare JS cu succes." }] };
  }
  throw new StepExecutionError(
    "unsupported_step",
    `Verificarea ${step.checkType} aparține unei grupe ulterioare.`,
  );
};

const executeCheck = async (
  page: Page,
  step: CheckStep,
): Promise<StepExecutionResult> => {
  if (step.checkType === "mysql" || step.checkType === "imap") {
    return executeCheckOnce(page, step);
  }
  const timeoutMs = step.timeoutMs ?? 5_000;
  const pollIntervalMs = 200;
  const maxAttempts = Math.max(1, Math.ceil(timeoutMs / pollIntervalMs) + 1);
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await executeCheckOnce(page, step);
      return {
        ...result,
        logs: [
          ...result.logs,
          {
            level: "info",
            message:
              attempt === 0
                ? "Condiția verificării a fost îndeplinită imediat."
                : `Condiția verificării a fost îndeplinită după ${attempt + 1} încercări.`,
          },
        ],
      };
    } catch (error) {
      lastError = error;
      const retryable =
        (error instanceof StepExecutionError &&
          ["locator_not_found", "step_failed"].includes(error.code)) ||
        (error instanceof LocatorResolutionError &&
          error.code === "locator_not_found");
      if (!retryable || attempt === maxAttempts - 1 || timeoutMs === 0) {
        break;
      }
      await page.waitForTimeout(pollIntervalMs);
    }
  }
  const reason =
    lastError instanceof Error
      ? lastError.message
      : "Condiția verificării nu a fost îndeplinită.";
  throw new StepExecutionError(
    lastError instanceof StepExecutionError
      ? lastError.code
      : lastError instanceof LocatorResolutionError
        ? lastError.code
        : "step_failed",
    `Timeout după ${timeoutMs} ms: ${reason}`,
    lastError instanceof StepExecutionError ||
      lastError instanceof LocatorResolutionError
      ? lastError.count
      : undefined,
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
