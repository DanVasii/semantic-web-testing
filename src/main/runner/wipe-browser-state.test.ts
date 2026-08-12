import type { BrowserContext, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import type { WipeLogEntry } from "../../shared/runner.js";
import {
  extractHttpOrigin,
  wipeBrowserStateForOrigin,
  WipeError,
} from "./wipe-browser-state.js";

const storageEntries = (): WipeLogEntry[] => [
  {
    resource: "localStorage",
    status: "cleared",
    message: "localStorage a fost șters.",
    count: 2,
  },
  {
    resource: "sessionStorage",
    status: "cleared",
    message: "sessionStorage a fost șters.",
    count: 1,
  },
  {
    resource: "indexedDB",
    status: "cleared",
    message: "Bazele IndexedDB au fost șterse.",
    count: 1,
  },
  {
    resource: "cacheStorage",
    status: "cleared",
    message: "Cache Storage a fost șters.",
    count: 1,
  },
  {
    resource: "serviceWorkers",
    status: "cleared",
    message: "Service workers au fost dezînregistrați.",
    count: 1,
  },
  {
    resource: "permissions",
    status: "skipped",
    message: "Celelalte origin-uri sunt protejate.",
  },
];

const createHarness = (entries: WipeLogEntry[] = storageEntries()) => {
  const clearCookies = vi.fn().mockResolvedValue(undefined);
  const cookies = vi.fn().mockResolvedValue([
    {
      name: "target",
      value: "one",
      domain: ".shop.example.test",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
    {
      name: "other",
      value: "two",
      domain: "other.example.test",
      path: "/",
      expires: -1,
      httpOnly: false,
      secure: true,
      sameSite: "Lax",
    },
  ]);
  const evaluate = vi.fn().mockResolvedValue(entries);
  const goto = vi.fn().mockResolvedValue(null);
  const setContent = vi.fn().mockResolvedValue(undefined);
  const url = vi
    .fn()
    .mockReturnValue("https://shop.example.test:8443/products");
  return {
    context: { clearCookies, cookies } as unknown as BrowserContext,
    page: { evaluate, goto, setContent, url } as unknown as Page,
    spies: { clearCookies, cookies, evaluate, goto, setContent, url },
  };
};

describe("wipeBrowserStateForOrigin", () => {
  it("extracts the exact HTTP origin including a non-default port", () => {
    expect(
      extractHttpOrigin(
        "https://shop.example.test:8443/products?category=10#list",
      ),
    ).toBe("https://shop.example.test:8443");
    expect(() => extractHttpOrigin("file:///tmp/site.html")).toThrow(
      "HTTP sau HTTPS",
    );
  });

  it("clears only the requested origin and returns a structured log", async () => {
    const harness = createHarness();

    const result = await wipeBrowserStateForOrigin(
      harness.context,
      harness.page,
      "https://shop.example.test:8443/products",
    );

    expect(result).toMatchObject({
      origin: "https://shop.example.test:8443",
      status: "completed",
    });
    expect(result.entries.map((entry) => entry.resource)).toEqual([
      "navigation",
      "cookies",
      "localStorage",
      "sessionStorage",
      "indexedDB",
      "cacheStorage",
      "serviceWorkers",
      "permissions",
    ]);
    expect(harness.spies.cookies).toHaveBeenCalledWith([
      "https://shop.example.test:8443",
    ]);
    const cookieFilter: unknown = harness.spies.clearCookies.mock.calls[0]?.[0];
    if (
      typeof cookieFilter !== "object" ||
      cookieFilter === null ||
      !("domain" in cookieFilter) ||
      !(cookieFilter.domain instanceof RegExp)
    ) {
      throw new Error("Filtrul cookie nu este RegExp.");
    }
    expect(cookieFilter.domain).toBeInstanceOf(RegExp);
    expect(cookieFilter.domain.test(".shop.example.test")).toBe(true);
    expect(cookieFilter.domain.test("other.example.test")).toBe(false);
    expect(harness.spies.evaluate).toHaveBeenCalledWith(expect.any(Function), {
      expectedOrigin: "https://shop.example.test:8443",
      selectedResources: [
        "cookies",
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "cacheStorage",
        "serviceWorkers",
      ],
    });
    expect(harness.spies.setContent).toHaveBeenCalledOnce();
    expect(harness.spies.goto).toHaveBeenCalledOnce();
  });

  it("reports a critical storage failure and does not reload the test", async () => {
    const harness = createHarness([
      {
        resource: "indexedDB",
        status: "failed",
        message: "Baza este blocată.",
      },
    ]);

    const promise = wipeBrowserStateForOrigin(
      harness.context,
      harness.page,
      "https://shop.example.test:8443/products",
    );

    await expect(promise).rejects.toBeInstanceOf(WipeError);
    await expect(promise).rejects.toMatchObject({
      result: {
        origin: "https://shop.example.test:8443",
        status: "failed",
      },
    });
    expect(harness.spies.goto).not.toHaveBeenCalled();
  });

  it("clears only the manually selected resources", async () => {
    const harness = createHarness();

    const result = await wipeBrowserStateForOrigin(
      harness.context,
      harness.page,
      "https://shop.example.test:8443/products",
      { reloadStartPage: false, resources: ["cookies"] },
    );

    expect(result.status).toBe("completed");
    expect(harness.spies.clearCookies).toHaveBeenCalledOnce();
    expect(harness.spies.evaluate).not.toHaveBeenCalled();
    expect(harness.spies.setContent).not.toHaveBeenCalled();
    expect(harness.spies.goto).not.toHaveBeenCalled();
  });

  it("clears the origin after a run without reopening the start page", async () => {
    const harness = createHarness();

    const result = await wipeBrowserStateForOrigin(
      harness.context,
      harness.page,
      "https://shop.example.test:8443/products",
      { reloadStartPage: false },
    );

    expect(result.status).toBe("completed");
    expect(harness.spies.clearCookies).toHaveBeenCalledOnce();
    expect(harness.spies.evaluate).toHaveBeenCalledOnce();
    expect(harness.spies.setContent).toHaveBeenCalledOnce();
    expect(harness.spies.goto).not.toHaveBeenCalled();
  });
});
