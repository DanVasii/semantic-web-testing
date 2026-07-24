import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { App } from "./App.js";

describe("App", () => {
  it("renders the renderer foundation", () => {
    const markup = renderToStaticMarkup(<App />);

    expect(markup).toContain("<h1>Semantic Web Testing App</h1>");
    expect(markup).toContain("Fundația renderer-ului React este activă.");
  });
});
