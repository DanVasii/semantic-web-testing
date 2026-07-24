import { describe, expect, it } from "vitest";

import {
  RENDERER_DEVELOPMENT_URL,
  resolveRendererTarget,
} from "./renderer-target.js";

describe("renderer target", () => {
  it("uses the production file when no development server is configured", () => {
    expect(resolveRendererTarget(undefined, "renderer/index.html")).toEqual({
      kind: "production-file",
      value: "renderer/index.html",
    });
  });

  it("allows the fixed local development server", () => {
    expect(
      resolveRendererTarget(RENDERER_DEVELOPMENT_URL, "renderer/index.html"),
    ).toEqual({
      kind: "development-url",
      value: RENDERER_DEVELOPMENT_URL,
    });
  });

  it("rejects any other development URL", () => {
    expect(() =>
      resolveRendererTarget("https://example.com", "renderer/index.html"),
    ).toThrow("Adresa renderer-ului de development nu este permisă.");
  });
});
