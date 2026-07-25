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
  placeholder: "nume@exemplu.ro",
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
  it("prioritizes stable semantic locators and keeps fallbacks", () => {
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
      "label",
      "role",
      "placeholder",
    ]);
    expect(draft.step.humanDescription).toContain("Adresă de e-mail");
    expect(draft.step.whyExplanation.length).toBeGreaterThan(20);
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
});

describe("toSemanticFieldId", () => {
  it("normalizes Romanian labels into stable dataset keys", () => {
    expect(toSemanticFieldId("  Număr de telefon  ")).toBe("numar_de_telefon");
  });
});
