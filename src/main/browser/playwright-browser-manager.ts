import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { join } from "node:path";

import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type BrowserType,
  type LaunchOptions,
  type Page,
} from "playwright-core";

import type {
  BrowserEngine,
  BrowserLaunchOptions,
  BrowserManager,
  BrowserManagerStatus,
  BrowserProduct,
  BrowserSession,
  BrowserStatusListener,
  BrowserTab,
  DetectedBrowser,
} from "../../shared/browser-manager.js";
import { detectBrowsers } from "./browser-detection.js";

type BrowserContextOptions = NonNullable<Parameters<Browser["newContext"]>[0]>;
type PersistentContextOptions = NonNullable<
  Parameters<BrowserType["launchPersistentContext"]>[1]
>;

interface BrowserTypeAdapter {
  executablePath: () => string;
  launch: (options: LaunchOptions) => Promise<Browser>;
  launchPersistentContext: (
    userDataDir: string,
    options: PersistentContextOptions,
  ) => Promise<BrowserContext>;
  connectOverCDP: (endpointUrl: string) => Promise<Browser>;
}

type RuntimeKind = "temporary" | "reusable" | "persistent" | "cdp";

interface BrowserRuntime {
  browser: Browser;
  context: BrowserContext;
  kind: RuntimeKind;
  ownerContext?: BrowserContext;
  cdpEndpoint?: string;
}

interface TrackedPage {
  projectId: string;
  page: Page;
}

export interface PlaywrightBrowserManagerOptions {
  browserTypes?: Record<BrowserEngine, BrowserTypeAdapter>;
  cdpConnectAttempts?: number;
  createId?: () => string;
  headless?: boolean;
  now?: () => Date;
  pathExists?: (path: string) => boolean;
  wait?: (milliseconds: number) => Promise<void>;
}

const adaptBrowserType = (browserType: BrowserType): BrowserTypeAdapter => ({
  executablePath: () => browserType.executablePath(),
  launch: async (options) => browserType.launch(options),
  launchPersistentContext: async (userDataDir, options) =>
    browserType.launchPersistentContext(userDataDir, options),
  connectOverCDP: async (endpointUrl) =>
    browserType.connectOverCDP(endpointUrl),
});

const engineForProduct = (product: BrowserProduct): BrowserEngine => {
  if (product === "firefox") {
    return "firefox";
  }

  if (product === "webkit" || product === "safari") {
    return "webkit";
  }

  return "chromium";
};

const cloneLaunchOptions = (
  options: BrowserLaunchOptions,
): BrowserLaunchOptions => ({
  ...options,
  ...(options.viewport === undefined
    ? {}
    : { viewport: { ...options.viewport } }),
});

export class PlaywrightBrowserManager implements BrowserManager {
  private readonly browserTypes: Record<BrowserEngine, BrowserTypeAdapter>;
  private readonly cdpConnectAttempts: number;
  private readonly createId: () => string;
  private readonly headless: boolean;
  private readonly now: () => Date;
  private readonly pathExists: (path: string) => boolean;
  private readonly wait: (milliseconds: number) => Promise<void>;
  private readonly listeners = new Set<BrowserStatusListener>();
  private readonly pages = new Map<string, TrackedPage>();
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private runtimeKind: RuntimeKind | undefined;
  private ownerContext: BrowserContext | undefined;
  private cdpEndpoint: string | undefined;
  private session: BrowserSession | undefined;
  private lastLaunchOptions: BrowserLaunchOptions | undefined;
  private isClosing = false;
  private status: BrowserManagerStatus = { state: "idle" };

  public constructor({
    browserTypes = {
      chromium: adaptBrowserType(chromium),
      firefox: adaptBrowserType(firefox),
      webkit: adaptBrowserType(webkit),
    },
    cdpConnectAttempts = 20,
    createId = randomUUID,
    headless = false,
    now = () => new Date(),
    pathExists = existsSync,
    wait = (milliseconds) =>
      new Promise((resolve) => setTimeout(resolve, milliseconds)),
  }: PlaywrightBrowserManagerOptions = {}) {
    this.browserTypes = browserTypes;
    this.cdpConnectAttempts = cdpConnectAttempts;
    this.createId = createId;
    this.headless = headless;
    this.now = now;
    this.pathExists = pathExists;
    this.wait = wait;
  }

  public detectAvailableBrowsers(): Promise<DetectedBrowser[]> {
    return Promise.resolve(
      detectBrowsers({
        playwrightPaths: {
          chromium: this.browserTypes.chromium.executablePath(),
          firefox: this.browserTypes.firefox.executablePath(),
          webkit: this.browserTypes.webkit.executablePath(),
        },
      }),
    );
  }

