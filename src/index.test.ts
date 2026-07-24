import { describe, expect, it } from "vitest";

import { applicationName } from "./index.js";

describe("application metadata", () => {
  it("exposes the application name", () => {
    expect(applicationName).toBe("Semantic Web Testing App");
  });
});
