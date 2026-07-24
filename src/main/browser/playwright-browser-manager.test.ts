import type { Browser, LaunchOptions } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import type {
  BrowserEngine,
  BrowserLaunchOptions,
  BrowserProduct,
} from "../../shared/browser-manager.js";
import {
  PlaywrightBrowserManager,
  type PlaywrightBrowserManagerOptions,
} from "./playwright-browser-manager.js";

const createBrowser = () => {
  const page = {
    goto: vi.fn().mockResolvedValue(null),
    url: vi.fn().mockReturnValue("https://example.test/shop"),
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  };
  const browser = {
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    newPage: vi.fn().mockResolvedValue(page),
  };

  return {
    ...browser,
    page,
    value: browser as unknown as Browser,
  };
};

const createManager = () => {
  const browsers = {
    chromium: createBrowser(),
    firefox: createBrowser(),
    webkit: createBrowser(),
  };
  const launchers = {
    chromium: vi.fn().mockResolvedValue(browsers.chromium.value),
    firefox: vi.fn().mockResolvedValue(browsers.firefox.value),
    webkit: vi.fn().mockResolvedValue(browsers.webkit.value),
  };
  const browserTypes: PlaywrightBrowserManagerOptions["browserTypes"] = {
    chromium: {
      executablePath: () => "C:\\playwright\\chromium.exe",
      launch: launchers.chromium,
    },
    firefox: {
      executablePath: () => "C:\\playwright\\firefox.exe",
      launch: launchers.firefox,
    },
    webkit: {
      executablePath: () => "C:\\playwright\\webkit.exe",
      launch: launchers.webkit,
    },
  };
  const createId = vi
    .fn()
    .mockReturnValueOnce("session-1")
    .mockReturnValue("tab-1");
  const manager = new PlaywrightBrowserManager({
    browserTypes,
    createId,
    headless: true,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  return { browsers, createId, launchers, manager };
};

const launchOptions = (
  browser: BrowserProduct,
  source: BrowserLaunchOptions["source"],
  executablePath?: string,
): BrowserLaunchOptions => ({
  projectId: "project-1",
  browser,
  source,
  sessionMode: "temporary",
  ...(executablePath === undefined ? {} : { executablePath }),
});

describe("PlaywrightBrowserManager launch", () => {
  it.each([
    ["chromium", "playwright", "chromium"],
    ["firefox", "playwright", "firefox"],
    ["webkit", "playwright", "webkit"],
    ["chrome", "system", "chromium"],
    ["opera", "system", "chromium"],
  ] satisfies Array<
    [BrowserProduct, BrowserLaunchOptions["source"], BrowserEngine]
  >)("launches %s through the %s engine", async (product, source, engine) => {
    const { launchers, manager } = createManager();
    const systemPath =
      source === "system" ? `C:\\Browsers\\${product}.exe` : undefined;

    const session = await manager.launch(
      launchOptions(product, source, systemPath),
    );

    expect(launchers[engine]).toHaveBeenCalledWith({
      headless: true,
      executablePath: systemPath ?? `C:\\playwright\\${engine}.exe`,
    } satisfies LaunchOptions);
    expect(session).toEqual({
      id: "session-1",
      projectId: "project-1",
      browser: product,
      engine,
      sessionMode: "temporary",
      startedAt: "2026-07-24T12:00:00.000Z",
    });
    expect(manager.getStatus()).toMatchObject({
      state: "running",
      browser: product,
      sessionId: "session-1",
    });
  });

  it("requires an executable path for a system browser", async () => {
    const { manager } = createManager();

    await expect(
      manager.launch(launchOptions("chrome", "system")),
    ).rejects.toThrow("Calea executabilului browserului lipsește.");
  });

  it("does not start a second browser over an active session", async () => {
    const { manager } = createManager();
    await manager.launch(launchOptions("chromium", "playwright"));

    await expect(
      manager.launch(launchOptions("firefox", "playwright")),
    ).rejects.toThrow("Un browser este deja pornit.");
  });
});

describe("PlaywrightBrowserManager navigation and lifecycle", () => {
  it("opens the project URL in a new page", async () => {
    const { browsers, manager } = createManager();
    await manager.launch(launchOptions("chrome", "system", "C:\\chrome.exe"));

    const tab = await manager.openProjectUrl(
      "project-1",
      "https://example.test/shop",
    );

    expect(browsers.chromium.newPage).toHaveBeenCalledOnce();
    expect(browsers.chromium.page.goto).toHaveBeenCalledWith(
      "https://example.test/shop",
      { waitUntil: "domcontentloaded" },
    );
    expect(tab).toEqual({
      id: "tab-1",
      projectId: "project-1",
      url: "https://example.test/shop",
    });
  });

  it("requires an active browser for the same project and a web URL", async () => {
    const { manager } = createManager();

    await expect(
      manager.openProjectUrl("project-1", "https://example.test"),
    ).rejects.toThrow("Pornește un browser");

    await manager.launch(launchOptions("chromium", "playwright"));
    await expect(
      manager.openProjectUrl("project-2", "https://example.test"),
    ).rejects.toThrow("altui proiect");
    await expect(
      manager.openProjectUrl("project-1", "file:///tmp/index.html"),
    ).rejects.toThrow("HTTP sau HTTPS");
  });

  it("closes a page when its navigation fails", async () => {
    const { browsers, manager } = createManager();
    browsers.chromium.page.goto.mockRejectedValueOnce(
      new Error("Navigation failed"),
    );
    await manager.launch(launchOptions("chromium", "playwright"));

    await expect(
      manager.openProjectUrl("project-1", "https://example.test"),
    ).rejects.toThrow("Navigation failed");
    expect(browsers.chromium.page.close).toHaveBeenCalledOnce();
  });

  it("closes the active browser and publishes a controlled close status", async () => {
    const { browsers, manager } = createManager();
    const listener = vi.fn();
    manager.onStatusChange(listener);
    await manager.launch(launchOptions("chromium", "playwright"));

    await manager.close();

    expect(browsers.chromium.close).toHaveBeenCalledOnce();
    expect(manager.getStatus()).toEqual({
      state: "closed",
      browser: "chromium",
      projectId: "project-1",
      sessionId: "session-1",
      message: "Browserul a fost închis.",
    });
    expect(listener).toHaveBeenLastCalledWith(manager.getStatus());
  });

  it("detects when the browser is closed outside the application", async () => {
    const { browsers, manager } = createManager();
    const listener = vi.fn();
    manager.onStatusChange(listener);
    await manager.launch(launchOptions("chromium", "playwright"));
    const disconnectedCall = browsers.chromium.once.mock.calls.find(
      ([event]) => event === "disconnected",
    );
    const onDisconnected = disconnectedCall?.[1] as (() => void) | undefined;

    expect(onDisconnected).toBeTypeOf("function");
    onDisconnected?.();

    expect(manager.getStatus()).toEqual({
      state: "closed",
      browser: "chromium",
      projectId: "project-1",
      sessionId: "session-1",
      message: "Browserul a fost închis din exterior.",
    });
    expect(listener).toHaveBeenLastCalledWith(manager.getStatus());
  });
});
