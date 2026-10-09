import type { Page, Request } from "playwright-core";

import type { StepExecutionResult } from "./step-executor.js";

export interface NetworkWaitResult {
  observedRequests: number;
  settled: boolean;
}

export interface NetworkWaitOptions {
  includeAllRequests?: boolean;
  timeoutMs?: number;
  postSettleDelayMs?: number;
}

export class SmartNetworkWaiter {
  private pendingRequests = new Set<Request>();
  private active = false;
  private includeAllRequests = false;
  private observedRequests = 0;
  private resolveWait?: () => void;
  private readonly observesNetwork: boolean;

  public constructor(private readonly page: Page) {
    this.observesNetwork =
      typeof (this.page as Page & { on?: unknown }).on === "function";
    if (!this.observesNetwork) return;
    this.page.on("request", (request) => {
      if (!this.active) return;
      const type = request.resourceType();
      if (
        this.includeAllRequests ||
        type === "fetch" ||
        type === "xhr" ||
        type === "document"
      ) {
        this.pendingRequests.add(request);
        this.observedRequests += 1;
      }
    });

    const onRequestFinished = (request: Request) => {
      this.pendingRequests.delete(request);
      this.checkSettled();
    };

    this.page.on("requestfinished", onRequestFinished);
    this.page.on("requestfailed", onRequestFinished);
  }

  private checkSettled(): void {
    if (this.active && this.pendingRequests.size === 0 && this.resolveWait) {
      this.resolveWait();
    }
  }

  public async trackAndAwait(
    action: () => Promise<StepExecutionResult>,
  ): Promise<StepExecutionResult> {
    let result: StepExecutionResult | undefined;
    const wait = await this.trackActionAndAwait(async () => {
      result = await action();
    });
    if (result === undefined) {
      throw new Error("Acțiunea urmărită nu a returnat un rezultat.");
    }

    if (!wait.settled) {
      result.logs.push({
        level: "warning",
        message:
          "Așteptarea inteligentă (Smart Wait) a fost întreruptă după 5 secunde, deoarece request-urile API nu s-au finalizat. Rularea continuă.",
      });
      if (result.warnings === undefined) result.warnings = [];
      result.warnings.push({
        code: "smart_wait_timeout",
        message:
          "Request-urile API declanșate de pas au depășit timpul de așteptare de 5 secunde.",
      });
    } else if (wait.observedRequests > 0) {
      result.logs.push({
        level: "info",
        message:
          "S-a așteptat automat finalizarea request-urilor API declanșate de acțiune.",
      });
    }
    return result;
  }

  public async trackActionAndAwait(
    action: () => Promise<void>,
    options: NetworkWaitOptions = {},
  ): Promise<NetworkWaitResult> {
    const postSettleDelayMs = options.postSettleDelayMs ?? 0;
    if (!this.observesNetwork) {
      await action();
      if (postSettleDelayMs > 0) {
        await this.page.waitForTimeout(postSettleDelayMs);
      }
      return { observedRequests: 0, settled: true };
    }
    this.pendingRequests.clear();
    this.observedRequests = 0;
    this.includeAllRequests = options.includeAllRequests ?? false;
    this.active = true;
    let settled: boolean;
    const waitForPendingRequests = async (): Promise<boolean> => {
      if (this.pendingRequests.size === 0) return true;
      return new Promise<boolean>((resolve) => {
        const timeout = setTimeout(() => {
          delete this.resolveWait;
          resolve(false);
        }, options.timeoutMs ?? 5_000);
        this.resolveWait = () => {
          clearTimeout(timeout);
          resolve(true);
        };
        // Ultimul request se poate termina chiar înainte să instalăm
        // callback-ul, deci reverificăm imediat starea.
        this.checkSettled();
      });
    };
    try {
      await action();
      // Prinde și request-uri pornite asincron imediat după handlerul de click.
      await this.page.waitForTimeout(100);
      settled = await waitForPendingRequests();
      // Ținem listenerul activ și în fereastra de stabilizare. Dacă apar
      // request-uri noi, le așteptăm și cerem din nou o fereastră liniștită.
      for (
        let stableAttempt = 0;
        settled && postSettleDelayMs > 0 && stableAttempt < 3;
        stableAttempt += 1
      ) {
        const observedBeforeDelay = this.observedRequests;
        await this.page.waitForTimeout(postSettleDelayMs);
        settled = await waitForPendingRequests();
        if (settled && this.observedRequests === observedBeforeDelay) break;
      }
      if (!settled && postSettleDelayMs > 0) {
        await this.page.waitForTimeout(postSettleDelayMs);
      }
    } finally {
      this.active = false;
      this.includeAllRequests = false;
      delete this.resolveWait;
      this.pendingRequests.clear();
    }
    return { observedRequests: this.observedRequests, settled };
  }
}
