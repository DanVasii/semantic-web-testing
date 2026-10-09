import { describe, expect, it } from "vitest";

import { locatorConsoleSnippet } from "./locator-console-snippet.js";

describe("locatorConsoleSnippet", () => {
  it("serializes the locator and returns an inspectable element list", () => {
    const snippet = locatorConsoleSnippet({
      type: "css",
      operator: "equals",
      value: "#checkout",
    });

    expect(snippet).toContain('"value": "#checkout"');
    expect(snippet).toContain("console.table");
    expect(snippet).toContain("return elements");
  });

  it("uses text content for native buttons and value only for button inputs", () => {
    const snippet = locatorConsoleSnippet({
      type: "role",
      role: "button",
      operator: "equals",
      value: "Adaugă în coș →",
    });

    expect(snippet).toContain(
      'tag === "input" && ["button", "submit", "reset"].includes(type)',
    );
    expect(snippet.indexOf("inputValueName ||")).toBeLessThan(
      snippet.indexOf("element.textContent ||"),
    );
  });

  it("warns when a locator belongs to a cross-origin frame", () => {
    const snippet = locatorConsoleSnippet(
      {
        type: "css",
        operator: "equals",
        value: "#payment-numberInput",
      },
      { frameOrigin: "https://js.stripe.com" },
    );

    expect(snippet).toContain('expectedFrameOrigin = "https://js.stripe.com"');
    expect(snippet).toContain("Selectează frame-ul corect");
  });
});
