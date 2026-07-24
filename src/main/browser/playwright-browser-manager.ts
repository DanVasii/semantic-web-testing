import { randomUUID } from "node:crypto";

import {
  chromium,
  firefox,
  webkit,
  type Browser,
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

interface BrowserTypeAdapter {
  executablePath: () => string;
  launch: (options: LaunchOptions) => Promise<Browser>;
}

export interface PlaywrightBrowserManagerOptions {
  browserTypes?: Record<BrowserEngine, BrowserTypeAdapter>;
  createId?: () => string;
  headless?: boolean;
  now?: () => Date;
}

const adaptBrowserType = (browserType: BrowserType): BrowserTypeAdapter => ({
  executablePath: () => browserType.executablePath(),
  launch: async (options) => browserType.launch(options),
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

export class PlaywrightBrowserManager implements BrowserManager {
  private readonly browserTypes: Record<BrowserEngine, BrowserTypeAdapter>;
  private readonly createId: () => string;
  private readonly headless: boolean;
  private readonly now: () => Date;
  private readonly listeners = new Set<BrowserStatusListener>();
  private browser: Browser | undefined;
  private session: BrowserSession | undefined;
  private readonly pages = new Map<string, Page>();
  private status: BrowserManagerStatus = { state: "idle" };

  public constructor({
    browserTypes = {
      chromium: adaptBrowserType(chromium),
      firefox: adaptBrowserType(firefox),
      webkit: adaptBrowserType(webkit),
    },
    createId = randomUUID,
    headless = false,
    now = () => new Date(),
  }: PlaywrightBrowserManagerOptions = {}) {
    this.browserTypes = browserTypes;
    this.createId = createId;
    this.headless = headless;
    this.now = now;
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
    if (this.browser !== undefined) {
      throw new Error("Un browser este deja pornit.");
    }

    const engine = engineForProduct(options.browser);
    const browserType = this.browserTypes[engine];
    const executablePath =
      options.executablePath ??
      (options.source === "playwright"
        ? browserType.executablePath()
        : undefined);

    if (options.source === "system" && executablePath === undefined) {
      throw new Error("Calea executabilului browserului lipsește.");
    }

    this.setStatus({
      state: "starting",
      browser: options.browser,
      projectId: options.projectId,
    });

    try {
      const browser = await browserType.launch({
        headless: this.headless,
        ...(executablePath === undefined ? {} : { executablePath }),
      });
      this.browser = browser;
      const session: BrowserSession = {
        id: this.createId(),
        projectId: options.projectId,
        browser: options.browser,
        engine,
        sessionMode: options.sessionMode,
        startedAt: this.now().toISOString(),
      };
      this.session = session;

      browser.once("disconnected", () => {
        if (this.browser === browser) {
          this.browser = undefined;
          this.session = undefined;
          this.pages.clear();
          this.setStatus({
            state: "closed",
            browser: options.browser,
            projectId: options.projectId,
            sessionId: session.id,
            message: "Browserul a fost închis din exterior.",
          });
        }
      });
      this.setStatus({
        state: "running",
        browser: options.browser,
        projectId: options.projectId,
        sessionId: session.id,
      });
      return session;
    } catch (error) {
      this.setStatus({
        state: "failed",
        browser: options.browser,
        projectId: options.projectId,
        message:
          error instanceof Error
            ? error.message
            : "Browserul nu a putut fi pornit.",
      });
      throw error;
    }
  }

  public async openProjectUrl(
    projectId: string,
    url: string,
  ): Promise<BrowserTab> {
    const browser = this.browser;
    const session = this.session;

    if (browser === undefined || session === undefined) {
      throw new Error("Pornește un browser înainte de a deschide proiectul.");
    }

    if (session.projectId !== projectId) {
      throw new Error("Browserul activ aparține altui proiect.");
    }

    const normalizedUrl = this.requireWebUrl(url);
    const page = await browser.newPage();
    const tabId = this.createId();
    this.pages.set(tabId, page);
    page.once("close", () => {
      this.pages.delete(tabId);
    });

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

  public closeProjectTabs(): Promise<never> {
    return Promise.reject(
      new Error("Închiderea taburilor va fi implementată în E18."),
    );
  }

  public async close(): Promise<void> {
    const browser = this.browser;
    const session = this.session;
    this.browser = undefined;
    this.session = undefined;
    this.pages.clear();

    if (browser !== undefined) {
      await browser.close();
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
    });
  }

  public onStatusChange(listener: BrowserStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
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
