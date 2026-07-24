import { describe, expect, it } from "vitest";

import { createMainWindowOptions } from "./window-options.js";

describe("main window options", () => {
  it("defines the expected window dimensions and identity", () => {
    expect(createMainWindowOptions("preload.cjs")).toMatchObject({
      width: 1280,
      height: 800,
      minWidth: 960,
      minHeight: 640,
      backgroundColor: "#f7f5f2",
      title: "Semantic Web Testing App",
    });
  });

  it("keeps the renderer isolated from Node.js", () => {
    expect(createMainWindowOptions("preload.cjs").webPreferences).toEqual(
      expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        preload: "preload.cjs",
        sandbox: true,
      }),
    );
  });

  it("creates independent option objects", () => {
    const firstOptions = createMainWindowOptions("first-preload.cjs");
    const secondOptions = createMainWindowOptions("second-preload.cjs");

    expect(firstOptions).not.toBe(secondOptions);
    expect(firstOptions.webPreferences).not.toBe(secondOptions.webPreferences);
  });
});
