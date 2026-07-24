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

const createPage = () => ({
  goto: vi.fn().mockResolvedValue(null),
  url: vi.fn().mockReturnValue("https://example.test/shop"),
  once: vi.fn(),
  on: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
});

const createContext = (page: ReturnType<typeof createPage>) => ({
  newPage: vi.fn().mockResolvedValue(page),
  close: vi.fn().mockResolvedValue(undefined),
  once: vi.fn(),
  isClosed: vi.fn().mockReturnValue(false),
});

const createEngineHarness = (executablePath: string) => {
  const page = createPage();
  const regularContext = createContext(page);
  const persistentContext = createContext(page);
  const cdpContext = createContext(page);
  const launchedBrowser = {
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    newContext: vi.fn().mockResolvedValue(regularContext),
    contexts: vi.fn().mockReturnValue([regularContext]),
  };
  const cdpBrowser = {
    once: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    contexts: vi.fn().mockReturnValue([cdpContext]),
  };
  Object.assign(persistentContext, {
    browser: vi.fn().mockReturnValue(launchedBrowser as unknown as Browser),
  });
  const adapter = {
    executablePath: () => executablePath,
    launch: vi.fn().mockResolvedValue(launchedBrowser),
    launchPersistentContext: vi.fn().mockResolvedValue(persistentContext),
    connectOverCDP: vi.fn().mockResolvedValue(cdpBrowser),
  };

  return {
    adapter,
    cdpBrowser,
    cdpContext,
    launchedBrowser,
    page,
    persistentContext,
    regularContext,
  };
};

const createManager = (
  overrides: Partial<PlaywrightBrowserManagerOptions> = {},
) => {
  const engines = {
    chromium: createEngineHarness("C:\\playwright\\chromium.exe"),
    firefox: createEngineHarness("C:\\playwright\\firefox.exe"),
    webkit: createEngineHarness("C:\\playwright\\webkit.exe"),
  };
  const browserTypes: NonNullable<
    PlaywrightBrowserManagerOptions["browserTypes"]
  > = {
    chromium: engines.chromium.adapter,
    firefox: engines.firefox.adapter,
    webkit: engines.webkit.adapter,
  };
  const createId = vi
    .fn()
    .mockReturnValueOnce("session-1")
    .mockReturnValueOnce("tab-1")
    .mockReturnValueOnce("tab-2")
    .mockReturnValue("generated-id");
  const manager = new PlaywrightBrowserManager({
    browserTypes,
    cdpConnectAttempts: 1,
    createId,
    headless: true,
    now: () => new Date("2026-07-24T12:00:00.000Z"),
    pathExists: () => false,
    wait: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  });

  return { browserTypes, createId, engines, manager };
};

const launchOptions = (
  browser: BrowserProduct,
  source: BrowserLaunchOptions["source"],
  executablePath?: string,
  overrides: Partial<BrowserLaunchOptions> = {},
): BrowserLaunchOptions => ({
  projectId: "project-1",
  browser,
  source,
  sessionMode: "temporary",
  ...(executablePath === undefined ? {} : { executablePath }),
  ...overrides,
});

const disconnectedListener = (
  once: ReturnType<typeof vi.fn>,
): (() => void) | undefined => {
  const call = once.mock.calls.find(([event]) => event === "disconnected");
  return call?.[1] as (() => void) | undefined;
};

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
    const { engines, manager } = createManager();
    const systemPath =
      source === "system" ? `C:\\Browsers\\${product}.exe` : undefined;

    const session = await manager.launch(
      launchOptions(product, source, systemPath),
    );

    expect(engines[engine].adapter.launch).toHaveBeenCalledWith({
      headless: true,
      executablePath: systemPath ?? `C:\\playwright\\${engine}.exe`,
    } satisfies LaunchOptions);
    expect(engines[engine].launchedBrowser.newContext).toHaveBeenCalledWith({});
    expect(session).toMatchObject({
      id: "session-1",
      projectId: "project-1",
      browser: product,
      engine,
      sessionMode: "temporary",
    });
  });

  it("requires an executable path for a system browser", async () => {
    const { manager } = createManager();

    await expect(
      manager.launch(launchOptions("chrome", "system")),
    ).rejects.toThrow("Calea executabilului browserului lipsește.");
  });

  it("reuses an active reusable session but not a temporary one", async () => {
    const reusable = createManager();
    const options = launchOptions("chromium", "playwright", undefined, {
      sessionMode: "reusable",
    });

    const first = await reusable.manager.launch(options);
    const second = await reusable.manager.launch(options);

    expect(second).toBe(first);
    expect(reusable.engines.chromium.adapter.launch).toHaveBeenCalledOnce();

    const temporary = createManager();
    await temporary.manager.launch(launchOptions("chromium", "playwright"));
    await expect(
      temporary.manager.launch(launchOptions("chromium", "playwright")),
    ).rejects.toThrow("Un browser este deja pornit.");
  });
});

