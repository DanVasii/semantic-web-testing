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
  BasicAuthChallenge,
  BasicAuthCredentials,
  BrowserEngine,
  BrowserLaunchOptions,
  BrowserManager,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserProduct,
  BrowserSession,
  BrowserStatusListener,
  DetectedBrowser,
} from "../../shared/browser-manager.js";
import { detectBrowsers } from "./browser-detection.js";
import {
  capturePage,
  type PageCapture,
  type PageCaptureProgressListener,
} from "../page-analysis/page-capture.js";

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

interface PendingBasicAuth {
  tabId: string;
  projectId: string;
  url: string;
  origin: string;
  page: Page;
}

export type BasicAuthCredentialsResolver = (
  projectId: string,
  origin: string,
) =>
  BasicAuthCredentials | undefined | Promise<BasicAuthCredentials | undefined>;

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
  private readonly basicAuthCredentials = new Map<
    string,
    BasicAuthCredentials
  >();
  private basicAuthResolver: BasicAuthCredentialsResolver | undefined;
  private browser: Browser | undefined;
  private context: BrowserContext | undefined;
  private runtimeKind: RuntimeKind | undefined;
  private ownerContext: BrowserContext | undefined;
  private cdpEndpoint: string | undefined;
  private session: BrowserSession | undefined;
  private lastLaunchOptions: BrowserLaunchOptions | undefined;
  private pendingBasicAuth: PendingBasicAuth | undefined;
  private appliedBasicAuthOrigin: string | undefined;
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

  public setBasicAuthResolver(resolver: BasicAuthCredentialsResolver): void {
    this.basicAuthResolver = resolver;
  }

  public setBasicAuthCredentials(
    projectId: string,
    origin: string,
    credentials: BasicAuthCredentials,
  ): void {
    this.assertValidBasicAuthCredentials(credentials);
    this.basicAuthCredentials.set(this.basicAuthKey(projectId, origin), {
      ...credentials,
    });
  }

  public async clearBasicAuthCredentialsForProject(
    projectId: string,
  ): Promise<void> {
    const prefix = `${projectId}\u0000`;
    for (const key of this.basicAuthCredentials.keys()) {
      if (key.startsWith(prefix)) this.basicAuthCredentials.delete(key);
    }
    if (this.session?.projectId === projectId) {
      this.appliedBasicAuthOrigin = undefined;
      await this.context?.setHTTPCredentials(null).catch(() => undefined);
    }
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
  ): Promise<BrowserNavigationResult> {
    const context = this.context;
    const session = this.session;

    if (context === undefined || session === undefined) {
      throw new Error("Pornește un browser înainte de a deschide proiectul.");
    }

    if (session.projectId !== projectId) {
      throw new Error("Browserul activ aparține altui proiect.");
    }

    const normalizedUrl = this.requireWebUrl(url);
    const origin = new URL(normalizedUrl).origin;
    await this.applyBasicAuthForOrigin(context, projectId, origin);
    const page = await context.newPage();
    const tabId = this.trackPage(projectId, page);
    const pending = {
      tabId,
      projectId,
      url: normalizedUrl,
      origin,
      page,
    };

    try {
      return await this.navigateWithBasicAuth(
        pending,
        this.basicAuthCredentials.has(this.basicAuthKey(projectId, origin)),
      );
    } catch (error) {
      this.pages.delete(tabId);
      await page.close().catch(() => undefined);
      throw error;
    }
  }

  public async getCurrentPageMetadata(projectId: string): Promise<{
    tabId: string;
    projectId: string;
    url: string;
    title: string;
  }> {
    const [tabId, tracked] = this.requireCurrentProjectPage(projectId);
    return {
      tabId,
      projectId,
      url: tracked.page.url(),
      title: await tracked.page.title(),
    };
  }

  public async captureCurrentPage(
    projectId: string,
    onProgress?: PageCaptureProgressListener,
  ): Promise<PageCapture> {
    const [, tracked] = this.requireCurrentProjectPage(projectId);
    return capturePage(tracked.page, onProgress);
  }

  public getRunnerPage(projectId: string): Page {
    return this.requireCurrentProjectPage(projectId)[1].page;
  }

  public getRunnerContext(projectId: string): BrowserContext {
    if (
      this.context === undefined ||
      this.session === undefined ||
      this.session.projectId !== projectId
    ) {
      throw new Error("Browserul proiectului nu este pregătit pentru rulare.");
    }
    return this.context;
  }

  public async submitBasicAuth(
    credentials: BasicAuthCredentials,
  ): Promise<BrowserNavigationResult> {
    const pending = this.pendingBasicAuth;
    const context = this.context;

    if (pending === undefined || context === undefined) {
      throw new Error("Nu există o autentificare HTTP în așteptare.");
    }

    this.assertValidBasicAuthCredentials(credentials);
    const safeCredentials = {
      username: credentials.username,
      password: credentials.password,
    };
    this.basicAuthCredentials.set(
      this.basicAuthKey(pending.projectId, pending.origin),
      safeCredentials,
    );
    await context.setHTTPCredentials(safeCredentials);
    this.appliedBasicAuthOrigin = pending.origin;
    return this.navigateWithBasicAuth(pending, true);
  }

  public async cancelBasicAuth(): Promise<void> {
    const pending = this.pendingBasicAuth;
    this.pendingBasicAuth = undefined;

    if (pending !== undefined) {
      this.pages.delete(pending.tabId);
      await pending.page.close().catch(() => undefined);
    }

    await this.context?.setHTTPCredentials(null).catch(() => undefined);
    this.appliedBasicAuthOrigin = undefined;
    this.publishRunningStatus("Autentificarea HTTP a fost anulată.");
  }

  public clearBasicAuthCredentials(): void {
    this.basicAuthCredentials.clear();
    this.pendingBasicAuth = undefined;
    this.appliedBasicAuthOrigin = undefined;
    void this.context?.setHTTPCredentials(null).catch(() => undefined);
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

    if (this.pendingBasicAuth?.projectId === projectId) {
      this.pendingBasicAuth = undefined;
      this.publishRunningStatus("Taburile proiectului au fost închise.");
    }
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
    this.pendingBasicAuth = undefined;
    this.appliedBasicAuthOrigin = undefined;
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
    const nativeWindowArguments =
      !this.headless && engine === "chromium" ? ["--start-maximized"] : [];
    const launchOptions: LaunchOptions = {
      headless: this.headless,
      ...(executablePath === undefined ? {} : { executablePath }),
      ...(nativeWindowArguments.length === 0
        ? {}
        : { args: nativeWindowArguments }),
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
          args: [
            ...nativeWindowArguments,
            `--remote-debugging-port=${remoteDebuggingPort}`,
          ],
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
    this.pendingBasicAuth = undefined;
    this.appliedBasicAuthOrigin = undefined;

    runtime.browser.once("disconnected", () => {
      if (this.browser === runtime.browser && !this.isClosing) {
        this.browser = undefined;
        this.context = undefined;
        this.runtimeKind = undefined;
        this.session = undefined;
        this.pendingBasicAuth = undefined;
        this.appliedBasicAuthOrigin = undefined;
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

  private async navigateWithBasicAuth(
    pending: PendingBasicAuth,
    credentialsWereProvided: boolean,
  ): Promise<BrowserNavigationResult> {
    try {
      const response = await pending.page.goto(pending.url, {
        waitUntil: "domcontentloaded",
      });

      if (response?.status() === 401) {
        return this.waitForBasicAuth(pending, credentialsWereProvided);
      }
    } catch (error) {
      if (this.isBasicAuthNavigationError(error)) {
        return this.waitForBasicAuth(pending, credentialsWereProvided);
      }

      throw error;
    }

    this.pendingBasicAuth = undefined;
    this.publishRunningStatus();
    return {
      state: "opened",
      tab: {
        id: pending.tabId,
        projectId: pending.projectId,
        url: pending.page.url(),
      },
    };
  }

  private async waitForBasicAuth(
    pending: PendingBasicAuth,
    invalidCredentials: boolean,
  ): Promise<BrowserNavigationResult> {
    const credentialsKey = this.basicAuthKey(pending.projectId, pending.origin);
    const attemptedCredentials = this.basicAuthCredentials.get(credentialsKey);
    if (invalidCredentials) {
      this.basicAuthCredentials.delete(credentialsKey);
      await this.context?.setHTTPCredentials(null).catch(() => undefined);
      this.appliedBasicAuthOrigin = undefined;
    }

    const challenge: BasicAuthChallenge = {
      projectId: pending.projectId,
      url: pending.url,
      origin: pending.origin,
      invalidCredentials,
      ...(attemptedCredentials === undefined
        ? {}
        : { suggestedUsername: attemptedCredentials.username }),
    };
    this.pendingBasicAuth = pending;
    this.setStatus({
      state: "waiting_for_basic_auth",
      ...(this.session === undefined
        ? {}
        : {
            browser: this.session.browser,
            projectId: this.session.projectId,
            sessionId: this.session.id,
          }),
      message: invalidCredentials
        ? "Credentialele HTTP sunt invalide."
        : "Site-ul solicită autentificare HTTP.",
      canReconnect: false,
      basicAuthChallenge: challenge,
    });
    return { state: "waiting_for_basic_auth", challenge };
  }

  private async applyBasicAuthForOrigin(
    context: BrowserContext,
    projectId: string,
    origin: string,
  ): Promise<void> {
    const credentialsKey = this.basicAuthKey(projectId, origin);
    let credentials = this.basicAuthCredentials.get(credentialsKey);
    if (credentials === undefined && this.basicAuthResolver !== undefined) {
      credentials = await this.basicAuthResolver(projectId, origin);
      if (credentials !== undefined) {
        this.assertValidBasicAuthCredentials(credentials);
        this.basicAuthCredentials.set(credentialsKey, { ...credentials });
      }
    }

    if (credentials !== undefined) {
      await context.setHTTPCredentials(credentials);
      this.appliedBasicAuthOrigin = origin;
    } else if (this.appliedBasicAuthOrigin !== undefined) {
      await context.setHTTPCredentials(null);
      this.appliedBasicAuthOrigin = undefined;
    }
  }

  private basicAuthKey(projectId: string, origin: string): string {
    return `${projectId}\u0000${origin}`;
  }

  private assertValidBasicAuthCredentials(
    credentials: BasicAuthCredentials,
  ): void {
    if (
      typeof credentials.username !== "string" ||
      typeof credentials.password !== "string" ||
      credentials.username.trim().length === 0 ||
      credentials.username.length > 512 ||
      credentials.password.length > 512
    ) {
      throw new Error("Credentialele HTTP nu sunt valide.");
    }
  }

  private isBasicAuthNavigationError(error: unknown): boolean {
    return (
      error instanceof Error &&
      /ERR_INVALID_AUTH_CREDENTIALS|ERR_MISSING_AUTH_CREDENTIALS/i.test(
        error.message,
      )
    );
  }

  private publishRunningStatus(message?: string): void {
    const session = this.session;

    if (session === undefined) {
      return;
    }

    this.setStatus({
      state: "running",
      browser: session.browser,
      projectId: session.projectId,
      sessionId: session.id,
      ...(message === undefined ? {} : { message }),
      canReconnect: false,
    });
  }

  private trackPage(projectId: string, page: Page): string {
    const tabId = this.createId();
    this.pages.set(tabId, { projectId, page });
    page.once("close", () => {
      this.pages.delete(tabId);
    });
    page.on("domcontentloaded", () => {
      this.markPageRecent(tabId);
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        this.markPageRecent(tabId);
      }
    });
    page.on("popup", (popup) => {
      this.trackPage(projectId, popup);
    });
    return tabId;
  }

  private markPageRecent(tabId: string): void {
    const tracked = this.pages.get(tabId);
    if (tracked === undefined) {
      return;
    }

    this.pages.delete(tabId);
    this.pages.set(tabId, tracked);
  }

  private requireCurrentProjectPage(projectId: string): [string, TrackedPage] {
    if (this.session === undefined || this.context === undefined) {
      throw new Error("Pornește browserul înainte de a analiza pagina.");
    }

    if (this.session.projectId !== projectId) {
      throw new Error("Browserul activ aparține altui proiect.");
    }

    const current = [...this.pages.entries()]
      .reverse()
      .find(
        ([, tracked]) =>
          tracked.projectId === projectId &&
          !tracked.page.isClosed() &&
          /^https?:\/\//i.test(tracked.page.url()),
      );

    if (current === undefined) {
      throw new Error("Nu există o pagină web deschisă pentru analiză.");
    }

    return current;
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
    if (!this.headless) return { viewport: null };
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
