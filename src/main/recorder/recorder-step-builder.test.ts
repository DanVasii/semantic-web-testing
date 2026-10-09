import { describe, expect, it } from "vitest";

import type {
  RecorderElementSnapshot,
  RecorderRawEvent,
} from "../../shared/recorder.js";
import {
  buildRecorderStep,
  toSemanticFieldId,
} from "./recorder-step-builder.js";

const target: RecorderElementSnapshot = {
  tagName: "input",
  inputType: "text",
  id: "customer-email",
  name: "email",
  label: "Adresă de e-mail",
  role: "textbox",
  placeholder: "nume@example.test",
  dataAttributes: {
    "data-testid": "checkout-email",
  },
  cssPath: "form > input:nth-of-type(1)",
};

const event = (
  type: RecorderRawEvent["type"],
  partial: Partial<RecorderRawEvent> = {},
): RecorderRawEvent => ({
  type,
  url: "https://example.test/checkout",
  timestamp: "2026-07-25T10:00:00.000Z",
  target,
  ...partial,
});

const build = (rawEvent: RecorderRawEvent) =>
  buildRecorderStep(rawEvent, {
    createId: () => `step-${rawEvent.type}`,
    pageId: "page-version-1",
  });

describe("buildRecorderStep", () => {
  it("prefers a stable button name selector before its implicit role", () => {
    const draft = build(
      event("click", {
        target: {
          tagName: "button",
          inputType: "submit",
          name: "add-to-cart",
          text: "Adaugă în coș →",
          role: "button",
          dataAttributes: {},
          cssPath: 'button[name="add-to-cart"]',
        },
      }),
    );

    expect(draft.step.target?.primary).toEqual({
      type: "css",
      operator: "equals",
      value: 'button[type="submit"][name="add-to-cart"]',
    });
    expect(draft.step.fallbacks.map(({ locator }) => locator)).toContainEqual({
      type: "role",
      role: "button",
      operator: "equals",
      value: "Adaugă în coș →",
    });
  });

  it("prioritizes stable attributes and keeps semantic fallbacks", () => {
    const draft = build(event("click"));

    expect(draft.step).toMatchObject({
      id: "step-click",
      actionType: "click",
      pageId: "page-version-1",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          value: "checkout-email",
        },
      },
    });
    expect(draft.step.fallbacks.map(({ locator }) => locator.type)).toEqual([
      "css",
      "css",
      "label",
    ]);
    expect(draft.step.humanDescription).toContain("Adresă de e-mail");
    expect(draft.step.whyExplanation.length).toBeGreaterThan(20);
  });

  it("builds an explicit hover step with the captured semantic target", () => {
    const draft = build(event("hover"));

    expect(draft.step).toMatchObject({
      id: "step-hover",
      actionType: "hover",
      title: "Treci mouse-ul peste Adresă de e-mail",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          value: "checkout-email",
        },
      },
    });
  });

  it("attaches hover reveal candidates to the click instead of adding steps", () => {
    const draft = build(
      event("click", {
        hoverCandidates: [
          {
            tagName: "button",
            id: "cart",
            role: "button",
            ariaLabel: "Coș",
            dataAttributes: { "data-testid": "cart-trigger" },
          },
        ],
      }),
    );

    expect(draft.step.revealBefore).toEqual([
      expect.objectContaining({
        action: "hover",
        target: {
          primary: {
            type: "data_attribute",
            attribute: "data-testid",
            operator: "equals",
            value: "cart-trigger",
          },
        },
      }),
    ]);
  });

  it("uses the card heading instead of all descendant text for a custom clickable card", () => {
    const cardText =
      "ADOLESCENȚI LA CABINET 60 MIN TEEN SKIN RITUAL Pentru pielea sensibilă, predispusă la erupții, puncte negre și inflamații hormonale. 450,00 lei";
    const draft = build(
      event("click", {
        target: {
          tagName: "div",
          actionText: "TEEN SKIN RITUAL",
          text: cardText,
          dataAttributes: {},
          cssPath: "section > div:nth-of-type(2)",
        },
      }),
    );

    expect(draft.step.title).toBe("Apasă TEEN SKIN RITUAL");
    expect(draft.step.humanDescription).toBe(
      "Apasă elementul „TEEN SKIN RITUAL”.",
    );
    expect(draft.step.target?.primary).toMatchObject({
      type: "text",
      operator: "equals",
      value: "TEEN SKIN RITUAL",
    });
    expect(draft.step.fallbacks.map(({ locator }) => locator)).toContainEqual({
      type: "text",
      operator: "equals",
      value: cardText,
    });
  });

  it("captures only the final fill value and maps it to a semantic dataset key", () => {
    const draft = build(event("fill", { value: "dan@example.test" }));

    expect(draft.step).toMatchObject({
      actionType: "fill",
      inputFieldId: "email",
      valueKey: "email",
      valueStrategy: "dataset",
    });
    expect(draft.capturedValue).toBe("dan@example.test");
    expect(draft.capturedInputKind).toBe("text");
  });

  it("maps a file input change to a dataset-backed upload step", () => {
    const draft = build(
      event("upload_file", {
        value: "cv.pdf",
        target: { ...target, inputType: "file", name: "cv", label: "CV" },
      }),
    );

    expect(draft.step).toMatchObject({
      actionType: "upload_file",
      inputFieldId: "cv",
      valueKey: "cv",
      valueStrategy: "dataset",
    });
    expect(draft.capturedValue).toBeUndefined();
  });

  it("marks password values as confidential input", () => {
    const draft = build(
      event("fill", {
        value: "secret",
        target: {
          ...target,
          inputType: "password",
          name: "password",
          label: "Parolă",
        },
      }),
    );

    expect(draft.capturedInputKind).toBe("password");
    expect(draft.step.valueKey).toBe("password");
  });

  it.each([
    ["select", { value: "RO" }, "select_option", "select", "RO"],
    ["checkbox", { checked: true }, "check", "checkbox", true],
    ["checkbox", { checked: false }, "uncheck", "checkbox", false],
    ["radio", { value: "curier" }, "check", "radio", "curier"],
  ] as const)(
    "maps %s to a dataset-backed %s step",
    (type, partial, actionType, inputKind, value) => {
      const draft = build(event(type, partial));
      expect(draft.step.actionType).toBe(actionType);
      expect(draft.step.valueStrategy).toBe("dataset");
      expect(draft.capturedInputKind).toBe(inputKind);
      expect(draft.capturedValue).toBe(value);
    },
  );

  it("uses the selected radio value together with its group name", () => {
    const draft = build(
      event("radio", {
        value: "premium",
        target: {
          tagName: "input",
          inputType: "radio",
          name: "customer_plan",
          label: "Premium",
          role: "radio",
          dataAttributes: {
            "data-field": "customer_plan",
          },
          cssPath: 'input[name="customer_plan"]',
        },
      }),
    );

    expect(draft.step.target?.primary).toEqual({
      type: "css",
      operator: "equals",
      value: 'input[type="radio"][name="customer_plan"][value="premium"]',
    });
    expect(draft.step.fallbacks.map(({ locator }) => locator)).toContainEqual({
      type: "label",
      operator: "equals",
      value: "Premium",
    });
    expect(draft.step.fallbacks.map(({ locator }) => locator)).toContainEqual({
      type: "role",
      role: "radio",
      operator: "equals",
      value: "Premium",
    });
  });

  it("captures special key presses", () => {
    const draft = build(event("press_key", { key: "Escape" }));
    expect(draft.step).toMatchObject({
      actionType: "press_key",
      key: "Escape",
    });
  });

  it("captures navigation and relevant scroll coordinates without a target", () => {
    const navigation = build({
      type: "navigate",
      url: "https://example.test/cart",
      timestamp: "2026-07-25T10:00:00.000Z",
    });
    const scroll = build({
      type: "scroll",
      url: "https://example.test/cart",
      timestamp: "2026-07-25T10:00:00.000Z",
      scrollX: 20.4,
      scrollY: 811.8,
    });

    expect(navigation.step).toMatchObject({
      actionType: "navigate",
      url: "https://example.test/cart",
    });
    expect(scroll.step).toMatchObject({
      actionType: "scroll",
      scrollX: 20,
      scrollY: 812,
    });
  });

  it("keeps the semantic target for a nested container scroll", () => {
    const scroll = build({
      type: "scroll",
      url: "https://example.test/products",
      timestamp: "2026-07-25T10:00:00.000Z",
      scrollX: 0,
      scrollY: 360,
      scrollMode: "wheel",
      target: {
        tagName: "div",
        id: "results",
        dataAttributes: { "data-testid": "search-results" },
        cssPath: "#results",
      },
    });

    expect(scroll.step).toMatchObject({
      actionType: "scroll",
      title: "Derulează containerul",
      scrollY: 360,
      scrollMode: "wheel",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          value: "search-results",
        },
      },
    });
  });

  it("uses a repeated-component locator instead of positional nth-child", () => {
    const draft = build(
      event("click", {
        target: {
          tagName: "button",
          role: "button",
          text: "Adaugă în coș",
          dataAttributes: {
            "data-testid": "add-to-cart",
          },
          repeated: {
            containerLocator: {
              type: "data_attribute",
              attribute: "data-component",
              operator: "equals",
              value: "product-card",
            },
            distinguishingText: "Laptop Pro",
          },
        },
      }),
    );

    expect(draft.step.target?.primary).toMatchObject({
      type: "repeated_component",
      container: { value: "product-card" },
      filters: [{ value: "Laptop Pro" }],
      targetInsideContainer: { value: "add-to-cart" },
    });
    expect(JSON.stringify(draft.step.target?.primary)).not.toContain(
      "nth-child",
    );
  });

  it("prefers the captured href and keeps it as a direct fallback for repeated product cards", () => {
    const draft = build(
      event("click", {
        target: {
          tagName: "a",
          href: "/produs/heavyweight-tee-black-edition/",
          role: "link",
          text: "Tricou gros — Ediție neagră",
          dataAttributes: {},
          repeated: {
            containerLocator: {
              type: "css",
              operator: "equals",
              value: "article",
            },
            distinguishingText: "Tricou gros — Ediție neagră",
          },
        },
      }),
    );

    const hrefLocator = {
      type: "css",
      operator: "equals",
      value: 'a[href="/produs/heavyweight-tee-black-edition/"]',
    };
    expect(draft.step.target?.primary).toMatchObject({
      type: "repeated_component",
      targetInsideContainer: hrefLocator,
    });
    expect(draft.step.fallbacks[0]?.locator).toEqual(hrefLocator);
  });

  it("does not create an invalid repeated-component locator without a distinguishing filter", () => {
    const draft = build(
      event("click", {
        target: {
          tagName: "div",
          text: "22",
          dataAttributes: {
            "data-date": "2026-10-22",
          },
          cssPath: "#calendar > div:nth-of-type(22)",
          repeated: {
            containerLocator: {
              type: "css",
              operator: "equals",
              value: ".cal-cell",
            },
          },
        },
      }),
    );

    expect(draft.step.target?.primary).toEqual({
      type: "data_attribute",
      attribute: "data-date",
      operator: "equals",
      value: "2026-10-22",
    });
    expect(JSON.stringify(draft.step.target?.primary)).not.toContain(
      "repeated_component",
    );
  });
});

describe("toSemanticFieldId", () => {
  it("normalizes Romanian labels into stable dataset keys", () => {
    expect(toSemanticFieldId("  Număr de telefon  ")).toBe("numar_de_telefon");
  });
});
