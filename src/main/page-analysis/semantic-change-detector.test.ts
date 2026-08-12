import { describe, expect, it } from "vitest";

import type { SemanticAnalysis } from "../../shared/semantic-analysis.js";
import type { CapturedElement } from "./page-capture.js";
import {
  detectSemanticChange,
  normalizeDomForComparison,
  type SemanticComparisonSnapshot,
} from "./semantic-change-detector.js";

const analysis = (
  accessibleName = "Email",
  repeatedCount = 2,
): SemanticAnalysis => ({
  schemaVersion: 1,
  generatedAt: "2026-07-27T10:00:00.000Z",
  url: "https://example.test",
  elements: [
    {
      path: "/html[1]/body[1]/input[1]",
      fieldId: "email_field",
      role: "textbox",
      accessibleName,
      tag: "input",
      label: accessibleName,
      primaryLocator: {
        strategy: { type: "label", operator: "equals", value: accessibleName },
        unique: true,
        stability: 0.9,
        reason: "label",
      },
      fallbackLocators: [],
      locatorStability: 0.9,
    },
  ],
  repeatedComponents: [
    {
      id: "product_cards",
      semanticName: "Produse",
      containerSelector: {
        strategy: { type: "css", operator: "equals", value: ".product" },
        unique: false,
        stability: 0.8,
        reason: "container",
      },
      repeatedCount,
      itemPaths: Array.from(
        { length: repeatedCount },
        (_, index) => `/p/${index}`,
      ),
      childFields: [],
      actions: [],
    },
  ],
  calendarCandidates: [],
  slotLists: [],
});

const element = (id: string, label = "Email"): CapturedElement => ({
  path: "/html[1]/body[1]/input[1]",
  cssSelector: `#${id}`,
  tag: "input",
  text: "",
  attributes: { id, name: "email", "aria-label": label, type: "email" },
  ariaAttributes: { "aria-label": label },
  dataAttributes: {},
  states: { checked: false, selected: null, disabled: false },
  parentPath: "/html[1]/body[1]",
  formPath: "/html[1]/body[1]/form[1]",
});

const snapshot = (
  id: string,
  token: string,
  label = "Email",
  repeatedCount = 2,
): SemanticComparisonSnapshot => ({
  dom: `<html><body><form><input id="${id}" aria-label="${label}" data-token="${token}"></form></body></html>`,
  interactiveElements: [element(id, label)],
  forms: [
    {
      path: "/html[1]/body[1]/form[1]",
      cssSelector: "form",
      name: "booking",
      method: "post",
      action: "https://example.test/save?token=volatile",
      fieldPaths: ["/html[1]/body[1]/input[1]"],
    },
  ],
  semanticAnalysis: analysis(label, repeatedCount),
});

describe("semantic change detector", () => {
  it("normalizes dynamic ids and token values", () => {
    const first = normalizeDomForComparison(
      '<input id="react-123456" nonce="eyJaaaaaaaaaaaa.bbbbbbbb">',
    );
    const second = normalizeDomForComparison(
      '<input id="react-999999" nonce="eyJcccccccccccc.dddddddd">',
    );
    expect(first.value).toBe(second.value);
    expect(first.stats.dynamicIds).toBe(1);
    expect(first.stats.tokens).toBeGreaterThan(0);
  });

  it("does not invalidate for volatile identifiers only", () => {
    const change = detectSemanticChange({
      previousPageVersionId: "v1",
      currentPageVersionId: "v2",
      previous: snapshot("react-123456", "a".repeat(40)),
      current: snapshot("react-654321", "b".repeat(40)),
      threshold: 0.3,
    });
    expect(change.score).toBe(0);
    expect(change.exceeded).toBe(false);
    expect(change.ignoredDynamicIds).toBeGreaterThan(0);
    expect(change.ignoredTokens).toBeGreaterThan(0);
  });

  it("scores labels and repeated components as semantic changes", () => {
    const change = detectSemanticChange({
      previousPageVersionId: "v1",
      currentPageVersionId: "v2",
      previous: snapshot("email", "stable", "Email", 2),
      current: snapshot("email", "stable", "Telefon", 4),
      threshold: 0.3,
    });
    expect(
      change.metrics.find(({ category }) => category === "labels")?.score,
    ).toBe(1);
    expect(
      change.metrics.find(({ category }) => category === "repeated_components")
        ?.score,
    ).toBe(1);
    expect(change.exceeded).toBe(true);
  });
});
