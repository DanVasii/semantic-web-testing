import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const stylesPath = fileURLToPath(new URL("./styles.css", import.meta.url));

describe("design tokens", () => {
  it("defines the light palette and orange accent tokens", async () => {
    const styles = await readFile(stylesPath, "utf8");

    expect(styles).toContain("--color-app-canvas: #f7f5f2");
    expect(styles).toContain("--color-app-surface: #ffffff");
    expect(styles).toContain("--color-app-ink: #241f1b");
    expect(styles).toContain("--color-brand-500: #f97316");
    expect(styles).toContain("--color-brand-700: #c2410c");
  });
});
