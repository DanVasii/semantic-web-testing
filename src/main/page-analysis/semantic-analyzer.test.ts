import { describe, expect, it } from "vitest";

import type { CapturedElement, PageCapture } from "./page-capture.js";
import { analyzePageSemantics } from "./semantic-analyzer.js";

const capturedElement = (
  path: string,
  tag: string,
  options: {
    text?: string;
    attributes?: Record<string, string>;
    parentPath?: string | null;
  } = {},
): CapturedElement => ({
  path,
  cssSelector:
    options.attributes?.id === undefined
      ? path
          .slice(1)
          .split("/")
          .map((segment) => segment.replace(/\[(\d+)\]/, ":nth-of-type($1)"))
          .join(" > ")
      : `#${options.attributes.id}`,
  tag,
  text: options.text ?? "",
  attributes: options.attributes ?? {},
  ariaAttributes: Object.fromEntries(
    Object.entries(options.attributes ?? {}).filter(([name]) =>
      name.startsWith("aria-"),
    ),
  ),
  dataAttributes: Object.fromEntries(
    Object.entries(options.attributes ?? {}).filter(([name]) =>
      name.startsWith("data-"),
    ),
  ),
  states: {
    checked: null,
    selected: null,
    disabled: false,
  },
  parentPath: options.parentPath ?? null,
  formPath: null,
});

const createCapture = (
  allElements: CapturedElement[],
  interactiveElements: CapturedElement[],
): PageCapture => ({
  url: "https://example.test/checkout",
  title: "Checkout",
  html: "<html></html>",
  serializedDom: "<html></html>",
  accessibilitySnapshot: "",
  allElements,
  visibleTexts: [],
  interactiveElements,
  ariaElements: allElements.filter(
    ({ ariaAttributes }) => Object.keys(ariaAttributes).length > 0,
  ),
  dataElements: allElements.filter(
    ({ dataAttributes }) => Object.keys(dataAttributes).length > 0,
  ),
  statefulElements: [],
  forms: [],
  inputs: interactiveElements.filter(({ tag }) =>
    ["input", "select", "textarea"].includes(tag),
  ),
  buttons: interactiveElements.filter(({ tag }) => tag === "button"),
  links: interactiveElements.filter(({ tag }) => tag === "a"),
  selectableElements: interactiveElements.filter(({ tag }) =>
    ["select", "option"].includes(tag),
  ),
  inlineStyles: [],
  styleTags: [],
  stylesheets: [],
  shadowRoots: [],
  css: "",
  counts: {
    visibleTexts: 0,
    interactiveElements: interactiveElements.length,
    forms: 0,
    inputs: 0,
    buttons: 0,
    links: 0,
    selectableElements: 0,
    inlineStyles: 0,
    styleTags: 0,
    externalStylesheets: 0,
  },
  inaccessibleStylesheets: [],
});

const analyze = (
  allElements: CapturedElement[],
  interactiveElements: CapturedElement[],
) =>
  analyzePageSemantics(createCapture(allElements, interactiveElements), {
    generatedAt: "2026-07-24T12:00:00.000Z",
    url: "https://example.test/checkout",
  });

