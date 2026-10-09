import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import type { ActionStep, CheckStep } from "../../shared/test-model.js";
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

describe("step executor navigation warning", () => {
  it("keeps the click passed and returns a warning when its route is wrong", async () => {
    const locator = {
      count: vi.fn().mockResolvedValue(1),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const page = {
      locator: vi.fn().mockReturnValue(locator),
      waitForURL: vi.fn().mockRejectedValue(new Error("Timeout")),
      url: vi.fn().mockReturnValue("https://example.test/cart"),
    } as unknown as Page;
    const step: ActionStep = {
      id: "place-order",
      type: "action",
      actionType: "click",
      title: "Finalizează comanda",
      humanDescription: "Apasă butonul de finalizare.",
      whyExplanation: "Trimite comanda.",
      target: {
        primary: { type: "css", operator: "equals", value: "#place-order" },
      },
      waitAfter: {
        type: "url",
        value: "https://example.test/order-received/**",
        timeoutMs: 5_000,
        warningOnly: true,
      },
      fallbacks: [],
      enabled: true,
    };

    const result = await executeFlowItem(page, step, {});

    expect(result.warnings).toMatchObject([
      { code: "navigation_destination_mismatch" },
    ]);
    expect(result.warnings?.[0]?.message).toContain(
      "https://example.test/cart",
    );
  });
});

describe("step executor check wait until", () => {
  it("retries a text check until the locator and condition are available", async () => {
    const locator = {
      count: vi
        .fn()
        .mockResolvedValueOnce(0)
        .mockResolvedValueOnce(1)
        .mockResolvedValue(1),
      textContent: vi.fn().mockResolvedValue("Operația a fost salvată"),
    };
    const waitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: vi.fn().mockReturnValue(locator),
      waitForTimeout,
    } as unknown as Page;
    const step: CheckStep = {
      id: "check-success-message",
      type: "check",
      checkType: "text",
      title: "Mesaj de succes",
      humanDescription: "Așteaptă confirmarea salvării.",
      config: {
        target: { type: "css", operator: "equals", value: "#success" },
        operator: "contains",
        value: "salvată",
      },
      timeoutMs: 1_000,
      enabled: true,
    };

    const result = await executeFlowItem(page, step, {});

    expect(waitForTimeout).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result.logs)).toContain("după 2 încercări");
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

describe("step executor upload_file", () => {
  it("uploads the managed file path from the active dataset", async () => {
    const setInputFiles = vi.fn().mockResolvedValue(undefined);
    const locator = { count: vi.fn().mockResolvedValue(1), setInputFiles };
    const page = {
      locator: vi.fn().mockReturnValue(locator),
    } as unknown as Page;
    const step: ActionStep = {
      id: "upload-cv",
      type: "action",
      actionType: "upload_file",
      title: "Încarcă CV",
      humanDescription: "Încarcă fișierul din dataset.",
      whyExplanation: "Fișierul este administrat de aplicație.",
      target: { primary: { type: "css", operator: "equals", value: "#cv" } },
      inputFieldId: "cv",
      valueKey: "cv",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, { cv: "C:\\managed\\cv.pdf" });

    expect(setInputFiles).toHaveBeenCalledWith("C:\\managed\\cv.pdf");
  });
});

describe("step executor cross-frame targets", () => {
  it("fills a Stripe input inside its recorded cross-origin frame", async () => {
    const fill = vi.fn().mockResolvedValue(undefined);
    const cardInput = {
      count: vi.fn().mockResolvedValue(1),
      fill,
    };
    const mainFrame = {
      url: vi.fn().mockReturnValue("https://shop.test/checkout"),
      locator: vi.fn(),
    };
    const stripeFrameLocator = vi.fn().mockReturnValue(cardInput);
    const stripeFrame = {
      url: vi
        .fn()
        .mockReturnValue("https://js.stripe.com/v3/elements-inner-payment"),
      locator: stripeFrameLocator,
    };
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, stripeFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const step: ActionStep = {
      id: "card-number",
      type: "action",
      actionType: "fill",
      title: "Completează numărul cardului",
      humanDescription: "Completează câmpul securizat Stripe.",
      whyExplanation: "Câmpul este izolat într-un iframe cross-origin.",
      target: {
        frame: { origin: "https://js.stripe.com" },
        primary: {
          type: "css",
          operator: "equals",
          value: "#payment-numberInput",
        },
      },
      inputFieldId: "card_number",
      valueKey: "card_number",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, { card_number: "4242424242424242" });

    expect(stripeFrameLocator).toHaveBeenCalledWith("#payment-numberInput");
    expect(mainFrame.locator).not.toHaveBeenCalled();
    expect(fill).toHaveBeenCalledWith("4242424242424242");
  });

  it("finds legacy recorded inputs by searching every frame after the main document", async () => {
    const fill = vi.fn().mockResolvedValue(undefined);
    const missing = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(0),
    };
    const cardInput = {
      count: vi.fn().mockResolvedValue(1),
      fill,
    };
    const mainFrame = {
      url: vi.fn().mockReturnValue("https://shop.test/checkout"),
      locator: vi.fn().mockReturnValue(missing),
    };
    const stripeFrameLocator = vi.fn().mockReturnValue(cardInput);
    const stripeFrame = {
      url: vi
        .fn()
        .mockReturnValue("https://js.stripe.com/v3/elements-inner-payment"),
      locator: stripeFrameLocator,
    };
    const pageLocator = vi.fn().mockReturnValue(missing);
    const page = {
      locator: pageLocator,
      frames: vi.fn().mockReturnValue([mainFrame, stripeFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const step: ActionStep = {
      id: "legacy-card-number",
      type: "action",
      actionType: "fill",
      title: "Completează numărul cardului",
      humanDescription: "Completează câmpul Stripe înregistrat anterior.",
      whyExplanation: "Pasul vechi nu conține încă metadata frame-ului.",
      target: {
        primary: {
          type: "css",
          operator: "equals",
          value: "#payment-numberInput",
        },
      },
      inputFieldId: "card_number",
      valueKey: "card_number",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, { card_number: "4242424242424242" });

    expect(pageLocator).toHaveBeenCalledWith("#payment-numberInput");
    expect(stripeFrameLocator).toHaveBeenCalledWith("#payment-numberInput");
    expect(fill).toHaveBeenCalledWith("4242424242424242");
  });
});

describe("step executor hover", () => {
  it("hovers the resolved semantic target", async () => {
    const hover = vi.fn().mockResolvedValue(undefined);
    const locator = { count: vi.fn().mockResolvedValue(1), hover };
    const page = {
      locator: vi.fn().mockReturnValue(locator),
    } as unknown as Page;
    const step: ActionStep = {
      id: "hover-cart",
      type: "action",
      actionType: "hover",
      title: "Deschide meniul coșului",
      humanDescription: "Poziționează mouse-ul peste coș.",
      whyExplanation: "Meniul este afișat la hover.",
      target: {
        primary: {
          type: "css",
          operator: "equals",
          value: "#cart",
        },
      },
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, {});

    expect(hover).toHaveBeenCalledOnce();
  });

  it("uses a recorded hover preparation only when the click target is hidden", async () => {
    let targetVisible = false;
    const hover = vi.fn().mockImplementation(() => {
      targetVisible = true;
      return Promise.resolve();
    });
    const target = {
      count: vi
        .fn()
        .mockImplementation(() => Promise.resolve(targetVisible ? 1 : 0)),
      isVisible: vi
        .fn()
        .mockImplementation(() => Promise.resolve(targetVisible)),
      waitFor: vi.fn().mockResolvedValue(undefined),
      click: vi.fn().mockResolvedValue(undefined),
    };
    const trigger = {
      count: vi.fn().mockResolvedValue(1),
      waitFor: vi.fn().mockResolvedValue(undefined),
      hover,
    };
    const page = {
      locator: vi
        .fn()
        .mockImplementation((selector: string) =>
          selector === "#checkout" ? target : trigger,
        ),
    } as unknown as Page;
    const step: ActionStep = {
      id: "checkout",
      type: "action",
      actionType: "click",
      title: "Finalizează",
      humanDescription: "Apasă Finalizează.",
      whyExplanation: "Butonul este în meniul coșului.",
      target: {
        primary: { type: "css", operator: "equals", value: "#checkout" },
      },
      revealBefore: [
        {
          action: "hover",
          target: {
            primary: { type: "css", operator: "equals", value: "#cart" },
          },
          fallbacks: [],
        },
      ],
      fallbacks: [],
      enabled: true,
    };

    const result = await executeFlowItem(page, step, {});

    expect(hover).toHaveBeenCalledOnce();
    expect(target.click).toHaveBeenCalledOnce();
    expect(JSON.stringify(result.logs)).toContain("afișată automat");

    await executeFlowItem(page, step, {});
    expect(hover).toHaveBeenCalledOnce();
    expect(target.click).toHaveBeenCalledTimes(2);
  });
});

describe("step executor scroll", () => {
  it("scrolls the page deterministically without depending on the mouse position", async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const page = { evaluate } as unknown as Page;
    const step: ActionStep = {
      id: "scroll-page",
      type: "action",
      actionType: "scroll",
      title: "Derulează pagina",
      humanDescription: "Derulează pagina.",
      whyExplanation: "Continuă fluxul.",
      scrollX: 10,
      scrollY: 420,
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, {});

    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), {
      deltaX: 10,
      deltaY: 420,
    });
  });

  it("replays a nested scroll on the recorded container", async () => {
    const evaluate = vi.fn().mockResolvedValue(undefined);
    const locator = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(1),
      evaluate,
    };
    const page = {
      locator: vi.fn().mockReturnValue(locator),
    } as unknown as Page;
    const step: ActionStep = {
      id: "scroll-results",
      type: "action",
      actionType: "scroll",
      title: "Derulează containerul",
      humanDescription: "Derulează rezultatele.",
      whyExplanation: "Continuă fluxul.",
      scrollX: 0,
      scrollY: 360,
      target: {
        primary: {
          type: "css",
          operator: "equals",
          value: "#results",
        },
      },
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, {});

    expect(evaluate).toHaveBeenCalledWith(expect.any(Function), {
      deltaX: 0,
      deltaY: 360,
    });
  });

  it("replays a wheel gesture over its recorded semantic target", async () => {
    const hover = vi.fn().mockResolvedValue(undefined);
    const locator = {
      waitFor: vi.fn().mockResolvedValue(undefined),
      count: vi.fn().mockResolvedValue(1),
      hover,
    };
    const wheel = vi.fn().mockResolvedValue(undefined);
    const page = {
      locator: vi.fn().mockReturnValue(locator),
      mouse: { wheel },
      waitForTimeout: vi.fn().mockResolvedValue(undefined),
    } as unknown as Page;
    const step: ActionStep = {
      id: "wheel-results",
      type: "action",
      actionType: "scroll",
      title: "Derulează rezultatele",
      humanDescription: "Repetă gestul de scroll.",
      whyExplanation: "Pagina procesează evenimentul wheel.",
      scrollX: 0,
      scrollY: 240,
      scrollMode: "wheel",
      target: {
        primary: {
          type: "css",
          operator: "equals",
          value: "#results",
        },
      },
      fallbacks: [],
      enabled: true,
    };

    await executeFlowItem(page, step, {});

    expect(hover).toHaveBeenCalledOnce();
    expect(wheel).toHaveBeenCalledWith(0, 240);
  });
});
