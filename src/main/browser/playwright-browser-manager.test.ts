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

const createBrowser = (): Browser =>
  ({
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
  }) as unknown as Browser;

const createManager = () => {
  const browsers = {
    chromium: createBrowser(),
    firefox: createBrowser(),
    webkit: createBrowser(),
  };
  const launchers = {
    chromium: vi.fn().mockResolvedValue(browsers.chromium),
    firefox: vi.fn().mockResolvedValue(browsers.firefox),
    webkit: vi.fn().mockResolvedValue(browsers.webkit),
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
  const manager = new PlaywrightBrowserManager({
    browserTypes,
    createId: () => "session-1",
    headless: true,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
  });

  return { browsers, launchers, manager };
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