describe("PlaywrightBrowserManager contexts and CDP", () => {
  it("creates a temporary context with the configured viewport", async () => {
    const { engines, manager } = createManager();

    await manager.launch(
      launchOptions("chromium", "playwright", undefined, {
        viewport: { width: 1440, height: 900 },
      }),
    );

    expect(engines.chromium.launchedBrowser.newContext).toHaveBeenCalledWith({
      viewport: { width: 1440, height: 900 },
    });
  });

  it("launches a persistent profile context", async () => {
    const { engines, manager } = createManager();

    const session = await manager.launch(
      launchOptions("chrome", "system", "C:\\Chrome\\chrome.exe", {
        sessionMode: "persistent_profile",
        profilePath: "D:\\profiles\\semantic",
      }),
    );

    expect(
      engines.chromium.adapter.launchPersistentContext,
    ).toHaveBeenCalledWith("D:\\profiles\\semantic", {
      headless: true,
      executablePath: "C:\\Chrome\\chrome.exe",
    });
    expect(engines.chromium.adapter.launch).not.toHaveBeenCalled();
    expect(session.sessionMode).toBe("persistent_profile");
  });

  it("launches Chrome with remote debugging and connects through CDP", async () => {
    const { engines, manager } = createManager();

    await manager.launch(
      launchOptions("chrome", "system", "C:\\Chrome\\chrome.exe", {
        sessionMode: "external_chrome_debug",
        profilePath: "D:\\profiles\\semantic",
        remoteDebuggingPort: 9333,
      }),
    );

    expect(
      engines.chromium.adapter.launchPersistentContext,
    ).toHaveBeenCalledWith("D:\\profiles\\semantic", {
      headless: true,
      executablePath: "C:\\Chrome\\chrome.exe",
      args: ["--remote-debugging-port=9333"],
    });
    expect(engines.chromium.adapter.connectOverCDP).toHaveBeenCalledWith(
      "http://127.0.0.1:9333",
    );

    await manager.openProjectUrl("project-1", "https://example.test/shop");
    expect(engines.chromium.cdpContext.newPage).toHaveBeenCalledOnce();
  });

  it("rejects a locked Chrome profile with a specific error", async () => {
    const { engines, manager } = createManager({
      pathExists: (path) => path.endsWith("SingletonLock"),
    });

    await expect(
      manager.launch(
        launchOptions("chrome", "system", "C:\\Chrome\\chrome.exe", {
          sessionMode: "persistent_profile",
          profilePath: "D:\\profiles\\locked",
        }),
      ),
    ).rejects.toThrow("Profilul Chrome este deja folosit");
    expect(
      engines.chromium.adapter.launchPersistentContext,
    ).not.toHaveBeenCalled();
  });
});

describe("PlaywrightBrowserManager navigation and lifecycle", () => {
  it("opens project URLs in the same active context", async () => {
    const { engines, manager } = createManager();
    await manager.launch(
      launchOptions("chromium", "playwright", undefined, {
        sessionMode: "reusable",
      }),
    );

    await manager.openProjectUrl("project-1", "https://example.test/shop");
    await manager.openProjectUrl("project-1", "https://example.test/account");

    expect(engines.chromium.launchedBrowser.newContext).toHaveBeenCalledOnce();
    expect(engines.chromium.regularContext.newPage).toHaveBeenCalledTimes(2);
  });

  it("closes only the tracked tabs for the project", async () => {
    const { engines, manager } = createManager();
    await manager.launch(launchOptions("chromium", "playwright"));
    await manager.openProjectUrl("project-1", "https://example.test/shop");
    await manager.openProjectUrl("project-1", "https://example.test/account");
    const popupListener = engines.chromium.page.on.mock.calls.find(
      ([event]) => event === "popup",
    )?.[1] as ((popup: typeof engines.chromium.page) => void) | undefined;
    popupListener?.(engines.chromium.page);

    await manager.closeProjectTabs("project-1");

    expect(engines.chromium.page.close).toHaveBeenCalledTimes(3);
    expect(manager.getStatus().state).toBe("running");
  });

  it("recovers a lost browser connection by relaunching", async () => {
    const { engines, manager } = createManager();
    await manager.launch(
      launchOptions("chromium", "playwright", undefined, {
        sessionMode: "reusable",
      }),
    );
    disconnectedListener(engines.chromium.launchedBrowser.once)?.();

    expect(manager.getStatus()).toMatchObject({
      state: "closed",
      canReconnect: true,
    });

    await manager.recoverConnection();

    expect(engines.chromium.adapter.launch).toHaveBeenCalledTimes(2);
    expect(manager.getStatus()).toMatchObject({
      state: "running",
      canReconnect: false,
    });
  });

  it("reconnects to an existing CDP browser without relaunching Chrome", async () => {
    const { engines, manager } = createManager();
    await manager.launch(
      launchOptions("chrome", "system", "C:\\Chrome\\chrome.exe", {
        sessionMode: "external_chrome_debug",
        profilePath: "D:\\profiles\\semantic",
        remoteDebuggingPort: 9333,
      }),
    );
    disconnectedListener(engines.chromium.cdpBrowser.once)?.();

    await manager.recoverConnection();

    expect(
      engines.chromium.adapter.launchPersistentContext,
    ).toHaveBeenCalledOnce();
    expect(engines.chromium.adapter.connectOverCDP).toHaveBeenCalledTimes(2);
    expect(manager.getStatus().state).toBe("running");
  });

  it("closes contexts and the browser in a controlled way", async () => {
    const { engines, manager } = createManager();
    await manager.launch(launchOptions("chromium", "playwright"));

    await manager.close();

    expect(engines.chromium.regularContext.close).toHaveBeenCalledOnce();
    expect(engines.chromium.launchedBrowser.close).toHaveBeenCalledOnce();
    expect(manager.getStatus()).toMatchObject({
      state: "closed",
      message: "Browserul a fost închis.",
      canReconnect: false,
    });
  });
});
