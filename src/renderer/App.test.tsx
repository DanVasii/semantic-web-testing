import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("renders the renderer foundation", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("Semantic Web Testing App");
    expect(markup).toContain("bg-app-canvas");
    expect(markup).toContain("bg-brand-500");
    expect(markup).toContain("Light mode cu accent portocaliu.");
    expect(markup).toContain("Se încarcă informațiile aplicației.");
  });
});
