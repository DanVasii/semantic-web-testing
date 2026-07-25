import { describe, expect, it } from "vitest";

import {
  assertShortcutAvailable,
  getContinueShortcut,
  matchesShortcut,
  normalizeShortcut,
  withContinueShortcut,
} from "./shortcuts.js";

describe("runner shortcuts", () => {
  it("normalizes shortcuts and matches keyboard events", () => {
    expect(normalizeShortcut("shift + control + enter")).toBe(
      "Ctrl+Shift+Enter",
    );
    expect(
      matchesShortcut(
        {
          ctrlKey: true,
          altKey: false,
          shiftKey: true,
          metaKey: false,
          key: "Enter",
        },
        "Ctrl+Shift+Enter",
      ),
    ).toBe(true);
    expect(getContinueShortcut({})).toBe("Ctrl+Enter");
    expect(getContinueShortcut(withContinueShortcut({}, "Alt+Enter"))).toBe(
      "Alt+Enter",
    );
  });

  it("detects conflicts with other configured project shortcuts", () => {
    expect(() =>
      assertShortcutAvailable(
        {
          stopRun: "Alt+S",
          retryRun: "Ctrl+R",
        },
        "alt+s",
      ),
    ).toThrow("este deja folosit de acțiunea stopRun");
    expect(
      assertShortcutAvailable({ continueRun: "Ctrl+Enter" }, "Ctrl+Enter"),
    ).toBe("Ctrl+Enter");
  });
});