  public getStatus(): BrowserManagerStatus {
    return { ...this.status };
  }

  public async launch(options: BrowserLaunchOptions): Promise<BrowserSession> {
    if (this.browser !== undefined && this.session !== undefined) {
      if (this.canReuseActiveSession(options)) {
        return this.session;
      }

      throw new Error("Un browser este deja pornit.");
    }

    this.lastLaunchOptions = cloneLaunchOptions(options);
    return this.start(options, "starting");
  }

  public async openProjectUrl(
    projectId: string,
    url: string,
  ): Promise<BrowserTab> {
    const context = this.context;
    const session = this.session;

    if (context === undefined || session === undefined) {
      throw new Error("Pornește un browser înainte de a deschide proiectul.");
    }

    if (session.projectId !== projectId) {
      throw new Error("Browserul activ aparține altui proiect.");
    }

    const normalizedUrl = this.requireWebUrl(url);
    const page = await context.newPage();
    const tabId = this.trackPage(projectId, page);

    try {
      await page.goto(normalizedUrl, { waitUntil: "domcontentloaded" });
      return {
        id: tabId,
        projectId,
        url: page.url(),
      };
    } catch (error) {
      this.pages.delete(tabId);
      await page.close().catch(() => undefined);
      throw error;
    }
  }

  public async closeProjectTabs(projectId: string): Promise<void> {
    const projectPages = [...this.pages.entries()].filter(
      ([, tracked]) => tracked.projectId === projectId,
    );

    await Promise.all(
      projectPages.map(async ([tabId, tracked]) => {
        this.pages.delete(tabId);
        await tracked.page.close();
      }),
    );
  }

  public async recoverConnection(): Promise<BrowserSession> {
    if (this.browser !== undefined && this.session !== undefined) {
      return this.session;
    }

    const options = this.lastLaunchOptions;
    if (options === undefined || !this.status.canReconnect) {
      throw new Error("Nu există o conexiune de browser de recuperat.");
    }

    this.setStatus({
      state: "reconnecting",
      browser: options.browser,
      projectId: options.projectId,
      message: "Se încearcă recuperarea conexiunii.",
      canReconnect: true,
    });

    if (
      options.sessionMode === "external_chrome_debug" &&
      this.ownerContext !== undefined &&
      this.cdpEndpoint !== undefined &&
      !this.ownerContext.isClosed()
    ) {
      try {
        const browser = await this.connectOverCDPWithRetry(
          this.browserTypes.chromium,
          this.cdpEndpoint,
        );
        const context = browser.contexts()[0];

        if (context === undefined) {
          throw new Error("Chrome nu a expus contextul CDP implicit.");
        }

        const session = this.createSession(options);
        this.attachRuntime(
          {
            browser,
            context,
            kind: "cdp",
            ownerContext: this.ownerContext,
            cdpEndpoint: this.cdpEndpoint,
          },
          session,
          options,
        );
        return session;
      } catch (error) {
        const normalizedError = this.normalizeLaunchError(error);
        this.setFailedRecoveryStatus(options, normalizedError);
        throw normalizedError;
      }
    }

    return this.start(options, "reconnecting");
  }

  public async close(): Promise<void> {
    const browser = this.browser;
    const context = this.context;
    const ownerContext = this.ownerContext;
    const runtimeKind = this.runtimeKind;
    const session = this.session;

    this.isClosing = true;
    this.browser = undefined;
    this.context = undefined;
    this.ownerContext = undefined;
    this.runtimeKind = undefined;
    this.cdpEndpoint = undefined;
    this.session = undefined;
    this.pages.clear();

    try {
      if (runtimeKind === "cdp") {
        await browser?.close().catch(() => undefined);
        await ownerContext?.close().catch(() => undefined);
      } else {
        await context?.close().catch(() => undefined);
        if (runtimeKind !== "persistent") {
          await browser?.close().catch(() => undefined);
        }
      }
    } finally {
      this.isClosing = false;
    }

    this.setStatus({
      state: "closed",
      ...(session === undefined
        ? {}
        : {
            browser: session.browser,
            projectId: session.projectId,
            sessionId: session.id,
          }),
      message: "Browserul a fost închis.",
      canReconnect: false,
    });
  }

