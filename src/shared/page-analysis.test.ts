import { describe, expect, it } from "vitest";

import { normalizeAnalyzedPageUrl } from "./page-analysis.js";

describe("normalizeAnalyzedPageUrl", () => {
  it("keeps the page path and removes query strings and hashes", () => {
    expect(
      normalizeAnalyzedPageUrl(
        "https://example.test/products/item?preview=1#details",
      ),
    ).toBe("https://example.test/products/item");
  });

  it("rejects non-web pages", () => {
    expect(() => normalizeAnalyzedPageUrl("file:///tmp/page.html")).toThrow(
      "HTTP sau HTTPS",
    );
  });
});
