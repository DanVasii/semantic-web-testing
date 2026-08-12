import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import type { ActionStep } from "../../shared/test-model.js";
import { executeFlowItem, StepExecutionError } from "./step-executor.js";

const calendarStep = (maxAttempts = 12): ActionStep => ({
  id: "next-month",
  type: "action",
  actionType: "click",
  title: "Navighează la luna cerută",
  humanDescription: "Apasă Next până când markerul arată septembrie 2026.",
  whyExplanation:
    "Rularea verifică starea vizuală curentă, nu starea finală a înregistrării.",
  target: {
    primary: {
      type: "css",
      operator: "equals",
      value: "#calendar-next-month",
    },
  },
  repeatUntil: {
    target: {
      type: "css",
      operator: "equals",
      value: "#calendar-heading",
    },
    operator: "equals",
    value: "septembrie 2026",
    maxAttempts,
  },
  fallbacks: [],
  enabled: true,
});

const calendarPage = () => {
  const periods = ["iulie 2026", "august 2026", "septembrie 2026"];
  let index = 0;
  const next = {
    count: vi.fn().mockResolvedValue(1),
    click: vi.fn().mockImplementation(() => {
      index = Math.min(index + 1, periods.length - 1);
      return Promise.resolve();
    }),
  };
  const heading = {
    count: vi.fn().mockResolvedValue(1),
    inputValue: vi.fn().mockRejectedValue(new Error("Not an input")),
    textContent: vi
      .fn()
      .mockImplementation(() => Promise.resolve(periods[index])),
    getAttribute: vi.fn().mockResolvedValue(null),
  };
  const page = {
    locator: vi.fn().mockImplementation((selector: string) => {
      if (selector === "#calendar-next-month") {
        return next;
      }
      if (selector === "#calendar-heading") {
        return heading;
      }
      throw new Error(`Selector neașteptat: ${selector}`);
    }),
  } as unknown as Page;
  return { page, next };
};

describe("step executor repeatUntil", () => {
  it("starts from the runtime marker and clicks until the target period", async () => {
    const { page, next } = calendarPage();

    const result = await executeFlowItem(page, calendarStep(), {});

    expect(next.click).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result.logs)).toContain(
      "până la atingerea markerului vizual „septembrie 2026”",
    );
  });

  it("stops safely when the visual target cannot be reached", async () => {
    const { page, next } = calendarPage();

    await expect(executeFlowItem(page, calendarStep(1), {})).rejects.toEqual(
      expect.objectContaining<Partial<StepExecutionError>>({
        code: "step_failed",
      }),
    );
    expect(next.click).toHaveBeenCalledTimes(1);
  });
});

describe("step executor select_option", () => {
  it("falls back from option value to its visible label", async () => {
    const selectOption = vi
      .fn()
      .mockRejectedValueOnce(new Error("option value not found"))
      .mockResolvedValueOnce(["automation"]);
    const locator = {
      count: vi.fn().mockResolvedValue(1),
      selectOption,
    };
    const page = {
      locator: vi.fn().mockReturnValue(locator),
    } as unknown as Page;
    const step: ActionStep = {
      id: "select-service",
      type: "action",
      actionType: "select_option",
      title: "Selectează serviciul",
      humanDescription: "Alege opțiunea vizibilă din combobox.",
      whyExplanation: "Valoarea datasetului poate fi eticheta opțiunii.",
      target: {
        primary: {
          type: "css",
          operator: "equals",
          value: "select[name=service]",
        },
      },
      inputFieldId: "service",
      valueKey: "service",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, {
      service: "Automatizare browser",
    });

    expect(selectOption).toHaveBeenNthCalledWith(
      1,
      { value: "Automatizare browser" },
      { timeout: 2_000 },
    );
    expect(selectOption).toHaveBeenNthCalledWith(
      2,
      { label: "Automatizare browser" },
      { timeout: 5_000 },
    );
  });
});