  public onStatusChange(listener: BrowserStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async start(
    options: BrowserLaunchOptions,
    state: "starting" | "reconnecting",
  ): Promise<BrowserSession> {
    this.setStatus({
      state,
      browser: options.browser,
      projectId: options.projectId,
      canReconnect: state === "reconnecting",
    });

    try {
      this.validateLaunchOptions(options);
      const runtime = await this.createRuntime(options);
      const session = this.createSession(options);
      this.attachRuntime(runtime, session, options);
      return session;
    } catch (error) {
      const normalizedError = this.normalizeLaunchError(error);
      this.setStatus({
        state: "failed",
        browser: options.browser,
        projectId: options.projectId,
        message: normalizedError.message,
        canReconnect: state === "reconnecting",
      });
      throw normalizedError;
    }
  }

  private async createRuntime(
    options: BrowserLaunchOptions,
  ): Promise<BrowserRuntime> {
    const engine = engineForProduct(options.browser);
    const browserType = this.browserTypes[engine];
    const executablePath =
      options.executablePath ??
      (options.source === "playwright"
        ? browserType.executablePath()
        : undefined);
    const contextOptions = this.createContextOptions(options);
    const launchOptions: LaunchOptions = {
      headless: this.headless,
      ...(executablePath === undefined ? {} : { executablePath }),
    };

    if (options.sessionMode === "persistent_profile") {
      const profilePath = this.requireProfilePath(options);
      this.assertProfileAvailable(profilePath);
      const context = await browserType.launchPersistentContext(profilePath, {
        ...launchOptions,
        ...contextOptions,
      });
      const browser = context.browser();

      if (browser === null) {
        await context.close().catch(() => undefined);
        throw new Error("Contextul persistent nu are un browser asociat.");
      }

      return { browser, context, kind: "persistent" };
    }

    if (options.sessionMode === "external_chrome_debug") {
      if (options.browser !== "chrome" || engine !== "chromium") {
        throw new Error("Modul CDP extern este disponibil doar pentru Chrome.");
      }

      const profilePath = this.requireProfilePath(options);
      const remoteDebuggingPort = this.requireRemoteDebuggingPort(options);
      this.assertProfileAvailable(profilePath);
      const ownerContext = await browserType.launchPersistentContext(
        profilePath,
        {
          ...launchOptions,
          ...contextOptions,
          args: [`--remote-debugging-port=${remoteDebuggingPort}`],
        },
      );
      const cdpEndpoint = `http://127.0.0.1:${remoteDebuggingPort}`;

      try {
        const browser = await this.connectOverCDPWithRetry(
          browserType,
          cdpEndpoint,
        );
        const context = browser.contexts()[0];

        if (context === undefined) {
          throw new Error("Chrome nu a expus contextul CDP implicit.");
        }

        return {
          browser,
          context,
          kind: "cdp",
          ownerContext,
          cdpEndpoint,
        };
      } catch (error) {
        await ownerContext.close().catch(() => undefined);
        throw error;
      }
    }

    const browser = await browserType.launch(launchOptions);

    try {
      const context = await browser.newContext(contextOptions);
      return {
        browser,
        context,
        kind: options.sessionMode === "reusable" ? "reusable" : "temporary",
      };
    } catch (error) {
      await browser.close().catch(() => undefined);
      throw error;
    }
  }

  private attachRuntime(
    runtime: BrowserRuntime,
    session: BrowserSession,
    options: BrowserLaunchOptions,
  ): void {
    this.browser = runtime.browser;
    this.context = runtime.context;
    this.runtimeKind = runtime.kind;
    this.ownerContext = runtime.ownerContext;
    this.cdpEndpoint = runtime.cdpEndpoint;
    this.session = session;

    runtime.browser.once("disconnected", () => {
      if (this.browser === runtime.browser && !this.isClosing) {
        this.browser = undefined;
        this.context = undefined;
        this.runtimeKind = undefined;
        this.session = undefined;
        this.pages.clear();

        if (runtime.kind !== "cdp") {
          this.ownerContext = undefined;
          this.cdpEndpoint = undefined;
        }

        this.setStatus({
          state: "closed",
          browser: options.browser,
          projectId: options.projectId,
          sessionId: session.id,
          message: "Conexiunea cu browserul a fost pierdută.",
          canReconnect: true,
        });
      }
    });

    runtime.ownerContext?.once("close", () => {
      if (this.ownerContext === runtime.ownerContext) {
        this.ownerContext = undefined;
      }
    });

    this.setStatus({
      state: "running",
      browser: options.browser,
      projectId: options.projectId,
      sessionId: session.id,
      canReconnect: false,
    });
  }

  private canReuseActiveSession(options: BrowserLaunchOptions): boolean {
    const session = this.session;
    return (
      session !== undefined &&
      session.sessionMode !== "temporary" &&
      session.projectId === options.projectId &&
      session.browser === options.browser &&
      session.sessionMode === options.sessionMode
    );
  }

  private trackPage(projectId: string, page: Page): string {
    const tabId = this.createId();
    this.pages.set(tabId, { projectId, page });
    page.once("close", () => {
      this.pages.delete(tabId);
    });
    page.on("popup", (popup) => {
      this.trackPage(projectId, popup);
    });
    return tabId;
  }

  private createSession(options: BrowserLaunchOptions): BrowserSession {
    return {
      id: this.createId(),
      projectId: options.projectId,
      browser: options.browser,
      engine: engineForProduct(options.browser),
      sessionMode: options.sessionMode,
      startedAt: this.now().toISOString(),
    };
  }

  private createContextOptions(
    options: BrowserLaunchOptions,
  ): BrowserContextOptions {
    return options.viewport === undefined
      ? {}
      : { viewport: { ...options.viewport } };
  }

  private async connectOverCDPWithRetry(
    browserType: BrowserTypeAdapter,
    endpointUrl: string,
  ): Promise<Browser> {
    let lastError: unknown;

    for (let attempt = 0; attempt < this.cdpConnectAttempts; attempt += 1) {
      try {
        return await browserType.connectOverCDP(endpointUrl);
      } catch (error) {
        lastError = error;
        if (attempt + 1 < this.cdpConnectAttempts) {
          await this.wait(100);
        }
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error("Conexiunea CDP nu a putut fi stabilită.");
  }

  private validateLaunchOptions(options: BrowserLaunchOptions): void {
    if (options.source === "system" && options.executablePath === undefined) {
      throw new Error("Calea executabilului browserului lipsește.");
    }

    if (
      options.sessionMode === "persistent_profile" ||
      options.sessionMode === "external_chrome_debug"
    ) {
      this.requireProfilePath(options);
    }

    if (options.sessionMode === "external_chrome_debug") {
      this.requireRemoteDebuggingPort(options);
    }
  }

  private requireProfilePath(options: BrowserLaunchOptions): string {
    const profilePath = options.profilePath?.trim();

    if (!profilePath) {
      throw new Error(
        "Selectează un director de profil pentru această sesiune.",
      );
    }

    return profilePath;
  }

  private requireRemoteDebuggingPort(options: BrowserLaunchOptions): number {
    const port = options.remoteDebuggingPort;

    if (
      port === undefined ||
      !Number.isInteger(port) ||
      port < 1024 ||
      port > 65_535
    ) {
      throw new Error(
        "Portul remote debugging trebuie să fie între 1024 și 65535.",
      );
    }

    return port;
  }

  private assertProfileAvailable(profilePath: string): void {
    const lockNames = [
      "SingletonLock",
      "SingletonCookie",
      "SingletonSocket",
      "lockfile",
    ];

    if (
      lockNames.some((lockName) => this.pathExists(join(profilePath, lockName)))
    ) {
      throw new Error(
        "Profilul Chrome este deja folosit de altă instanță. Închide Chrome sau alege alt director.",
      );
    }
  }

  private normalizeLaunchError(error: unknown): Error {
    const normalizedError =
      error instanceof Error
        ? error
        : new Error("Browserul nu a putut fi pornit.");

    if (
      /processsingleton|singletonlock|profile.*(?:in use|locked)|user data directory is already in use/i.test(
        normalizedError.message,
      )
    ) {
      return new Error(
        "Profilul Chrome este deja folosit de altă instanță. Închide Chrome sau alege alt director.",
      );
    }

    return normalizedError;
  }

  private setFailedRecoveryStatus(
    options: BrowserLaunchOptions,
    error: Error,
  ): void {
    this.setStatus({
      state: "failed",
      browser: options.browser,
      projectId: options.projectId,
      message: error.message,
      canReconnect: true,
    });
  }

  private setStatus(status: BrowserManagerStatus): void {
    this.status = status;
    for (const listener of this.listeners) {
      listener({ ...status });
    }
  }

  private requireWebUrl(value: string): string {
    let url: URL;

    try {
      url = new URL(value);
    } catch {
      throw new Error("URL-ul proiectului nu este valid.");
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(
        "URL-ul proiectului trebuie să folosească HTTP sau HTTPS.",
      );
    }

    return url.toString();
  }
}
