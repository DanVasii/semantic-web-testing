import { describe, expect, it } from "vitest";

import { createAppInfo } from "./app-info.js";

describe("app info", () => {
  it("creates the serializable value returned through IPC", () => {
    expect(createAppInfo("0.1.0", "41.7.1")).toEqual({
      version: "0.1.0",
      electronVersion: "41.7.1",
    });
  });
});