describe("analyzePageSemantics", () => {
  it("detects labels, accessible names, roles and unique semantic field IDs", () => {
    const body = capturedElement("/html[1]/body[1]", "body");
    const emailLabel = capturedElement("/html[1]/body[1]/label[1]", "label", {
      text: "Email client",
      attributes: { for: "customer-email" },
      parentPath: body.path,
    });
    const email = capturedElement("/html[1]/body[1]/input[1]", "input", {
      attributes: {
        id: "customer-email",
        name: "customer_email",
        type: "email",
        placeholder: "client@example.test",
        "data-field": "customer_email",
      },
      parentPath: body.path,
    });
    const firstButton = capturedElement(
      "/html[1]/body[1]/button[1]",
      "button",
      {
        text: "Adaugă în coș",
        attributes: { "data-testid": "primary-add-to-cart" },
        parentPath: body.path,
      },
    );
    const secondButton = capturedElement(
      "/html[1]/body[1]/button[2]",
      "button",
      {
        text: "Adaugă în coș",
        parentPath: body.path,
      },
    );

    const result = analyze(
      [body, emailLabel, email, firstButton, secondButton],
      [email, firstButton, secondButton],
    );
    const emailAnalysis = result.elements.find(
      ({ path }) => path === email.path,
    );
    const buttonAnalyses = result.elements.filter(
      ({ role }) => role === "button",
    );

    expect(emailAnalysis).toMatchObject({
      label: "Email client",
      accessibleName: "Email client",
      role: "textbox",
      fieldId: "customer_email",
      primaryLocator: {
        strategy: {
          type: "data_attribute",
          attribute: "data-field",
          value: "customer_email",
        },
        unique: true,
      },
    });
    const fallbackTypes = emailAnalysis?.fallbackLocators.map(
      ({ strategy }) => strategy.type,
    );
    expect(fallbackTypes).toContain("css");
    expect(fallbackTypes).toContain("label");
    expect(buttonAnalyses.map(({ fieldId }) => fieldId)).toEqual([
      "add_to_cart_button",
      "add_to_cart_button_2",
    ]);
    expect(buttonAnalyses[0]?.primaryLocator).toMatchObject({
      strategy: {
        type: "data_attribute",
        attribute: "data-testid",
      },
      stability: 0.98,
      unique: true,
    });
    expect(
      result.elements.every(
        ({ locatorStability }) =>
          locatorStability >= 0 && locatorStability <= 1,
      ),
    ).toBe(true);
    expect(
      result.elements.every(({ fieldId }) =>
        /^[a-z_][a-z0-9_]*$/.test(fieldId),
      ),
    ).toBe(true);
  });

  it("detects repeated components, their titles and actions", () => {
    const body = capturedElement("/html[1]/body[1]", "body");
    const grid = capturedElement("/html[1]/body[1]/div[1]", "div", {
      attributes: { class: "product-grid" },
      parentPath: body.path,
    });
    const elements: CapturedElement[] = [body, grid];
    const interactive: CapturedElement[] = [];

    for (let index = 1; index <= 3; index += 1) {
      const card = capturedElement(
        `/html[1]/body[1]/div[1]/article[${index}]`,
        "article",
        {
          text: `Produs ${index} Adaugă în coș`,
          attributes: {
            class: "product-card",
            "data-component": "product-card",
          },
          parentPath: grid.path,
        },
      );
      const title = capturedElement(`${card.path}/h3[1]`, "h3", {
        text: `Produs ${index}`,
        attributes: { class: "product-title" },
        parentPath: card.path,
      });
      const button = capturedElement(`${card.path}/button[1]`, "button", {
        text: "Adaugă în coș",
        attributes: { class: "add-to-cart" },
        parentPath: card.path,
      });
      elements.push(card, title, button);
      interactive.push(button);
    }

    const result = analyze(elements, interactive);

    expect(result.repeatedComponents).toHaveLength(1);
    expect(result.repeatedComponents[0]).toMatchObject({
      semanticName: "Product card",
      repeatedCount: 3,
      containerSelector: {
        strategy: {
          type: "data_attribute",
          attribute: "data-component",
          value: "product-card",
        },
      },
    });
    expect(result.repeatedComponents[0]?.titleField).toMatchObject({
      accessibleName: "Produs 1",
      role: "heading",
    });
    expect(result.repeatedComponents[0]?.actions).toHaveLength(1);
    expect(result.repeatedComponents[0]?.actions[0]).toMatchObject({
      accessibleName: "Adaugă în coș",
      role: "button",
    });
  });

  it("detects calendar candidates and time-slot lists", () => {
    const body = capturedElement("/html[1]/body[1]", "body");
    const calendar = capturedElement("/html[1]/body[1]/div[1]", "div", {
      attributes: {
        class: "booking-calendar",
        role: "grid",
        "aria-label": "Calendar programare",
      },
      parentPath: body.path,
    });
    const slotList = capturedElement("/html[1]/body[1]/div[2]", "div", {
      attributes: {
        class: "time-slot-list",
        "aria-label": "Ore disponibile",
      },
      parentPath: body.path,
    });
    const elements = [body, calendar, slotList];
    const interactive: CapturedElement[] = [];

    for (let day = 1; day <= 7; day += 1) {
      const dayButton = capturedElement(
        `${calendar.path}/button[${day}]`,
        "button",
        {
          text: String(day),
          attributes: {
            class: "calendar-day",
            role: "gridcell",
            "aria-label": `24 iulie, ziua ${day}`,
          },
          parentPath: calendar.path,
        },
      );
      elements.push(dayButton);
      interactive.push(dayButton);
    }
    for (const [index, time] of ["09:00", "10:30", "12:00"].entries()) {
      const slot = capturedElement(
        `${slotList.path}/button[${index + 1}]`,
        "button",
        {
          text: time,
          attributes: { class: "time-slot" },
          parentPath: slotList.path,
        },
      );
      elements.push(slot);
      interactive.push(slot);
    }

    const result = analyze(elements, interactive);

    expect(result.calendarCandidates).toHaveLength(1);
    expect(result.calendarCandidates[0]).toMatchObject({
      semanticName: "Calendar programare",
      confidence: 1,
    });
    expect(result.calendarCandidates[0]?.dayElementPaths).toContain(
      `${calendar.path}/button[1]`,
    );
    expect(result.calendarCandidates[0]?.dayElementPaths).toContain(
      `${calendar.path}/button[7]`,
    );
    expect(result.slotLists).toHaveLength(1);
    expect(result.slotLists[0]).toMatchObject({
      semanticName: "Ore disponibile",
      slotElementPaths: [
        `${slotList.path}/button[1]`,
        `${slotList.path}/button[2]`,
        `${slotList.path}/button[3]`,
      ],
    });
  });
});
