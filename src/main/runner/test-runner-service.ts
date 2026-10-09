import type { BrowserContext, CDPSession, Page } from "playwright-core";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  AiProviderId,
  AiVisualCheckInput,
  AiVisualCheckResult,
  AiVisualActionInput,
  AiVisualActionResult,
  AiTokenUsage,
} from "../../shared/ai.js";
import type { ImapMatchedMessage } from "../../shared/imap.js";
import type {
  BrowserLaunchOptions,
  BrowserManagerStatus,
  BrowserNavigationResult,
  BrowserSession,
  DetectedBrowser,
} from "../../shared/browser-manager.js";
import type {
  JsonValue,
  Project,
  StepRunResult,
  TestDataset,
  TestDefinition,
  TestRun,
} from "../../shared/persistence.js";
import type {
  MySqlCleanupPreview,
  MySqlCleanupRowSelection,
  MySqlRunDetails,
  MySqlRunDiff,
  MySqlRunSnapshot,
} from "../../shared/mysql.js";
import {
  MANUAL_WIPE_RESOURCES,
  RUN_MODES,
  RunnerError,
  type ManualWipeResource,
  type ImapRunDetails,
  type MissingDataDetails,
  type RunnerErrorDetails,
  type RunMode,
  type RunnerSnapshot,
  type StartRunInput,
  type VisualCheckDebug,
  type VisualStepContextCapture,
  type WipeDetails,
} from "../../shared/runner.js";
import { normalizeTestPostRunChecks } from "../../shared/post-run-checks.js";
import type {
  PostRunAiEvaluation,
  PostRunAiEvaluationInput,
} from "../../shared/post-run-checks.js";
import {
  assertShortcutAvailable,
  withContinueShortcut,
} from "../../shared/shortcuts.js";
import { toDeclarativeTestDefinition } from "../../shared/test-editor.js";
import type {
  ActionStep,
  CheckStep,
  LocatorDefinition,
  LocatorFallback,
  TestFlowItem,
} from "../../shared/test-model.js";
import {
  stagesForTest,
  type ExternalCheckStep,
  type TestStage,
  type VariableOutputDefinition,
} from "../../shared/test-stages.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import { applyAiRunPlan } from "../ai/ai-run-planning-service.js";
import {
  DatasetRepository,
  PageRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../persistence/repositories.js";
import { materializeDataset } from "./dataset-values.js";
import { inspectMissingInput, readManualInputValue } from "./missing-data.js";
import { classifyRunnerError } from "./runner-errors.js";
import {
  executeFlowItem,
  StepExecutionError,
  type StepExecutionResult,
} from "./step-executor.js";
import { wipeBrowserStateForOrigin, WipeError } from "./wipe-browser-state.js";
import { promoteSuccessfulFallback } from "./locator-auto-repair.js";
import { resolveUniqueLocator } from "./locator-resolver.js";
import { SmartNetworkWaiter } from "./smart-network-waiter.js";
import {
  SessionVariableContext,
  SessionVariableError,
  validateHttpUrl,
} from "./session-variable-context.js";
import {
  extractMysqlVariables,
  VariableExtractionError,
} from "./mysql-variable-extractor.js";
import { extractImapVariables } from "./imap-variable-extractor.js";
import type { RunArtifactRepository } from "../persistence/suite-repositories.js";

export interface RunnerBrowserGateway {
  detectAvailableBrowsers: () => Promise<DetectedBrowser[]>;
  getStatus: () => BrowserManagerStatus;
  launch: (options: BrowserLaunchOptions) => Promise<BrowserSession>;
  openProjectUrl: (
    projectId: string,
    url: string,
  ) => Promise<BrowserNavigationResult>;
  getRunnerPage: (projectId: string) => Page;
  getRunnerContext: (projectId: string) => BrowserContext;
}

export interface TestRunnerServiceOptions {
  createId: () => string;
  now: () => Date;
  random?: () => number;
  mysql?: RunnerMySqlGateway;
  imap?: RunnerImapGateway;
  postRunAi?: RunnerPostRunAiGateway;
  visualCheck?: RunnerVisualCheckGateway;
  aiPricing?: RunnerAiPricingGateway;
  artifactRoot?: string;
  artifacts?: RunArtifactRepository;
}

export interface RunnerMySqlGateway {
  captureBaseline: (
    projectId: string,
    runId: string,
    steps: Extract<TestFlowItem, { type: "check" }>[],
    baselineKey?: string,
  ) => Promise<MySqlRunSnapshot | undefined>;
  check: (
    projectId: string,
    runId: string,
    step: Extract<TestFlowItem, { type: "check" }>,
    baselineKey?: string,
  ) => Promise<MySqlRunDiff>;
  getRunDetails: (runId: string) => MySqlRunDetails;
  getSnapshot?: (snapshotId: string) => MySqlRunSnapshot | undefined;
  previewCleanup: (
    runId: string,
    diffId: string,
    selections: MySqlCleanupRowSelection[],
  ) => MySqlCleanupPreview;
  confirmCleanup: (
    projectId: string,
    runId: string,
    previewId: string,
  ) => Promise<unknown>;
}

export interface RunnerImapGateway {
  check: (
    projectId: string,
    runId: string,
    step: CheckStep,
    testStartedAt: string,
  ) => Promise<{ matched: boolean; message: string; evidence?: JsonValue }>;
}

export interface RunnerPostRunAiGateway {
  evaluate: (input: PostRunAiEvaluationInput) => Promise<PostRunAiEvaluation>;
}

export interface RunnerVisualCheckGateway {
  evaluate: (input: AiVisualCheckInput) => Promise<AiVisualCheckResult>;
  decide?: (input: AiVisualActionInput) => Promise<AiVisualActionResult>;
  selectGooglePayCard?: (
    input: GooglePayCardSelectionInput,
  ) => Promise<GooglePayCardSelectionResult>;
}

export interface GooglePayCardSelectionInput {
  description: string;
  scenarioCodes: string[];
  aiProvider?: Exclude<AiProviderId, "none">;
  aiModel?: string;
}

export interface GooglePayCardSelectionResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  scenarioCode: string | null;
  reason: string;
  usage: AiTokenUsage;
}

export interface RunnerAiPricingGateway {
  estimateCachedCost: (
    provider: Exclude<AiProviderId, "none">,
    model: string,
    usage: { inputTokens: number; outputTokens: number },
  ) => number | undefined;
}

interface AiUsageContext {
  reason: string;
  payload: JsonValue;
  response: JsonValue;
}

const isGooglePayClick = (item: TestFlowItem): item is ActionStep =>
  item.type === "action" &&
  item.actionType === "click" &&
  /google\s*pay|\bgpay\b/i.test(
    JSON.stringify({
      title: item.title,
      humanDescription: item.humanDescription,
      target: item.target,
    }),
  );

const diagnosticError = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const truncateDiagnostic = (value: string, maxLength = 700): string =>
  value.length <= maxLength ? value : `${value.slice(0, maxLength)}…`;

const isPaymentRelatedTarget = (value: {
  type?: string;
  title?: string;
  url?: string;
}): boolean =>
  /google\s*pay|googlepay|\bgpay\b|pay\.google\.com|stripecdn\.com|stripe\.com/i.test(
    `${value.type ?? ""} ${value.title ?? ""} ${value.url ?? ""}`,
  );

interface GooglePayCdpTargetSnapshot {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  openerId?: string;
  browserContextId?: string;
}

interface GooglePayCdpDebugSession {
  cdp: CDPSession;
  startedAt: number;
  framesBeforeClick: number;
  pagesBeforeClick: number;
  baselineTargets: Map<string, GooglePayCdpTargetSnapshot>;
  createdTargetIds: Set<string>;
  destroyedTargetIds: Set<string>;
  lastChangedState: Map<string, string>;
}

const toGooglePayTargetSnapshot = (targetInfo: {
  targetId: string;
  type: string;
  title: string;
  url: string;
  attached: boolean;
  openerId?: string;
  browserContextId?: string;
}): GooglePayCdpTargetSnapshot => ({
  targetId: targetInfo.targetId,
  type: targetInfo.type,
  title: targetInfo.title,
  url: targetInfo.url,
  attached: targetInfo.attached,
  ...(targetInfo.openerId === undefined
    ? {}
    : { openerId: targetInfo.openerId }),
  ...(targetInfo.browserContextId === undefined
    ? {}
    : { browserContextId: targetInfo.browserContextId }),
});

const targetForConsole = (target: GooglePayCdpTargetSnapshot) => ({
  targetId: target.targetId,
  type: target.type,
  title: truncateDiagnostic(target.title, 160),
  url: truncateDiagnostic(target.url, 700),
  attached: target.attached,
  openerId: target.openerId ?? "",
});

const isGooglePaySheetTarget = (target: GooglePayCdpTargetSnapshot): boolean =>
  target.type === "page" &&
  /https:\/\/pay\.google\.com\/gp\/p\/ui\/pay(?:[?#]|$)/i.test(target.url) &&
  !/\/payframe(?:[?#]|$)/i.test(target.url);

let googlePayCdpCommandId = 1;

const sendGooglePayTargetCommand = async <TResult>(
  cdp: CDPSession,
  sessionId: string,
  method: string,
  params: Record<string, unknown> = {},
): Promise<TResult> => {
  const id = googlePayCdpCommandId;
  googlePayCdpCommandId += 1;

  return await new Promise<TResult>((resolve, reject) => {
    let settled = false;

    const cleanup = (): void => {
      clearTimeout(timeout);
      cdp.off("Target.receivedMessageFromTarget", onMessage);
    };

    const finishResolve = (value: TResult): void => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };

    const finishReject = (error: unknown): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const onMessage = (event: {
      sessionId: string;
      message: string;
      targetId?: string;
    }): void => {
      if (event.sessionId !== sessionId) return;

      try {
        const payload = JSON.parse(event.message) as {
          id?: number;
          result?: TResult;
          error?: { code?: number; message?: string; data?: unknown };
        };

        if (payload.id !== id) return;

        if (payload.error !== undefined) {
          finishReject(
            new Error(
              `CDP ${method} failed (${payload.error.code ?? "unknown"}): ${
                payload.error.message ?? "unknown error"
              }`,
            ),
          );
          return;
        }

        finishResolve(payload.result as TResult);
      } catch (error) {
        finishReject(error);
      }
    };

    const timeout = setTimeout(() => {
      finishReject(
        new Error(`Timeout waiting for CDP response to ${method} (${id}).`),
      );
    }, 4_000);

    cdp.on("Target.receivedMessageFromTarget", onMessage);

    void cdp
      .send("Target.sendMessageToTarget", {
        sessionId,
        message: JSON.stringify({
          id,
          method,
          params,
        }),
      })
      .catch(finishReject);
  });
};

interface GooglePayRuntimeEvaluationResult {
  result: {
    type: string;
    subtype?: string;
    className?: string;
    description?: string;
    value?: unknown;
  };
  exceptionDetails?: {
    text?: string;
    lineNumber?: number;
    columnNumber?: number;
    exception?: {
      description?: string;
    };
  };
}

interface GooglePayFrameTreeNode {
  frame: {
    id: string;
    parentId?: string;
    loaderId?: string;
    name?: string;
    url: string;
    domainAndRegistry?: string;
    securityOrigin?: string;
    mimeType?: string;
  };
  childFrames?: GooglePayFrameTreeNode[];
}

interface GooglePayFrameTreeResult {
  frameTree: GooglePayFrameTreeNode;
}

interface GooglePayCreateIsolatedWorldResult {
  executionContextId: number;
}

interface GooglePayCaptureScreenshotResult {
  data: string;
}

interface GooglePayFlowOptions {
  cardDescription?: string;
  selectCard?: RunnerVisualCheckGateway["selectGooglePayCard"];
  verifyOutcome?: RunnerVisualCheckGateway["evaluate"];
  aiProvider?: Exclude<AiProviderId, "none">;
  aiModel?: string;
  onSelection?: (
    input: GooglePayCardSelectionInput,
    result: GooglePayCardSelectionResult,
  ) => void;
  onVerification?: (
    input: AiVisualCheckInput,
    result: AiVisualCheckResult,
    context: {
      attempt: number;
      surface: "google_pay" | "merchant";
      visualCheckDebug: VisualCheckDebug;
    },
  ) => void;
}

const findGooglePayBuyflowFrame = (
  node: GooglePayFrameTreeNode,
): GooglePayFrameTreeNode["frame"] | undefined => {
  if (
    /https:\/\/payments\.google\.com\/gp\/w\/u\/\d+\/buyflow2(?:[?#]|$)/i.test(
      node.frame.url,
    )
  ) {
    return node.frame;
  }

  for (const child of node.childFrames ?? []) {
    const found = findGooglePayBuyflowFrame(child);
    if (found !== undefined) return found;
  }

  return undefined;
};

const inspectGooglePaySheetTarget = async (
  merchantPage: Page,
  debug: GooglePayCdpDebugSession,
  target: GooglePayCdpTargetSnapshot,
  flow: GooglePayFlowOptions = {},
): Promise<JsonValue> => {
  let sessionId: string | undefined;
  let lastVisualCheckDebug: VisualCheckDebug | undefined;

  try {
    console.info("[GPay][CDP][sheet] ATTACHING TO GOOGLE PAY TARGET", {
      ...targetForConsole(target),
    });

    const attached = await debug.cdp.send("Target.attachToTarget", {
      targetId: target.targetId,
      flatten: false,
    });
    sessionId = attached.sessionId;

    console.info("[GPay][CDP][sheet] ATTACHED", {
      targetId: target.targetId,
      sessionId,
    });

    await sendGooglePayTargetCommand(debug.cdp, sessionId, "Runtime.enable");
    await sendGooglePayTargetCommand(debug.cdp, sessionId, "Page.enable");

    let buyflowFrame: GooglePayFrameTreeNode["frame"] | undefined;
    for (let attempt = 1; attempt <= 40; attempt += 1) {
      const frameTree =
        await sendGooglePayTargetCommand<GooglePayFrameTreeResult>(
          debug.cdp,
          sessionId,
          "Page.getFrameTree",
        );
      buyflowFrame = findGooglePayBuyflowFrame(frameTree.frameTree);
      if (buyflowFrame !== undefined) {
        console.info("[GPay][CDP][buyflow] BUYFLOW2 FRAME READY", {
          pollAttempt: attempt,
          waitedMs: (attempt - 1) * 250,
        });
        break;
      }
      if (attempt < 40) {
        await new Promise<void>((resolve) => setTimeout(resolve, 250));
      }
    }

    const topLevelEvaluation =
      await sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        sessionId,
        "Runtime.evaluate",
        {
          expression: String.raw`
            (() => {
              const clean = (value, max = 1000) => {
                const text = String(value ?? "").trim();
                return text.length <= max
                  ? text
                  : text.slice(0, max) + "…";
              };

              const rectOf = (element) => {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              };

              const buyflowIframe = Array.from(document.querySelectorAll("iframe"))
                .find((frame) => /payments\.google\.com\/gp\/w\/u\/\d+\/buyflow2/i.test(frame.src || ""));

              return {
                title: document.title,
                url: location.href,
                origin: location.origin,
                readyState: document.readyState,
                bodyText: clean(document.body?.innerText ?? "", 3000),
                buyflowIframe: buyflowIframe
                  ? {
                      src: buyflowIframe.src,
                      title: buyflowIframe.getAttribute("title"),
                      name: buyflowIframe.getAttribute("name"),
                      rect: rectOf(buyflowIframe),
                    }
                  : null,
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );

    if (topLevelEvaluation.exceptionDetails !== undefined) {
      throw new Error(
        topLevelEvaluation.exceptionDetails.exception?.description ??
          topLevelEvaluation.exceptionDetails.text ??
          "Runtime.evaluate returned an exception for Google Pay shell.",
      );
    }

    const topLevelInspection = topLevelEvaluation.result.value as
      Record<string, unknown> | undefined;

    console.info("[GPay][CDP][sheet] SHELL INSPECTION");
    console.dir(topLevelInspection, {
      depth: null,
      maxArrayLength: 50,
      maxStringLength: 4_000,
    });

    if (buyflowFrame === undefined) {
      console.warn(
        "[GPay][CDP][buyflow] ❌ iframe-ul buyflow2 nu a fost găsit în Page.getFrameTree.",
      );

      return {
        targetId: target.targetId,
        attached: true,
        readable: true,
        buyflowFound: false,
        paymentMethodListOpened: false,
        automaticFlowConfigured: flow.cardDescription !== undefined,
        payNowClicked: false,
        error:
          "iframe-ul intern buyflow2 nu s-a încărcat în maximum 10 secunde.",
        shellInspection: (topLevelInspection as JsonValue | undefined) ?? null,
      };
    }

    console.info("[GPay][CDP][buyflow] ✅ BUYFLOW2 FRAME FOUND", {
      frameId: buyflowFrame.id,
      name: buyflowFrame.name ?? "",
      url: truncateDiagnostic(buyflowFrame.url, 1_200),
      securityOrigin: buyflowFrame.securityOrigin ?? "",
    });

    const isolatedWorld =
      await sendGooglePayTargetCommand<GooglePayCreateIsolatedWorldResult>(
        debug.cdp,
        sessionId,
        "Page.createIsolatedWorld",
        {
          frameId: buyflowFrame.id,
          worldName: "devtester-google-pay-debug",
          grantUniveralAccess: false,
        },
      );

    console.info("[GPay][CDP][buyflow] EXECUTION CONTEXT READY", {
      frameId: buyflowFrame.id,
      executionContextId: isolatedWorld.executionContextId,
    });

    // 1) Găsim metoda de plată curentă strict după o terminație de card de forma
    //    "••" + 4 cifre. Nu folosim id-uri/clase/data-* generate dinamic.
    const currentMethodSessionId = sessionId;
    const inspectCurrentMethod = async () =>
      sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        currentMethodSessionId,
        "Runtime.evaluate",
        {
          contextId: isolatedWorld.executionContextId,
          expression: String.raw`
            (() => {
              const normalize = (value) =>
                String(value ?? "")
                  .normalize("NFKD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/\s+/g, " ")
                  .trim();

              const rectOf = (element) => {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              };

              const extractLast4 = (text) => {
                const raw = String(text ?? "");
                const compact = raw.replace(/\s+/g, "");

                // Google Pay afișează de obicei Visa••4242 / Mastercard••4444.
                const bulletMatch = compact.match(/[•●∙·]{1,4}(\d{4})/u);
                if (bulletMatch) return bulletMatch[1];

                // Fallback pentru textul accesibil localizat:
                // "Visa care se termină în 4 2 4 2".
                const accessibleMatch = normalize(raw).match(
                  /(?:ending in|ends in|se termina in)\s*(\d)\s*(\d)\s*(\d)\s*(\d)/i,
                );
                return accessibleMatch
                  ? accessibleMatch.slice(1, 5).join("")
                  : null;
              };

              const candidates = Array.from(document.querySelectorAll('[role="button"]'))
                .map((element, index) => {
                  const text = normalize(element.textContent);
                  const rect = rectOf(element);
                  const last4 = extractLast4(text);
                  return {
                    index,
                    element,
                    text,
                    last4,
                    rect,
                    visible: rect.width > 0 && rect.height > 0,
                    ariaHasPopup: element.getAttribute("aria-haspopup"),
                    ariaExpanded: element.getAttribute("aria-expanded"),
                    dataIsSelected: element.getAttribute("data-is-selected"),
                  };
                })
                .filter((candidate) => candidate.visible && candidate.last4 !== null);

              // Pe sheet-ul principal ar trebui să existe un singur card vizibil cu ••dddd.
              // Dacă sunt mai multe, preferăm unul care deschide un listbox.
              const current =
                candidates.find((candidate) => candidate.ariaHasPopup === "listbox") ??
                candidates[0] ??
                null;

              return {
                found: current !== null,
                candidateCount: candidates.length,
                candidates: candidates.slice(0, 10).map(({ element, ...candidate }) => candidate),
                text: current?.text ?? "",
                last4: current?.last4 ?? null,
                selected: current?.dataIsSelected ?? null,
                ariaExpanded: current?.ariaExpanded ?? null,
                ariaHasPopup: current?.ariaHasPopup ?? null,
                rect: current?.rect ?? null,
                outerHTML: current?.element.outerHTML.slice(0, 2000) ?? null,
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );

    let currentMethodEvaluation = await inspectCurrentMethod();

    if (currentMethodEvaluation.exceptionDetails !== undefined) {
      throw new Error(
        currentMethodEvaluation.exceptionDetails.exception?.description ??
          currentMethodEvaluation.exceptionDetails.text ??
          "Could not inspect current Google Pay payment method.",
      );
    }

    let currentMethod = currentMethodEvaluation.result.value as
      Record<string, unknown> | undefined;

    for (
      let attempt = 1;
      currentMethod?.found !== true && attempt < 40;
      attempt += 1
    ) {
      await new Promise<void>((resolve) => setTimeout(resolve, 250));
      currentMethodEvaluation = await inspectCurrentMethod();
      if (currentMethodEvaluation.exceptionDetails !== undefined) {
        throw new Error(
          currentMethodEvaluation.exceptionDetails.exception?.description ??
            currentMethodEvaluation.exceptionDetails.text ??
            "Could not inspect current Google Pay payment method.",
        );
      }
      currentMethod = currentMethodEvaluation.result.value as
        Record<string, unknown> | undefined;
      if (currentMethod?.found === true) {
        console.info("[GPay][CDP][cards] CURRENT CARD UI READY", {
          pollAttempt: attempt + 1,
          waitedMs: attempt * 250,
        });
      }
    }

    console.info(
      "[GPay][CDP][cards] CURRENT CARD FOUND BY ••LAST4",
      currentMethod,
    );

    const currentRect =
      currentMethod !== undefined &&
      typeof currentMethod.rect === "object" &&
      currentMethod.rect !== null &&
      !Array.isArray(currentMethod.rect)
        ? (currentMethod.rect as Record<string, unknown>)
        : undefined;

    const iframeRect =
      topLevelInspection !== undefined &&
      typeof topLevelInspection.buyflowIframe === "object" &&
      topLevelInspection.buyflowIframe !== null &&
      !Array.isArray(topLevelInspection.buyflowIframe)
        ? ((topLevelInspection.buyflowIframe as Record<string, unknown>)
            .rect as Record<string, unknown> | undefined)
        : undefined;

    if (currentMethod?.found !== true || currentRect === undefined) {
      console.warn(
        "[GPay][CDP][cards] ❌ NO VISIBLE CARD WITH •• + 4 DIGITS FOUND; payment-method list will not be opened.",
      );

      return {
        targetId: target.targetId,
        attached: true,
        readable: true,
        buyflowFound: true,
        paymentMethodListOpened: false,
        automaticFlowConfigured: flow.cardDescription !== undefined,
        payNowClicked: false,
        error:
          "Metoda de plată curentă nu a devenit vizibilă în maximum 10 secunde.",
        currentMethod: (currentMethod as JsonValue | undefined) ?? null,
      };
    }

    const currentX = Number(currentRect.x ?? 0);
    const currentY = Number(currentRect.y ?? 0);
    const currentWidth = Number(currentRect.width ?? 0);
    const currentHeight = Number(currentRect.height ?? 0);
    const iframeX = Number(iframeRect?.x ?? 0);
    const iframeY = Number(iframeRect?.y ?? 0);

    if (
      !Number.isFinite(currentX) ||
      !Number.isFinite(currentY) ||
      !Number.isFinite(currentWidth) ||
      !Number.isFinite(currentHeight) ||
      currentWidth <= 0 ||
      currentHeight <= 0
    ) {
      console.warn("[GPay][CDP][cards] ❌ Current card rect invalid.", {
        currentRect,
      });

      return {
        targetId: target.targetId,
        attached: true,
        readable: true,
        buyflowFound: true,
        paymentMethodListOpened: false,
        automaticFlowConfigured: flow.cardDescription !== undefined,
        payNowClicked: false,
        error: "Metoda de plată curentă are o geometrie DOM invalidă.",
        currentMethod: (currentMethod as JsonValue | undefined) ?? null,
      };
    }

    // 2) Click real pe cardul curent identificat prin ••dddd.
    const openListX = iframeX + currentX + currentWidth / 2;
    const openListY = iframeY + currentY + currentHeight / 2;

    console.info("[GPay][CDP][cards] CLICKING CARD WITH ••LAST4", {
      text: currentMethod.text ?? "",
      last4: currentMethod.last4 ?? null,
      clickX: openListX,
      clickY: openListY,
    });

    await sendGooglePayTargetCommand(
      debug.cdp,
      sessionId,
      "Input.dispatchMouseEvent",
      {
        type: "mouseMoved",
        x: openListX,
        y: openListY,
        button: "none",
        buttons: 0,
      },
    );

    await sendGooglePayTargetCommand(
      debug.cdp,
      sessionId,
      "Input.dispatchMouseEvent",
      {
        type: "mousePressed",
        x: openListX,
        y: openListY,
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
    );

    await sendGooglePayTargetCommand(
      debug.cdp,
      sessionId,
      "Input.dispatchMouseEvent",
      {
        type: "mouseReleased",
        x: openListX,
        y: openListY,
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    );

    console.info(
      "[GPay][CDP][cards] ✅ CARD CLICK DISPATCHED; waiting for payment-method list...",
    );

    await new Promise<void>((resolve) => {
      setTimeout(resolve, 1_000);
    });

    // 3) Lista este deschisă. Inventariem semantic cardurile și scenariile
    //    Stripe; alegerea efectivă va fi făcută de AI din captura vizibilă.
    const cardListEvaluation =
      await sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        sessionId,
        "Runtime.evaluate",
        {
          contextId: isolatedWorld.executionContextId,
          expression: String.raw`
            (() => {
              const normalize = (value) =>
                String(value ?? "")
                  .normalize("NFKD")
                  .replace(/[\u0300-\u036f]/g, "")
                  .replace(/\s+/g, " ")
                  .trim();

              const normalizeSearch = (value) =>
                normalize(value)
                  .toLowerCase()
                  .replace(/[^a-z0-9_]+/g, " ")
                  .replace(/\s+/g, " ")
                  .trim();

              const rectOf = (element) => {
                const rect = element.getBoundingClientRect();
                return {
                  x: Math.round(rect.x),
                  y: Math.round(rect.y),
                  width: Math.round(rect.width),
                  height: Math.round(rect.height),
                };
              };

              const extractLast4 = (text) => {
                const raw = String(text ?? "");
                const compact = raw.replace(/\s+/g, "");
                const bulletMatch = compact.match(/[•●∙·]{1,4}(\d{4})/u);
                if (bulletMatch) return bulletMatch[1];

                const accessibleMatch = normalize(raw).match(
                  /(?:ending in|ends in|se termina in)\s*(\d)\s*(\d)\s*(\d)\s*(\d)/i,
                );
                return accessibleMatch
                  ? accessibleMatch.slice(1, 5).join("")
                  : null;
              };

              // Luăm doar textul direct al elementului, fără textul concatenat din copii.
              // Asta ne permite să găsim valorile Stripe de forma incorrect_cvc,
              // expired_card, generic_decline, etc. indiferent de ID/class generate.
              const ownText = (element) =>
                Array.from(element.childNodes)
                  .filter((node) => node.nodeType === Node.TEXT_NODE)
                  .map((node) => node.textContent ?? "")
                  .join(" ")
                  .replace(/\s+/g, " ")
                  .trim();

              const snakeCasePattern = /^[a-z][a-z0-9]*(?:_[a-z0-9]+)+$/i;
              const allElements = Array.from(document.querySelectorAll("body *"));

              const tokenElements = allElements
                .map((element, domIndex) => ({
                  element,
                  domIndex,
                  token: ownText(element),
                }))
                .filter(({ token }) => snakeCasePattern.test(token));

              const allSnakeCaseIds = Array.from(
                new Set(tokenElements.map(({ token }) => token.toLowerCase())),
              );

              // Separat, încercăm să izolăm scenariile Stripe de eroare / autentificare.
              // allSnakeCaseIds rămâne lista brută completă și este cea mai utilă
              // pentru debugging atunci când Google schimbă denumirile.
              const scenarioKeywordPattern =
                /(cvc|cvv|declin|expired|expire|fund|insufficient|lost|stolen|processing|incorrect|invalid|fail|fraud|risk|3ds|secure|auth|not_received|dispute|charge|card_error|honor|velocity|limit|restricted|pickup|reenter|try_again|issuer|unsupported|currency|duplicate|revocation|pin|withdrawal)/i;

              const likelyScenarioIds = allSnakeCaseIds.filter((token) =>
                scenarioKeywordPattern.test(token),
              );

              // Construim și rândurile asociate fiecărui token. Dacă tokenul se află
              // în cardul Stripe, closest([role=button]) ne dă elementul pe care îl
              // putem apăsa, fără să depindem de id-uri dinamice.
              const scenarioRowsRaw = tokenElements.map(({ element, token, domIndex }) => {
                const clickable = element.closest('[role="button"]');
                const row = clickable ?? element.parentElement ?? element;
                const rect = rectOf(row);
                const rowText = normalize(row.textContent);
                const last4 = extractLast4(rowText);
                const normalizedToken = token.toLowerCase();

                let score = 0;
                if (last4 !== null) score += 50;
                if (rect.width > 0 && rect.height > 0) score += 20;

                return {
                  domIndex,
                  token: normalizedToken,
                  text: rowText,
                  searchable: normalizeSearch(rowText),
                  last4,
                  selected:
                    clickable?.getAttribute("data-is-selected") === "true",
                  disabled:
                    clickable?.getAttribute("aria-disabled") === "true" ||
                    clickable?.hasAttribute("disabled") === true,
                  hasRoleButton: clickable !== null,
                  rect,
                  visible: rect.width > 0 && rect.height > 0,
                  score,
                  outerHTML: row.outerHTML.slice(0, 1600),
                };
              });

              // Deduplicăm după token + text, pentru că DOM-ul Google poate conține
              // clone/elemente auxiliare ale aceluiași rând.
              const seenScenarioRows = new Set();
              const scenarioRows = scenarioRowsRaw.filter((row) => {
                const key = row.token + "|" + row.text;
                if (seenScenarioRows.has(key)) return false;
                seenScenarioRows.add(key);
                return true;
              });

              const cardRows = Array.from(document.querySelectorAll('[role="button"]'))
                .map((element, index) => {
                  const rect = rectOf(element);
                  const text = normalize(element.textContent);
                  const last4 = extractLast4(text);
                  return {
                    index,
                    text,
                    last4,
                    selected: element.getAttribute("data-is-selected") === "true",
                    disabled:
                      element.getAttribute("aria-disabled") === "true" ||
                      element.hasAttribute("disabled"),
                    rect,
                    visible: rect.width > 0 && rect.height > 0,
                  };
                })
                .filter((row) => row.last4 !== null);

              const cardLabels = cardRows.map((row) => ({
                text: row.text,
                last4: row.last4,
                selected: row.selected,
                visible: row.visible,
              }));

              const ranked = [...scenarioRows]
                .filter((row) => scenarioKeywordPattern.test(row.token))
                .sort((a, b) => b.score - a.score || a.domIndex - b.domIndex)
                .slice(0, 20);

              const bodyText = normalize(document.body?.innerText ?? "");

              return {
                title: document.title,
                url: location.href,
                bodyTextPreview: bodyText.slice(0, 4000),
                // Array-ul brut cerut pentru debugging:
                allSnakeCaseIds,
                // Array mai curat doar cu scenarii/statusuri probabile Stripe:
                likelyScenarioIds,
                // Etichetele cardurilor pe care le putem citi din listă:
                cardLabels,
                scenarioRows,
                listLooksOpen:
                  allSnakeCaseIds.length > 1 ||
                  cardRows.length > 1 ||
                  scenarioRows.length > 1,
                cardCount: cardRows.length,
                visibleCardCount: cardRows.filter((row) => row.visible).length,
                statusCount: allSnakeCaseIds.length,
                likelyScenarioCount: likelyScenarioIds.length,
                bestCandidates: ranked,
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );

    if (cardListEvaluation.exceptionDetails !== undefined) {
      throw new Error(
        cardListEvaluation.exceptionDetails.exception?.description ??
          cardListEvaluation.exceptionDetails.text ??
          "Could not inspect Google Pay payment-method list.",
      );
    }

    const cardSearch = cardListEvaluation.result.value as
      Record<string, unknown> | undefined;

    console.info("[GPay][CDP][cards] PAYMENT METHOD LIST INSPECTION");
    console.dir(cardSearch, {
      depth: null,
      maxArrayLength: 30,
      maxStringLength: 5_000,
    });

    console.info("[GPay][CDP][cards] ALL SNAKE_CASE IDS");
    console.dir(cardSearch?.allSnakeCaseIds, {
      depth: null,
      maxArrayLength: 500,
      maxStringLength: 20_000,
    });

    console.info("[GPay][CDP][cards] LIKELY STRIPE SCENARIO IDS");
    console.dir(cardSearch?.likelyScenarioIds, {
      depth: null,
      maxArrayLength: 500,
      maxStringLength: 20_000,
    });

    console.info("[GPay][CDP][cards] CARD LABELS");
    console.dir(cardSearch?.cardLabels, {
      depth: null,
      maxArrayLength: 500,
      maxStringLength: 20_000,
    });

    const cardCount =
      typeof cardSearch?.cardCount === "number" ? cardSearch.cardCount : 0;
    const cardDescription = flow.cardDescription?.trim();
    if (cardDescription === undefined || cardDescription.length === 0) {
      return {
        targetId: target.targetId,
        attached: true,
        readable: true,
        buyflowFound: true,
        paymentMethodListOpened: cardSearch?.listLooksOpen === true,
        cardCount,
        automaticFlowConfigured: false,
        currentMethod: (currentMethod as JsonValue | undefined) ?? null,
        cardSearch: (cardSearch as JsonValue | undefined) ?? null,
      };
    }
    if (flow.selectCard === undefined) {
      throw new Error(
        "Flow-ul Google Pay are o descriere de card, dar selectorul AI nu este configurat.",
      );
    }

    let decodedTargetUrl = target.url;
    try {
      decodedTargetUrl = decodeURIComponent(target.url);
    } catch {
      // URL-ul brut rămâne suficient pentru verificările de siguranță de mai jos.
    }
    const safetyText = `${
      typeof topLevelInspection?.bodyText === "string"
        ? topLevelInspection.bodyText
        : ""
    } ${
      typeof cardSearch?.bodyTextPreview === "string"
        ? cardSearch.bodyTextPreview
        : ""
    } ${target.url} ${decodedTargetUrl}`;
    const testEnvironment =
      /mediu de testare|test environment|will not be (?:charged|debited)|nu va fi debitat|test sandbox|"merchantName"\s*:\s*"Test/i.test(
        safetyText,
      );
    if (!testEnvironment) {
      throw new Error(
        "Flow-ul automat Google Pay s-a oprit: sheet-ul nu indică explicit un mediu TEST.",
      );
    }

    const scenarioRows: unknown[] = Array.isArray(cardSearch?.scenarioRows)
      ? (cardSearch.scenarioRows as unknown[])
      : [];
    const cardLabels: unknown[] = Array.isArray(cardSearch?.cardLabels)
      ? (cardSearch.cardLabels as unknown[])
      : [];
    const candidateSources: Array<{
      scenarioCode: string;
      label: string;
      ending: string;
      disabled: boolean;
    }> = [];
    const seenCandidates = new Set<string>();
    for (const value of [...scenarioRows, ...cardLabels]) {
      if (typeof value !== "object" || value === null || Array.isArray(value))
        continue;
      const row = value as Record<string, unknown>;
      const ending = typeof row.last4 === "string" ? row.last4 : "";
      const label = typeof row.text === "string" ? row.text.trim() : "";
      const scenarioCode =
        typeof row.token === "string" ? row.token.trim().toLowerCase() : "";
      if (ending.length !== 4 || label.length === 0) continue;
      const key = `${ending}|${label}`;
      if (seenCandidates.has(key)) continue;
      seenCandidates.add(key);
      candidateSources.push({
        scenarioCode,
        label,
        ending,
        disabled: row.disabled === true,
      });
    }
    if (candidateSources.length === 0) {
      throw new Error(
        "Lista Google Pay a fost deschisă, dar nu conține carduri identificabile în DOM.",
      );
    }

    const likelyScenarioCodes = new Set(
      (Array.isArray(cardSearch?.likelyScenarioIds)
        ? (cardSearch.likelyScenarioIds as unknown[])
        : []
      ).filter((value): value is string => typeof value === "string"),
    );
    const scenarioCandidates = candidateSources
      .filter(
        (candidate) =>
          candidate.scenarioCode.length > 0 && candidate.disabled === false,
      )
      .filter((candidate) => likelyScenarioCodes.has(candidate.scenarioCode));
    const scenarioCodes = [
      ...new Set(scenarioCandidates.map(({ scenarioCode }) => scenarioCode)),
    ];
    if (scenarioCodes.length === 0) {
      throw new Error(
        "Lista Google Pay nu conține coduri de scenarii de test identificabile.",
      );
    }
    const aiInput: GooglePayCardSelectionInput = {
      description: cardDescription,
      scenarioCodes,
      ...(flow.aiProvider === undefined ? {} : { aiProvider: flow.aiProvider }),
      ...(flow.aiModel === undefined ? {} : { aiModel: flow.aiModel }),
    };
    console.info("[GPay][AI] TEXT CARD SELECTION REQUEST", aiInput);
    const selection = await flow.selectCard(aiInput);
    flow.onSelection?.(aiInput, selection);
    const selectedScenarioCode = selection.scenarioCode?.trim().toLowerCase();
    const selectedCandidate = scenarioCandidates.find(
      ({ scenarioCode }) => scenarioCode === selectedScenarioCode,
    );
    if (selectedScenarioCode === undefined || selectedCandidate === undefined) {
      throw new Error(
        selection.scenarioCode === null
          ? `AI nu a găsit un scenariu Google Pay potrivit: ${selection.reason}`
          : `AI a returnat un cod de scenariu Google Pay care nu există în listă (${selection.scenarioCode}).`,
      );
    }

    console.info("[GPay][CDP][cards] AI TEXT SELECTION", {
      description: cardDescription,
      scenarioCode: selection.scenarioCode,
      reason: selection.reason,
      selectedCard: selectedCandidate,
    });

    const selectedCardEvaluation =
      await sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        sessionId,
        "Runtime.evaluate",
        {
          contextId: isolatedWorld.executionContextId,
          expression: String.raw`
            (async () => {
              const wanted = ${JSON.stringify(selectedCandidate)};
              const normalize = (value) => String(value ?? "")
                .normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/\s+/g, " ")
                .trim();
              const ownText = (element) => Array.from(element.childNodes)
                .filter((node) => node.nodeType === Node.TEXT_NODE)
                .map((node) => node.textContent ?? "")
                .join(" ")
                .replace(/\s+/g, " ")
                .trim()
                .toLowerCase();
              const extractLast4 = (text) => {
                const compact = String(text ?? "").replace(/\s+/g, "");
                return compact.match(/[•●∙·]{1,4}(\d{4})/u)?.[1] ?? null;
              };
              const allElements = Array.from(document.querySelectorAll("body *"));
              const tokenMatches = wanted.scenarioCode
                ? allElements.filter((element) => ownText(element) === wanted.scenarioCode)
                : [];
              const endingMatches = allElements
                .filter((element) => extractLast4(ownText(element)) === wanted.ending);
              const targetCandidates = [];
              const seenTargets = new Set();
              const addTarget = (element, strategy) => {
                if (!element || seenTargets.has(element)) return;
                seenTargets.add(element);
                targetCandidates.push({ element, strategy });
              };

              for (const tokenElement of tokenMatches) {
                const ancestors = [];
                for (let current = tokenElement; current && current !== document.body; current = current.parentElement) {
                  ancestors.push(current);
                }
                addTarget(
                  ancestors.find((element) =>
                    element.matches('button,[role="button"],[tabindex]'),
                  ),
                  "scenario-code-clickable-ancestor",
                );
                addTarget(
                  ancestors.find((element) =>
                    normalize(element.textContent) === normalize(wanted.label),
                  ),
                  "scenario-code-label-ancestor",
                );
                addTarget(tokenElement, "scenario-code-element");
              }

              const last4Candidates = allElements
                .filter((element) => {
                  const text = normalize(element.textContent);
                  return extractLast4(text) === wanted.ending;
                })
                .sort((left, right) =>
                  normalize(left.textContent).length - normalize(right.textContent).length,
                );
              for (const endingElement of last4Candidates) {
                const exactLabel =
                  normalize(endingElement.textContent) === normalize(wanted.label);
                addTarget(
                  endingElement.closest('button,[role="button"],[tabindex]'),
                  exactLabel ? "exact-label-clickable" : "last-four-clickable",
                );
                addTarget(
                  endingElement,
                  exactLabel ? "exact-label-element" : "last-four-element",
                );
              }

              if (targetCandidates.length === 0) {
                return {
                  found: false,
                  strategy: "none",
                  tokenMatchCount: tokenMatches.length,
                  endingMatchCount: endingMatches.length,
                  attemptedTargetCount: 0,
                };
              }

              const attempts = [];
              for (const candidate of targetCandidates) {
                candidate.element.scrollIntoView({ block: "center", inline: "nearest" });
                await new Promise((resolve) => setTimeout(resolve, 75));
                const rect = candidate.element.getBoundingClientRect();
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const hitElement =
                  rect.width > 0 && rect.height > 0
                    ? document.elementFromPoint(centerX, centerY)
                    : null;
                const hitMatches =
                  hitElement !== null &&
                  (candidate.element === hitElement ||
                    candidate.element.contains(hitElement) ||
                    hitElement.contains(candidate.element));
                attempts.push({
                  strategy: candidate.strategy,
                  tagName: candidate.element.tagName,
                  role: candidate.element.getAttribute("role"),
                  width: rect.width,
                  height: rect.height,
                  hitMatches,
                });
                if (rect.width <= 0 || rect.height <= 0 || !hitMatches) continue;
                document
                  .querySelectorAll('[data-devtester-gpay-target="true"]')
                  .forEach((element) =>
                    element.removeAttribute("data-devtester-gpay-target"),
                  );
                candidate.element.setAttribute(
                  "data-devtester-gpay-target",
                  "true",
                );
                return {
                  found: true,
                  strategy: candidate.strategy,
                  tokenMatchCount: tokenMatches.length,
                  endingMatchCount: endingMatches.length,
                  attemptedTargetCount: attempts.length,
                  tagName: candidate.element.tagName,
                  role: candidate.element.getAttribute("role"),
                  text: normalize(candidate.element.textContent),
                  rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
                };
              }

              return {
                found: false,
                strategy: "no-rendered-match",
                tokenMatchCount: tokenMatches.length,
                endingMatchCount: endingMatches.length,
                attemptedTargetCount: attempts.length,
                attempts,
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );
    if (selectedCardEvaluation.exceptionDetails !== undefined) {
      throw new Error(
        selectedCardEvaluation.exceptionDetails.exception?.description ??
          selectedCardEvaluation.exceptionDetails.text ??
          "Căutarea DOM a cardului Google Pay a eșuat.",
      );
    }
    const selectedCard = selectedCardEvaluation.result.value as
      Record<string, unknown> | undefined;
    console.info("[GPay][CDP][cards] DOM SELECTION LOOKUP", selectedCard);
    const selectedRect =
      selectedCard?.found === true &&
      typeof selectedCard.rect === "object" &&
      selectedCard.rect !== null &&
      !Array.isArray(selectedCard.rect)
        ? (selectedCard.rect as Record<string, unknown>)
        : undefined;
    if (selectedRect === undefined) {
      throw new Error(
        `Scenariul ales de AI (${selectedScenarioCode}, ••${selectedCandidate.ending}) nu a putut fi localizat pentru click. Diagnostic DOM: ${JSON.stringify(selectedCard ?? null)}.`,
      );
    }
    const selectX =
      iframeX + Number(selectedRect.x) + Number(selectedRect.width) / 2;
    const selectY =
      iframeY + Number(selectedRect.y) + Number(selectedRect.height) / 2;
    for (const event of [
      { type: "mouseMoved", button: "none", buttons: 0 },
      {
        type: "mousePressed",
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      {
        type: "mouseReleased",
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    ]) {
      await sendGooglePayTargetCommand(
        debug.cdp,
        sessionId,
        "Input.dispatchMouseEvent",
        { ...event, x: selectX, y: selectY },
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 700));

    const activeSessionId = sessionId;
    const inspectPayButton = async () =>
      sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        activeSessionId,
        "Runtime.evaluate",
        {
          contextId: isolatedWorld.executionContextId,
          expression: String.raw`
            (() => {
              const normalize = (value) => String(value ?? "")
                .normalize("NFKD")
                .replace(/[\u0300-\u036f]/g, "")
                .replace(/\s+/g, " ")
                .trim();
              const controls = Array.from(document.querySelectorAll('button,[role="button"]'));
              const candidates = controls.filter((element) => {
                const text = normalize(element.textContent).toLowerCase();
                const label = normalize(element.getAttribute("aria-label")).toLowerCase();
                return /^(plateste acum|pay now)$/.test(text) || /^(plateste acum|pay now)$/.test(label);
              });
              const inspected = candidates.map((element) => {
                const rect = element.getBoundingClientRect();
                const centerX = rect.x + rect.width / 2;
                const centerY = rect.y + rect.height / 2;
                const hit = rect.width > 0 && rect.height > 0
                  ? document.elementFromPoint(centerX, centerY)
                  : null;
                const hitMatches = hit !== null &&
                  (element === hit || element.contains(hit) || hit.contains(element));
                return { element, rect, hitMatches };
              });
              const selected = inspected.find(({ rect, hitMatches }) =>
                rect.width > 0 && rect.height > 0 && hitMatches,
              );
              if (!selected) {
                return {
                  found: false,
                  candidateCount: candidates.length,
                  candidates: inspected.map(({ element, rect, hitMatches }) => ({
                    tagName: element.tagName,
                    role: element.getAttribute("role"),
                    width: rect.width,
                    height: rect.height,
                    hitMatches,
                  })),
                };
              }
              document
                .querySelectorAll('[data-devtester-gpay-pay-now="true"]')
                .forEach((element) =>
                  element.removeAttribute("data-devtester-gpay-pay-now"),
                );
              selected.element.setAttribute(
                "data-devtester-gpay-pay-now",
                "true",
              );
              return {
                found: true,
                candidateCount: candidates.length,
                text: normalize(selected.element.textContent || selected.element.getAttribute("aria-label")),
                rect: {
                  x: selected.rect.x,
                  y: selected.rect.y,
                  width: selected.rect.width,
                  height: selected.rect.height,
                },
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );
    let payButtonEvaluation = await inspectPayButton();
    if (payButtonEvaluation.exceptionDetails !== undefined) {
      throw new Error(
        payButtonEvaluation.exceptionDetails.exception?.description ??
          payButtonEvaluation.exceptionDetails.text ??
          "Căutarea butonului Google Pay «Plătește acum» a eșuat.",
      );
    }
    let payButton = payButtonEvaluation.result.value as
      Record<string, unknown> | undefined;
    let payRect =
      payButton?.found === true &&
      typeof payButton.rect === "object" &&
      payButton.rect !== null &&
      !Array.isArray(payButton.rect)
        ? (payButton.rect as Record<string, unknown>)
        : undefined;

    if (payRect === undefined) {
      const directClickEvaluation =
        await sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
          debug.cdp,
          sessionId,
          "Runtime.evaluate",
          {
            contextId: isolatedWorld.executionContextId,
            expression: String.raw`
              (() => {
                const target = document.querySelector(
                  '[data-devtester-gpay-target="true"]',
                );
                if (!target) return { found: false };
                target.scrollIntoView({ block: "center", inline: "nearest" });
                if (typeof target.focus === "function") target.focus();
                if (typeof target.click === "function") target.click();
                else target.dispatchEvent(new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }));
                return {
                  found: true,
                  tagName: target.tagName,
                  role: target.getAttribute("role"),
                  text: String(target.textContent ?? "").trim().slice(0, 500),
                };
              })()
            `,
            returnByValue: true,
            awaitPromise: true,
          },
        );
      if (directClickEvaluation.exceptionDetails !== undefined) {
        throw new Error(
          directClickEvaluation.exceptionDetails.exception?.description ??
            directClickEvaluation.exceptionDetails.text ??
            "Fallback-ul DOM pentru selectarea cardului Google Pay a eșuat.",
        );
      }
      console.info(
        "[GPay][CDP][cards] DIRECT DOM CLICK FALLBACK",
        directClickEvaluation.result.value,
      );
      await new Promise<void>((resolve) => setTimeout(resolve, 700));
      payButtonEvaluation = await inspectPayButton();
      payButton = payButtonEvaluation.result.value as
        Record<string, unknown> | undefined;
      payRect =
        payButton?.found === true &&
        typeof payButton.rect === "object" &&
        payButton.rect !== null &&
        !Array.isArray(payButton.rect)
          ? (payButton.rect as Record<string, unknown>)
          : undefined;
    }
    if (payRect === undefined) {
      throw new Error(
        `Clickul pe scenariul ${selectedScenarioCode} nu a închis lista de carduri; butonul «Plătește acum» nu a fost găsit nici după fallback-ul DOM.`,
      );
    }
    const payX = iframeX + Number(payRect.x) + Number(payRect.width) / 2;
    const payY = iframeY + Number(payRect.y) + Number(payRect.height) / 2;
    for (const event of [
      { type: "mouseMoved", button: "none", buttons: 0 },
      {
        type: "mousePressed",
        button: "left",
        buttons: 1,
        clickCount: 1,
      },
      {
        type: "mouseReleased",
        button: "left",
        buttons: 0,
        clickCount: 1,
      },
    ]) {
      await sendGooglePayTargetCommand(
        debug.cdp,
        sessionId,
        "Input.dispatchMouseEvent",
        { ...event, x: payX, y: payY },
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 1_000));

    const inspectPayClickState = async (clickIfActive: boolean) =>
      sendGooglePayTargetCommand<GooglePayRuntimeEvaluationResult>(
        debug.cdp,
        activeSessionId,
        "Runtime.evaluate",
        {
          contextId: isolatedWorld.executionContextId,
          expression: String.raw`
            (() => {
              const target = document.querySelector(
                '[data-devtester-gpay-pay-now="true"]',
              );
              if (!target || !target.isConnected) {
                return { present: false, clicked: false };
              }
              const rect = target.getBoundingClientRect();
              const centerX = rect.x + rect.width / 2;
              const centerY = rect.y + rect.height / 2;
              const hit = rect.width > 0 && rect.height > 0
                ? document.elementFromPoint(centerX, centerY)
                : null;
              const hitMatches = hit !== null &&
                (target === hit || target.contains(hit) || hit.contains(target));
              const disabled =
                target.getAttribute("aria-disabled") === "true" ||
                target.getAttribute("aria-busy") === "true" ||
                target.hasAttribute("disabled") ||
                target.disabled === true;
              let clicked = false;
              if (${clickIfActive ? "true" : "false"} && !disabled && hitMatches) {
                if (typeof target.focus === "function") target.focus();
                if (typeof target.click === "function") target.click();
                else target.dispatchEvent(new MouseEvent("click", {
                  bubbles: true,
                  cancelable: true,
                  view: window,
                }));
                clicked = true;
              }
              return {
                present: true,
                disabled,
                hitMatches,
                clicked,
                tagName: target.tagName,
                role: target.getAttribute("role"),
                text: String(target.textContent ?? "").trim().slice(0, 500),
              };
            })()
          `,
          returnByValue: true,
          awaitPromise: true,
        },
      );

    let payClickState: Record<string, unknown> | undefined;
    try {
      const fallbackEvaluation = await inspectPayClickState(true);
      if (fallbackEvaluation.exceptionDetails !== undefined) {
        throw new Error(
          fallbackEvaluation.exceptionDetails.exception?.description ??
            fallbackEvaluation.exceptionDetails.text ??
            "Fallback-ul DOM pentru «Plătește acum» a eșuat.",
        );
      }
      payClickState = fallbackEvaluation.result.value as
        Record<string, unknown> | undefined;
      if (payClickState?.clicked === true) {
        console.info(
          "[GPay][CDP][pay] DIRECT DOM CLICK FALLBACK",
          payClickState,
        );
        await new Promise<void>((resolve) => setTimeout(resolve, 1_000));
      }

      const verificationEvaluation = await inspectPayClickState(false);
      if (verificationEvaluation.exceptionDetails !== undefined) {
        throw new Error(
          verificationEvaluation.exceptionDetails.exception?.description ??
            verificationEvaluation.exceptionDetails.text ??
            "Verificarea clickului pe «Plătește acum» a eșuat.",
        );
      }
      const verification = verificationEvaluation.result.value as
        Record<string, unknown> | undefined;
      console.info("[GPay][CDP][pay] CLICK VERIFICATION", verification);
      if (
        verification?.present === true &&
        verification.disabled !== true &&
        verification.hitMatches === true
      ) {
        console.warn(
          "[GPay][CDP][pay] Butonul «Plătește acum» este încă prezent după click; flow-ul continuă cu verificarea vizuală deoarece autorizarea poate fi asincronă.",
        );
      }
    } catch (error) {
      if (
        !/Target (?:page, context or browser|session) has been closed/i.test(
          diagnosticError(error),
        )
      ) {
        throw error;
      }
      console.info(
        "[GPay][CDP][pay] Sheet-ul s-a închis după clickul pe «Plătește acum».",
      );
    }

    if (flow.verifyOutcome === undefined) {
      throw new Error(
        "Flow-ul Google Pay nu poate verifica rezultatul deoarece evaluatorul vizual AI nu este configurat.",
      );
    }
    let visualVerification: AiVisualCheckResult | undefined;
    let verificationSurface: "google_pay" | "merchant" = "google_pay";
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 2_000));
      let imageBase64: string;
      try {
        const sheetScreenshot =
          await sendGooglePayTargetCommand<GooglePayCaptureScreenshotResult>(
            debug.cdp,
            activeSessionId,
            "Page.captureScreenshot",
            { format: "jpeg", quality: 80, fromSurface: true },
          );
        imageBase64 = sheetScreenshot.data;
        verificationSurface = "google_pay";
      } catch {
        const merchantScreenshot = await merchantPage.screenshot({
          type: "jpeg",
          quality: 80,
          animations: "disabled",
          caret: "hide",
        });
        imageBase64 = merchantScreenshot.toString("base64");
        verificationSurface = "merchant";
      }

      const prompt = [
        "Verifică rezultatul vizibil al unui scenariu negativ Google Pay TEST după apăsarea butonului Plătește acum.",
        `Descrierea utilizatorului: ${cardDescription}`,
        `Codul scenariului selectat: ${selectedScenarioCode}`,
        "passed=true numai dacă este afișată vizibil o eroare relevantă pentru scenariul cerut.",
        "Un spinner, loading, formularul de plată neschimbat sau lipsa unui rezultat explicit înseamnă passed=false.",
        "Nu considera drept succes un mesaj generic fără legătură cu scenariul cerut.",
      ].join(" ");
      const visualInput: AiVisualCheckInput = {
        prompt,
        imagesBase64: [imageBase64],
        mimeType: "image/jpeg",
        ...(flow.aiProvider === undefined
          ? {}
          : { aiProvider: flow.aiProvider }),
        ...(flow.aiModel === undefined ? {} : { aiModel: flow.aiModel }),
      };
      lastVisualCheckDebug = {
        dataUrls: [`data:image/jpeg;base64,${imageBase64}`],
        mimeType: "image/jpeg",
        byteLength: Buffer.byteLength(imageBase64, "base64"),
        prompt,
      };
      visualVerification = await flow.verifyOutcome(visualInput);
      flow.onVerification?.(visualInput, visualVerification, {
        attempt,
        surface: verificationSurface,
        visualCheckDebug: lastVisualCheckDebug,
      });
      console.info("[GPay][AI] VISUAL ERROR VERIFICATION", {
        attempt,
        surface: verificationSurface,
        passed: visualVerification.passed,
        confidence: visualVerification.confidence,
        explanation: visualVerification.explanation,
        evidence: visualVerification.evidence,
      });
      if (visualVerification.passed && visualVerification.confidence >= 0.6) {
        break;
      }
    }
    if (
      visualVerification === undefined ||
      !visualVerification.passed ||
      visualVerification.confidence < 0.6
    ) {
      throw new RunnerError(
        "step_failed",
        `Gemini nu a confirmat vizual eroarea așteptată pentru scenariul ${selectedScenarioCode}: ${visualVerification?.explanation ?? "fără verdict"}.`,
        {
          retryable: true,
          ...(lastVisualCheckDebug === undefined
            ? {}
            : { visualCheckDebug: lastVisualCheckDebug }),
        },
      );
    }

    return {
      targetId: target.targetId,
      attached: true,
      readable: true,
      buyflowFound: true,
      paymentMethodListOpened: cardSearch?.listLooksOpen === true,
      cardCount,
      automaticFlowConfigured: true,
      testEnvironment,
      selectedByAi: true,
      aiSelection: {
        scenarioCode: selectedScenarioCode,
        reason: selection.reason,
        label: selectedCandidate.label,
        ending: selectedCandidate.ending,
      },
      visualVerification: {
        surface: verificationSurface,
        passed: visualVerification.passed,
        confidence: visualVerification.confidence,
        explanation: visualVerification.explanation,
        evidence: visualVerification.evidence,
      },
      ...(lastVisualCheckDebug === undefined
        ? {}
        : { visualCheckDebug: lastVisualCheckDebug }),
      payNowClicked: true,
      currentMethod: (currentMethod as JsonValue | undefined) ?? null,
      cardSearch: (cardSearch as JsonValue | undefined) ?? null,
    };
  } catch (error) {
    const message = diagnosticError(error);
    console.warn("[GPay][CDP][sheet] INSPECTION FAILED", {
      targetId: target.targetId,
      error: message,
    });

    return {
      targetId: target.targetId,
      attached: sessionId !== undefined,
      readable: false,
      buyflowFound: false,
      paymentMethodListOpened: false,
      automaticFlowConfigured: flow.cardDescription !== undefined,
      payNowClicked: false,
      error: message,
      ...(lastVisualCheckDebug === undefined
        ? {}
        : { visualCheckDebug: lastVisualCheckDebug }),
    };
  } finally {
    if (sessionId !== undefined) {
      await debug.cdp
        .send("Target.detachFromTarget", { sessionId })
        .catch((error) => {
          console.warn("[GPay][CDP][sheet] DETACH FAILED", {
            targetId: target.targetId,
            sessionId,
            error: diagnosticError(error),
          });
        });
    }
  }
};

const startGooglePayCdpDebug = async (
  page: Page,
): Promise<GooglePayCdpDebugSession | undefined> => {
  let cdp: CDPSession | undefined;

  try {
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Target.setDiscoverTargets", { discover: true });

    const before = await cdp.send("Target.getTargets");
    const baselineTargets = new Map<string, GooglePayCdpTargetSnapshot>(
      before.targetInfos.map((targetInfo) => {
        const snapshot = toGooglePayTargetSnapshot(targetInfo);
        return [snapshot.targetId, snapshot];
      }),
    );

    const debug: GooglePayCdpDebugSession = {
      cdp,
      startedAt: Date.now(),
      framesBeforeClick: page.frames().length,
      pagesBeforeClick: page.context().pages().length,
      baselineTargets,
      createdTargetIds: new Set<string>(),
      destroyedTargetIds: new Set<string>(),
      lastChangedState: new Map<string, string>(),
    };

    console.info("[GPay][CDP] GOOGLE PAY TARGET DEBUG START", {
      targetsBeforeClick: baselineTargets.size,
      framesBeforeClick: debug.framesBeforeClick,
      pagesBeforeClick: debug.pagesBeforeClick,
    });

    const relevantBefore = [...baselineTargets.values()].filter(
      isPaymentRelatedTarget,
    );
    if (relevantBefore.length > 0) {
      console.info("[GPay][CDP] PAYMENT-RELATED TARGETS BEFORE CLICK");
      console.table(relevantBefore.map(targetForConsole));
    } else {
      console.info("[GPay][CDP] No payment-related CDP targets before click.");
    }

    cdp.on("Target.targetCreated", ({ targetInfo }) => {
      const snapshot = toGooglePayTargetSnapshot(targetInfo);
      debug.createdTargetIds.add(snapshot.targetId);
      console.info("[GPay][CDP] TARGET CREATED", targetForConsole(snapshot));
    });

    cdp.on("Target.targetInfoChanged", ({ targetInfo }) => {
      const snapshot = toGooglePayTargetSnapshot(targetInfo);
      const isNew = debug.createdTargetIds.has(snapshot.targetId);
      const isRelevant = isPaymentRelatedTarget(snapshot);
      if (!isNew && !isRelevant) return;

      const state = JSON.stringify(snapshot);
      if (debug.lastChangedState.get(snapshot.targetId) === state) return;
      debug.lastChangedState.set(snapshot.targetId, state);

      console.info("[GPay][CDP] TARGET CHANGED", {
        ...targetForConsole(snapshot),
        isNewSinceClick: isNew,
      });
    });

    cdp.on("Target.targetDestroyed", ({ targetId }) => {
      const wasNew = debug.createdTargetIds.has(targetId);
      const wasRelevant = isPaymentRelatedTarget(
        debug.baselineTargets.get(targetId) ?? {},
      );
      if (!wasNew && !wasRelevant) return;

      debug.destroyedTargetIds.add(targetId);
      console.info("[GPay][CDP] TARGET DESTROYED", {
        targetId,
        wasNewSinceClick: wasNew,
      });
    });

    return debug;
  } catch (error) {
    console.warn("[GPay][CDP] Could not start CDP diagnostics", {
      error: diagnosticError(error),
    });
    if (cdp !== undefined) {
      await cdp.detach().catch(() => undefined);
    }
    return undefined;
  }
};

/**
 * Încheie diagnosticul CDP și compară target-urile disponibile după click cu
 * snapshot-ul făcut înainte de click. Logurile sunt intenționat limitate:
 * target-uri noi + target-uri payment-related + sumar Playwright frame/page.
 */
const finishGooglePayCdpDebug = async (
  page: Page,
  debug: GooglePayCdpDebugSession,
  reason: "success" | "step-error" = "success",
  flow: GooglePayFlowOptions = {},
): Promise<JsonValue[]> => {
  try {
    const automaticFlowConfigured =
      flow.cardDescription !== undefined &&
      flow.cardDescription.trim().length > 0;
    const maxTargetPollAttempts = automaticFlowConfigured ? 40 : 5;
    let afterTargets: GooglePayCdpTargetSnapshot[] = [];
    let googlePaySheetTargets: GooglePayCdpTargetSnapshot[] = [];
    for (let attempt = 1; attempt <= maxTargetPollAttempts; attempt += 1) {
      const after = await debug.cdp.send("Target.getTargets");
      afterTargets = after.targetInfos.map(toGooglePayTargetSnapshot);
      googlePaySheetTargets = afterTargets.filter(
        (target) =>
          !debug.baselineTargets.has(target.targetId) &&
          isGooglePaySheetTarget(target),
      );
      if (googlePaySheetTargets.length > 0) {
        console.info("[GPay][CDP] GOOGLE PAY TARGET READY", {
          pollAttempt: attempt,
          waitedMs: (attempt - 1) * 250,
          targetIds: googlePaySheetTargets.map((target) => target.targetId),
        });
        break;
      }
      if (attempt < maxTargetPollAttempts) {
        await page.waitForTimeout(250);
      }
    }

    const afterById = new Map(
      afterTargets.map((target) => [target.targetId, target]),
    );

    const newTargets = afterTargets.filter(
      (target) => !debug.baselineTargets.has(target.targetId),
    );
    const paymentTargetsAfter = afterTargets.filter(isPaymentRelatedTarget);
    const disappearedTargets = [...debug.baselineTargets.values()].filter(
      (target) => !afterById.has(target.targetId),
    );

    console.info("[GPay][CDP] TARGETS AFTER CLICK SUMMARY", {
      reason,
      elapsedMs: Date.now() - debug.startedAt,
      targetsBeforeClick: debug.baselineTargets.size,
      targetsAfterClick: afterTargets.length,
      createdEvents: debug.createdTargetIds.size,
      destroyedEvents: debug.destroyedTargetIds.size,
      framesBeforeClick: debug.framesBeforeClick,
      framesAfterClick: page.frames().length,
      pagesBeforeClick: debug.pagesBeforeClick,
      pagesAfterClick: page.context().pages().length,
    });

    if (newTargets.length > 0) {
      console.info("[GPay][CDP] TARGETS STILL NEW AFTER CLICK");
      console.table(newTargets.slice(0, 20).map(targetForConsole));
    } else {
      console.info("[GPay][CDP] No new CDP target remained after click.");
    }

    if (paymentTargetsAfter.length > 0) {
      console.info("[GPay][CDP] PAYMENT-RELATED TARGETS AFTER CLICK");
      console.table(paymentTargetsAfter.slice(0, 20).map(targetForConsole));
    }

    if (disappearedTargets.length > 0) {
      console.info("[GPay][CDP] BASELINE TARGETS THAT DISAPPEARED");
      console.table(disappearedTargets.slice(0, 20).map(targetForConsole));
    }

    const googlePaySheetInspections: JsonValue[] = [];

    if (googlePaySheetTargets.length > 0) {
      console.info("[GPay][CDP] GOOGLE PAY SHEET TARGETS", {
        count: googlePaySheetTargets.length,
        targetIds: googlePaySheetTargets.map((target) => target.targetId),
      });

      for (const target of googlePaySheetTargets.slice(0, 3)) {
        googlePaySheetInspections.push(
          await inspectGooglePaySheetTarget(page, debug, target, flow),
        );
      }
    } else {
      console.warn(
        "[GPay][CDP] No new pay.google.com/gp/p/ui/pay target was available for DOM inspection.",
      );
    }

    console.info("[GPay][CDP] GOOGLE PAY TARGET DEBUG END", {
      newTargetIds: newTargets.map((target) => target.targetId),
      createdEventTargetIds: [...debug.createdTargetIds],
      destroyedEventTargetIds: [...debug.destroyedTargetIds],
      googlePaySheetTargetIds: googlePaySheetTargets.map(
        (target) => target.targetId,
      ),
    });

    const readableSheetCount = googlePaySheetInspections.filter(
      (inspection) =>
        typeof inspection === "object" &&
        inspection !== null &&
        !Array.isArray(inspection) &&
        inspection.readable === true,
    ).length;
    const automaticFlowCompleted = googlePaySheetInspections.some(
      (inspection) =>
        typeof inspection === "object" &&
        inspection !== null &&
        !Array.isArray(inspection) &&
        inspection.payNowClicked === true,
    );
    const visualCheckDebug = googlePaySheetInspections
      .map((inspection) =>
        typeof inspection === "object" &&
        inspection !== null &&
        !Array.isArray(inspection) &&
        typeof inspection.visualCheckDebug === "object" &&
        inspection.visualCheckDebug !== null &&
        !Array.isArray(inspection.visualCheckDebug)
          ? (inspection.visualCheckDebug as unknown as VisualCheckDebug)
          : undefined,
      )
      .find((debug): debug is VisualCheckDebug => debug !== undefined);
    if (
      flow.cardDescription !== undefined &&
      flow.cardDescription.trim().length > 0 &&
      !automaticFlowCompleted
    ) {
      const failedInspection = googlePaySheetInspections.find(
        (inspection) =>
          typeof inspection === "object" &&
          inspection !== null &&
          !Array.isArray(inspection) &&
          typeof inspection.error === "string",
      );
      const inspectionError =
        typeof failedInspection === "object" &&
        failedInspection !== null &&
        !Array.isArray(failedInspection) &&
        typeof failedInspection.error === "string"
          ? failedInspection.error
          : undefined;
      throw new RunnerError(
        "step_failed",
        inspectionError === undefined
          ? googlePaySheetTargets.length === 0
            ? "Flow-ul automat Google Pay a eșuat: sheet-ul pay.google.com nu s-a deschis în maximum 10 secunde după click."
            : "Flow-ul automat Google Pay nu a reușit să selecteze cardul, să apese «Plătește acum» și să verifice rezultatul."
          : `Flow-ul automat Google Pay a eșuat: ${inspectionError}`,
        {
          retryable: true,
          ...(visualCheckDebug === undefined ? {} : { visualCheckDebug }),
        },
      );
    }

    return [
      {
        level: readableSheetCount > 0 ? "info" : "warning",
        message:
          readableSheetCount > 0
            ? `Diagnostic Google Pay CDP: target-ul sheet-ului a fost găsit și DOM-ul a putut fi citit (${readableSheetCount}). Vezi logurile [GPay][CDP][sheet].`
            : googlePaySheetTargets.length > 0
              ? "Diagnostic Google Pay CDP: target-ul sheet-ului a fost găsit, dar DOM-ul nu a putut fi citit. Vezi logurile [GPay][CDP][sheet]."
              : "Diagnostic Google Pay CDP: Chrome a creat target-uri după click, dar nu a rămas disponibil un target pay.google.com/gp/p/ui/pay pentru inspecție.",
        googlePayDiagnostic: {
          cdpAvailable: true,
          targetsBeforeClick: debug.baselineTargets.size,
          targetsAfterClick: afterTargets.length,
          createdTargetCount: debug.createdTargetIds.size,
          destroyedTargetCount: debug.destroyedTargetIds.size,
          newTargetCount: newTargets.length,
          framesBeforeClick: debug.framesBeforeClick,
          framesAfterClick: page.frames().length,
          pagesBeforeClick: debug.pagesBeforeClick,
          pagesAfterClick: page.context().pages().length,
          googlePaySheetTargetCount: googlePaySheetTargets.length,
          readableGooglePaySheetCount: readableSheetCount,
          automaticFlowCompleted,
          googlePaySheetInspections,
        },
        ...(visualCheckDebug === undefined ? {} : { visualCheckDebug }),
      },
    ];
  } catch (error) {
    console.warn("[GPay][CDP] Could not finish CDP diagnostics", {
      error: diagnosticError(error),
    });

    if (
      flow.cardDescription !== undefined &&
      flow.cardDescription.trim().length > 0
    ) {
      throw error;
    }
    return [
      {
        level: "warning",
        message: `Diagnostic Google Pay CDP incomplet: ${diagnosticError(error)}`,
        googlePayDiagnostic: {
          cdpAvailable: true,
          error: diagnosticError(error),
        },
      },
    ];
  } finally {
    await debug.cdp
      .send("Target.setDiscoverTargets", { discover: false })
      .catch(() => undefined);
    await debug.cdp.detach().catch(() => undefined);
  }
};

export type RunnerStatusListener = (snapshot: RunnerSnapshot) => void;

interface RunnerSession {
  project: Project;
  test: TestDefinition;
  dataset?: TestDataset;
  datasetValues: Record<string, string>;
  page: Page;
  run: TestRun;
  snapshot: RunnerSnapshot;
  stopRequested: boolean;
  mode: RunMode;
  pendingFallback?: PendingFallback;
  pendingMissingData?: PendingMissingData;
  postRunItems: ExternalCheckStep[];
  postRunIndex: number;
  pendingImap?: PendingImap;
  postRunAiRequested: boolean;
  runAiProvider?: Exclude<AiProviderId, "none">;
  runAiModel?: string;
  postRunEvidence: {
    mysql?: JsonValue;
    imap?: JsonValue;
  };
  consoleMessages: JsonValue[];
  networkFailures: JsonValue[];
  artifactsCaptured: boolean;
  traceActive: boolean;
  networkWaiter: SmartNetworkWaiter;
  stages: TestStage[];
  currentStageIndex: number;
  stageStartedAt: string;
  variables: SessionVariableContext;
  missingVariablePolicy: "pause" | "fail";
  pendingVariable?: PendingVariable;
  legacySingleFlow: boolean;
  flowOnly: boolean;
}

interface PendingFallback {
  item: ActionStep;
  index: number;
  startedAt: string;
  primaryError: RunnerErrorDetails;
  logs: JsonValue[];
}

interface PendingMissingData {
  item: ActionStep;
  startedAt: string;
  details: MissingDataDetails;
}

interface PendingImap {
  item: ExternalCheckStep;
  startedAt: string;
}

interface PendingVariable {
  output: VariableOutputDefinition;
  stageId: string;
  consumerId: string;
  producerId?: string;
  reason: NonNullable<RunnerSnapshot["missingVariable"]>["reason"];
  message: string;
  candidateCount?: number;
  retry?: () => Promise<void>;
  resume: () => Promise<void>;
}

const activeBrowserStates = new Set([
  "starting",
  "running",
  "reconnecting",
  "waiting_for_basic_auth",
]);

const copySnapshot = (snapshot: RunnerSnapshot): RunnerSnapshot => ({
  ...snapshot,
  ...(snapshot.stages === undefined
    ? {}
    : { stages: structuredClone(snapshot.stages) }),
  ...(snapshot.variables === undefined
    ? {}
    : { variables: structuredClone(snapshot.variables) }),
  ...(snapshot.stage === undefined ? {} : { stage: { ...snapshot.stage } }),
  ...(snapshot.missingVariable === undefined
    ? {}
    : { missingVariable: { ...snapshot.missingVariable } }),
  ...(snapshot.flowItems === undefined
    ? {}
    : { flowItems: structuredClone(snapshot.flowItems) }),
  ...(snapshot.checkItems === undefined
    ? {}
    : { checkItems: structuredClone(snapshot.checkItems) }),
  ...(snapshot.wipe === undefined
    ? {}
    : {
        wipe: {
          ...snapshot.wipe,
          entries: snapshot.wipe.entries.map((entry) => ({ ...entry })),
        },
      }),
  ...(snapshot.cleanup === undefined
    ? {}
    : {
        cleanup: {
          ...snapshot.cleanup,
          entries: snapshot.cleanup.entries.map((entry) => ({ ...entry })),
        },
      }),
  ...(snapshot.mysql === undefined
    ? {}
    : { mysql: structuredClone(snapshot.mysql) }),
  ...(snapshot.imap === undefined ? {} : { imap: { ...snapshot.imap } }),
  ...(snapshot.postRunAi === undefined
    ? {}
    : { postRunAi: structuredClone(snapshot.postRunAi) }),
  ...(snapshot.aiCost === undefined ? {} : { aiCost: { ...snapshot.aiCost } }),
  ...(snapshot.run === undefined ? {} : { run: { ...snapshot.run } }),
  ...(snapshot.error === undefined ? {} : { error: { ...snapshot.error } }),
  ...(snapshot.fallback === undefined
    ? {}
    : {
        fallback: {
          ...snapshot.fallback,
          locator: structuredClone(snapshot.fallback.locator),
        },
      }),
  ...(snapshot.missingData === undefined
    ? {}
    : {
        missingData: {
          ...snapshot.missingData,
          locator: structuredClone(snapshot.missingData.locator),
        },
      }),
});

const jsonError = (error: RunnerErrorDetails): JsonValue => ({
  code: error.code,
  message: error.message,
  ...(error.count === undefined ? {} : { count: error.count }),
  ...(error.stepId === undefined ? {} : { stepId: error.stepId }),
});

const configuredPostRunItems = (
  test: TestDefinition,
  selection: StartRunInput["postRun"],
): ExternalCheckStep[] => {
  const checks = normalizeTestPostRunChecks(test.postRunChecks);
  const mysqlEnabled = selection?.mysql ?? checks.mysql.enabled;
  const imapEnabled = selection?.imap ?? checks.imap.enabled;
  const result: ExternalCheckStep[] = [];
  if (mysqlEnabled && checks.mysql.tableNames.length > 0) {
    result.push({
      id: `post-run:mysql:${test.id}`,
      type: "check",
      checkType: "mysql",
      title: "MySQL snapshot post-run",
      humanDescription:
        "Compară tabelele configurate cu baseline-ul capturat înainte de rulare.",
      config: {
        tableNames: [...checks.mysql.tableNames],
        identities: structuredClone(checks.mysql.identities),
      },
      enabled: true,
    });
  }
  const accountIds = selection?.imapAccountIds ?? checks.imap.accountIds;
  const configuredInboxes = checks.imap.inboxes.filter(({ accountId }) =>
    accountIds.includes(accountId),
  );
  const configuredAccountIds = new Set(
    configuredInboxes.map(({ accountId }) => accountId),
  );
  const inboxes = [
    ...configuredInboxes,
    ...accountIds
      .filter((accountId) => !configuredAccountIds.has(accountId))
      .map((accountId, index) => ({
        id: `runtime-${index + 1}`,
        accountId,
        mailbox: checks.imap.mailbox,
        sender: checks.imap.sender,
        recipient: checks.imap.recipient,
        subjectEquals: checks.imap.subjectEquals,
        subjectContains: checks.imap.subjectContains,
        bodyContains: checks.imap.bodyContains,
      })),
  ];
  if (imapEnabled && inboxes.length > 0) {
    result.push(
      ...inboxes.map<ExternalCheckStep>((inbox, index) => ({
        id: `post-run:imap:${test.id}:${inbox.id}`,
        type: "check",
        checkType: "imap",
        title: `Ascultare e-mail post-run ${index + 1}`,
        humanDescription:
          "Așteaptă un mesaj primit după momentul pornirii testului.",
        config: {
          accountId: inbox.accountId,
          mailbox: inbox.mailbox,
          receivedAfterTestStart: true as const,
          ...(inbox.sender.length === 0 ? {} : { sender: inbox.sender }),
          ...(inbox.recipient.length === 0
            ? {}
            : { recipient: inbox.recipient }),
          ...(inbox.subjectEquals.length === 0
            ? {}
            : { subjectEquals: inbox.subjectEquals }),
          ...(inbox.subjectContains.length === 0
            ? {}
            : { subjectContains: inbox.subjectContains }),
          ...(inbox.bodyContains.length === 0
            ? {}
            : { bodyContains: inbox.bodyContains }),
        },
        enabled: true,
      })),
    );
  }
  if (result.length === 0 && selection === undefined) {
    return test.flowItems.filter(
      (item): item is ExternalCheckStep =>
        item.type === "check" &&
        item.enabled &&
        (item.checkType === "mysql" || item.checkType === "imap"),
    );
  }
  return result;
};

const accountIdForImapStep = (item: CheckStep): string | undefined =>
  "accountId" in item.config ? item.config.accountId : undefined;

const selectStagePostChecksForRun = (
  checks: ExternalCheckStep[],
  selection: StartRunInput["postRun"],
): ExternalCheckStep[] => {
  if (selection === undefined) return checks;
  const selectedImapAccounts =
    selection.imapAccountIds === undefined
      ? undefined
      : new Set(selection.imapAccountIds);
  return checks.filter((check) => {
    if (check.checkType === "mysql") return selection.mysql;
    if (!selection.imap) return false;
    const accountId = accountIdForImapStep(check);
    return (
      selectedImapAccounts === undefined ||
      (accountId !== undefined && selectedImapAccounts.has(accountId))
    );
  });
};

const scheduledCheckItems = (
  test: TestDefinition,
  postRunItems: CheckStep[],
): CheckStep[] => {
  const checks = [
    ...test.flowItems.filter(
      (item): item is CheckStep => item.type === "check" && item.enabled,
    ),
    ...postRunItems.filter((item) => item.enabled),
  ];
  return [
    ...new Map(checks.map((item) => [item.id, structuredClone(item)])).values(),
  ];
};

const imapMessageKey = (message: ImapMatchedMessage): string =>
  `${message.accountId}\u0000${message.mailbox}\u0000${message.uid}`;

const imapEvidenceMessages = (evidence: JsonValue | undefined) => {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Array.isArray(evidence) ||
    !Array.isArray(evidence.messages)
  ) {
    return [];
  }
  return evidence.messages as unknown as ImapMatchedMessage[];
};

const consumedImapMessageKeys = (evidence: JsonValue | undefined) => {
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    Array.isArray(evidence) ||
    !Array.isArray(evidence.checks)
  ) {
    return new Set<string>();
  }
  return new Set(
    evidence.checks.flatMap((check) =>
      imapEvidenceMessages(check).map(imapMessageKey),
    ),
  );
};

export class TestRunnerService {
  private readonly listeners = new Set<RunnerStatusListener>();
  private readonly sessions = new Map<string, RunnerSession>();
  private readonly artifactCaptureByProject = new Map<string, Promise<void>>();
  private readonly latestByTest = new Map<string, RunnerSnapshot>();

  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly pageRepository: PageRepository,
    private readonly runRepository: RunRepository,
    private readonly browser: RunnerBrowserGateway,
    private readonly options: TestRunnerServiceOptions,
  ) {}

  public onStatusChange(listener: RunnerStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public async captureVisualStepContext(
    projectId: string,
    testId: string,
    stepId: string,
    flowItems: TestFlowItem[],
  ): Promise<VisualStepContextCapture> {
    if (!Array.isArray(flowItems) || flowItems.length > 1_000) {
      throw new Error("Flow-ul trimis pentru captură nu este valid.");
    }
    const targetIndex = flowItems.findIndex((item) => item.id === stepId);
    if (targetIndex < 0) {
      throw new Error("Pasul vizual nu există în flow-ul curent.");
    }
    const target = flowItems[targetIndex];
    if (target?.type !== "action" || target.actionType !== "visual_ai") {
      throw new Error("Captura poate fi creată doar pentru un pas vizual AI.");
    }

    const project = this.requireProject(projectId);
    const test = this.requireTest(projectId, testId);
    await this.prepareBrowser(project, test);
    const page = this.browser.getRunnerPage(project.id);
    const dataset = this.datasetRepository.listByTest(test.id)[0];
    const datasetValues = materializeDataset(dataset, {
      createId: this.options.createId,
      now: this.options.now,
      random: this.options.random ?? Math.random,
    });

    for (const item of flowItems.slice(0, targetIndex)) {
      if (
        !item.enabled ||
        item.type === "check" ||
        item.type === "breakpoint"
      ) {
        continue;
      }
      if (item.type === "manual_intervention") {
        throw new Error(
          `Pasul anterior „${item.title}" necesită intervenție manuală și nu poate fi redat automat pentru captură.`,
        );
      }
      if (item.actionType === "visual_ai") {
        throw new Error(
          "Un pas vizual AI anterior trebuie executat într-o rulare normală înainte de a captura această zonă.",
        );
      }
      await executeFlowItem(page, item, datasetValues);
    }

    const viewport = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    const image = await page.screenshot({
      type: "jpeg",
      quality: 85,
    });
    return {
      imageBase64: image.toString("base64"),
      mimeType: "image/jpeg",
      viewportWidth: viewport.width,
      viewportHeight: viewport.height,
      capturedAt: this.options.now().toISOString(),
    };
  }

  public async start(input: StartRunInput): Promise<RunnerSnapshot> {
    if (
      input.clearSessionBeforeRun !== undefined &&
      typeof input.clearSessionBeforeRun !== "boolean"
    ) {
      throw new Error("Opțiunea de curățare a sesiunii nu este validă.");
    }
    if (input.flowOnly !== undefined && typeof input.flowOnly !== "boolean") {
      throw new Error("Modul flow-only nu este valid.");
    }
    if (
      input.stageId !== undefined &&
      (typeof input.stageId !== "string" || input.stageId.trim().length === 0)
    ) {
      throw new Error("Etapa pentru replay nu este validă.");
    }
    const key = this.testKey(input.projectId, input.testId);
    const existing = this.latestByTest.get(key);
    if (existing?.canStop === true || existing?.canRetry === true) {
      throw new Error(
        "Testul are deja o rulare activă sau o eroare în review.",
      );
    }

    const project = this.requireProject(input.projectId);
    const storedTest = this.requireTest(input.projectId, input.testId);
    let test = storedTest;
    let datasetOverrides: Record<string, string> = {};
    if (input.aiPlan !== undefined) {
      if (
        storedTest.testMode !== "dynamic_ai" ||
        input.aiPlan.baseVersion !== storedTest.version ||
        input.aiPlan.instruction.trim().length === 0
      ) {
        throw new Error(
          "Planul AI nu corespunde versiunii curente a testului.",
        );
      }
      const applied = applyAiRunPlan(storedTest, input.aiPlan.proposal);
      test = applied.test;
      datasetOverrides = applied.datasetOverrides;
    }
    const mode = input.mode ?? "automatic";
    if (!(RUN_MODES as readonly string[]).includes(mode)) {
      throw new Error("Modul de rulare nu este valid.");
    }
    const datasets = this.datasetRepository.listByTest(test.id);
    const dataset = this.selectDataset(
      datasets,
      input.datasetId ??
        (input.flowOnly === true ? datasets[0]?.id : undefined),
    );
    this.assertRunnable(test, datasets);
    const datasetValues = {
      ...materializeDataset(dataset, {
        createId: this.options.createId,
        now: this.options.now,
        random: this.options.random ?? Math.random,
      }),
      ...datasetOverrides,
    };
    const legacySingleFlow = test.stages === undefined;
    const configuredStages = stagesForTest(test);
    const targetStageIndex =
      input.stageId === undefined
        ? configuredStages.length - 1
        : configuredStages.findIndex((stage) => stage.id === input.stageId);
    if (targetStageIndex < 0) {
      throw new StepExecutionError(
        "invalid_test",
        "Etapa selectată pentru replay nu există.",
      );
    }
    const stages = configuredStages.filter(
      (stage, index) => stage.enabled && index <= targetStageIndex,
    );
    if (stages.length === 0) {
      throw new StepExecutionError(
        "invalid_test",
        "Testul nu conține nicio etapă activă.",
      );
    }
    if (input.flowOnly === true) {
      stages.forEach((stage) => {
        stage.postChecks = [];
      });
    } else if (test.stages === undefined) {
      stages[0]!.postChecks = configuredPostRunItems(test, input.postRun);
    } else {
      stages.forEach((stage) => {
        stage.postChecks = selectStagePostChecksForRun(
          stage.postChecks,
          input.postRun,
        );
      });
      if (input.aiPlan !== undefined) {
        stages[0]!.flowItems = structuredClone(test.flowItems);
      }
    }
    const firstStage = stages[0]!;
    test = { ...test, flowItems: structuredClone(firstStage.flowItems) };
    const allFlowItems = stages.flatMap((stage) => stage.flowItems);
    const startedAt = this.options.now().toISOString();
    const invalidationWarning =
      test.status === "invalidated"
        ? {
            code: "test_invalidated",
            message:
              "Testul rulează cu warning după o schimbare semantică a paginii.",
            ...(test.invalidation === undefined
              ? {}
              : {
                  pageId: test.invalidation.pageId,
                  pageVersionId: test.invalidation.pageVersionId,
                  score: test.invalidation.score,
                  threshold: test.invalidation.threshold,
                }),
          }
        : undefined;
    const run: TestRun = {
      id: this.options.createId(),
      projectId: project.id,
      testId: test.id,
      testVersion: test.version,
      ...(dataset === undefined ? {} : { datasetId: dataset.id }),
      startedAt,
      status: "running",
      browserType: project.browserConfig.browserType,
      pageVersionIds: this.findPageVersionIds(allFlowItems),
      ...(invalidationWarning === undefined
        ? {}
        : { warnings: [invalidationWarning] }),
      datasetSnapshot: {
        ...(dataset === undefined
          ? {}
          : { id: dataset.id, name: dataset.name }),
        values: structuredClone(datasetValues),
      },
    };
    this.runRepository.create(run);
    this.publishForTest(project.id, test.id, {
      state: "preparing",
      currentStepIndex: -1,
      totalSteps: firstStage.flowItems.length,
      message: "Se încarcă testul și dataset-ul.",
      canStop: false,
      canRetry: false,
    });

    try {
      this.publishForTest(project.id, test.id, {
        state: "browser_starting",
        currentStepIndex: -1,
        totalSteps: firstStage.flowItems.length,
        message: "Se verifică sesiunea de browser deschisă.",
        canStop: false,
        canRetry: false,
      });
      await this.prepareBrowser(project, test);
      const page = this.browser.getRunnerPage(project.id);
      const wipe =
        input.clearSessionBeforeRun === true
          ? await wipeBrowserStateForOrigin(
              this.browser.getRunnerContext(project.id),
              page,
              test.startUrl,
              { clearAllContextCookies: true },
            )
          : undefined;
      const postRunItems = structuredClone(firstStage.postChecks);
      const normalizedPostRunChecks = normalizeTestPostRunChecks(
        test.postRunChecks,
      );
      const configuredImapItems = postRunItems.filter(
        (item) => item.checkType === "imap",
      );
      console.info("[IMAP][runner] Configurare la pornirea run-ului", {
        runId: run.id,
        testId: test.id,
        runStartedAt: run.startedAt,
        requested: {
          enabled: input.postRun?.imap ?? false,
          accountIds: input.postRun?.imapAccountIds ?? [],
        },
        saved: {
          enabled: normalizedPostRunChecks.imap.enabled,
          accountIds: normalizedPostRunChecks.imap.accountIds,
          mailbox: normalizedPostRunChecks.imap.mailbox,
        },
        scheduledChecks: configuredImapItems.map((item) => ({
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          mailbox: "mailbox" in item.config ? (item.config.mailbox ?? "") : "",
        })),
      });
      if (input.postRun?.imap === true && configuredImapItems.length === 0) {
        console.warn(
          "[IMAP][runner] IMAP a fost cerut, dar nu a fost programat niciun check. Verifică selecția conturilor.",
          {
            runId: run.id,
            selectedAccountIds: input.postRun.imapAccountIds ?? [],
          },
        );
      }
      const variables = new SessionVariableContext(this.options.now);
      variables.seed("baseUrl", project.baseUrl, "url", "system");
      variables.seed("runId", run.id, "string", "system");
      variables.seed("testId", test.id, "string", "system");
      variables.seed("startedAt", run.startedAt, "date_time", "system");
      Object.entries(datasetValues).forEach(([name, value]) => {
        variables.seed(name, value, "string", "dataset");
      });
      const snapshot: RunnerSnapshot = {
        state: input.waitBeforeStart === true ? "waiting_for_start" : "running",
        run,
        currentStepIndex: 0,
        totalSteps: test.flowItems.length,
        flowItems: structuredClone(test.flowItems),
        checkItems: scheduledCheckItems(test, postRunItems),
        ...(test.flowItems[0] === undefined
          ? {}
          : { currentStepId: test.flowItems[0].id }),
        message:
          input.waitBeforeStart === true
            ? wipe === undefined
              ? "Browserul este pregătit. Confirmă pornirea testului."
              : "Sesiunea browserului a fost curățată. Confirmă pornirea testului."
            : input.aiPlan === undefined
              ? wipe === undefined
                ? "Rularea a început."
                : "Sesiunea browserului a fost curățată și rularea a început."
              : `Rularea a început cu planul AI: ${input.aiPlan.proposal.summary}`,
        ...(wipe === undefined ? {} : { wipe }),
        stages: structuredClone(stages),
        stage: {
          stageId: firstStage.id,
          stageIndex: 0,
          totalStages: stages.length,
          phase: "resolving_entry",
          currentCheckIndex: 0,
          totalChecks: firstStage.postChecks.length,
        },
        variables: variables.list(true),
        ...(input.waitBeforeStart === true
          ? {
              pause: {
                kind: "before_start",
                title: "Pornire manuală",
                instructions:
                  "Apasă Continue sau shortcut-ul configurat pentru primul pas.",
                ...(test.flowItems[0] === undefined
                  ? {}
                  : { nextStepId: test.flowItems[0].id }),
              } as const,
            }
          : {}),
        canStop: true,
        canRetry: false,
      };
      const session: RunnerSession = {
        project,
        test,
        ...(dataset === undefined ? {} : { dataset }),
        datasetValues,
        page,
        run,
        snapshot,
        stopRequested: false,
        mode,
        postRunItems,
        postRunIndex: 0,
        postRunAiRequested: input.postRun?.ai === true,
        ...(input.aiProvider === undefined
          ? {}
          : { runAiProvider: input.aiProvider }),
        ...(input.aiModel === undefined ? {} : { runAiModel: input.aiModel }),
        postRunEvidence: {},
        consoleMessages: [],
        networkFailures: [],
        artifactsCaptured: false,
        traceActive: false,
        networkWaiter: new SmartNetworkWaiter(page),
        stages,
        currentStageIndex: 0,
        stageStartedAt: startedAt,
        variables,
        missingVariablePolicy: input.missingVariablePolicy ?? "pause",
        legacySingleFlow,
        flowOnly: input.flowOnly === true,
      };
      this.attachDiagnostics(session);
      if (!session.flowOnly) await this.startTrace(session);
      this.sessions.set(run.id, session);
      this.publish(session, snapshot);
      if (input.waitBeforeStart !== true) {
        void this.prepareCurrentStage(session);
      }
      return copySnapshot(snapshot);
    } catch (error) {
      const details = this.toRunnerError(error, undefined, "browser_start");
      const endedAt = this.options.now().toISOString();
      this.runRepository.updateStatus(run.id, "failed", endedAt);
      this.persistRunError(run.id, details);
      this.publishForTest(project.id, test.id, {
        state:
          this.browser.getStatus().state === "waiting_for_basic_auth"
            ? "waiting_for_basic_auth"
            : "failed",
        currentStepIndex: -1,
        totalSteps: test.flowItems.length,
        message: details.message,
        error: details,
        run: { ...run, status: "failed", endedAt },
        canStop: false,
        canRetry: false,
      });
      throw error;
    }
  }

  public async stop(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (!session.snapshot.canStop) {
      throw new Error("Rularea nu poate fi oprită în starea curentă.");
    }
    if (
      session.pendingImap !== undefined &&
      session.snapshot.state === "waiting_for_imap_check"
    ) {
      return this.failPendingImap(session);
    }
    session.stopRequested = true;
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "stopped", endedAt };
    this.runRepository.updateStatus(runId, "stopped", endedAt);
    const snapshotWithoutError = { ...session.snapshot };
    delete snapshotWithoutError.error;
    delete snapshotWithoutError.fallback;
    delete snapshotWithoutError.pause;
    delete snapshotWithoutError.missingData;
    delete session.pendingFallback;
    delete session.pendingMissingData;
    delete session.pendingImap;
    delete session.pendingVariable;
    delete snapshotWithoutError.missingVariable;
    await this.discardTrace(session);
    this.publish(session, {
      ...snapshotWithoutError,
      state: "stopped",
      run: session.run,
      message: "Rularea a fost oprită manual.",
      canStop: false,
      canRetry: false,
    });
    return copySnapshot(session.snapshot);
  }

  public retry(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (!session.snapshot.canRetry) {
      throw new Error("Pasul curent nu poate fi reîncercat.");
    }
    session.stopRequested = false;
    session.run = {
      ...session.run,
      status: "running",
    };
    delete session.run.endedAt;
    this.runRepository.updateStatus(runId, "running");
    this.runRepository.updateError(runId, undefined);
    const retryingSnapshot = { ...session.snapshot };
    delete retryingSnapshot.error;
    this.publish(session, {
      ...retryingSnapshot,
      state: "running",
      run: session.run,
      message: "Se reîncearcă pasul curent.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public async retryVariableProducer(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    const pending = session.pendingVariable;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_variable" ||
      pending.retry === undefined
    ) {
      throw new Error("Variabila curentă nu are un producător reîncercabil.");
    }
    delete session.pendingVariable;
    const next = { ...session.snapshot };
    delete next.missingVariable;
    this.publish(session, {
      ...next,
      state: "running",
      message: `Se reîncearcă producerea variabilei „${pending.output.name}”.`,
      canStop: true,
    });
    await pending.retry();
    return copySnapshot(session.snapshot);
  }

  public async provideManualVariable(
    runId: string,
    value: unknown,
  ): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    const pending = session.pendingVariable;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_variable"
    ) {
      throw new Error("Rularea nu așteaptă o variabilă manuală.");
    }
    session.variables.publish([
      {
        output: {
          ...pending.output,
          overwritePolicy: session.variables.has(pending.output.name)
            ? "replace"
            : pending.output.overwritePolicy,
        },
        value,
        source: "manual",
        stageId: pending.stageId,
        ...(pending.producerId === undefined
          ? {}
          : { producerId: pending.producerId }),
        manual: true,
      },
    ]);
    delete session.pendingVariable;
    const next = { ...session.snapshot };
    delete next.missingVariable;
    this.publish(session, {
      ...next,
      state: "running",
      variables: session.variables.list(true),
      message: `Variabila „${pending.output.name}” a fost completată manual.`,
      canStop: true,
      canRetry: false,
    });
    await pending.resume();
    return copySnapshot(session.snapshot);
  }

  private pauseForMissingVariable(
    session: RunnerSession,
    pending: PendingVariable,
  ): void {
    if (session.missingVariablePolicy === "fail") {
      this.failStagePreparation(
        session,
        new StepExecutionError("missing_data", pending.message),
        "missing_variable",
      );
      return;
    }
    session.pendingVariable = pending;
    this.publish(session, {
      ...session.snapshot,
      state: "waiting_for_variable",
      variables: session.variables.list(true),
      missingVariable: {
        variableName: pending.output.name,
        expectedType: pending.output.type,
        stageId: pending.stageId,
        consumerId: pending.consumerId,
        ...(pending.producerId === undefined
          ? {}
          : { producerId: pending.producerId }),
        reason: pending.reason,
        message: pending.message,
        ...(pending.candidateCount === undefined
          ? {}
          : { candidateCount: pending.candidateCount }),
        canRetryProducer: pending.retry !== undefined,
        canProvideManualValue: true,
      },
      message: pending.message,
      canStop: true,
      canRetry: false,
    });
  }

  public skipCurrentStep(runId: string): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (
      !["paused_on_error", "failed", "waiting_for_fallback_decision"].includes(
        session.snapshot.state,
      )
    ) {
      throw new Error("Pasul curent nu poate fi sărit în starea curentă.");
    }
    const item = session.test.flowItems[session.snapshot.currentStepIndex];
    if (item === undefined) {
      throw new Error("Pasul curent nu mai există.");
    }

    session.stopRequested = false;
    delete session.pendingFallback;
    delete session.pendingMissingData;
    session.run = { ...session.run, status: "running" };
    delete session.run.endedAt;
    this.runRepository.updateStatus(runId, "running");
    const warningMessage = `Pasul ${session.snapshot.currentStepIndex + 1} a fost sărit manual: ${item.title ?? item.id}.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "step_skipped_manually",
      stepId: item.id,
      message: warningMessage,
    });
    this.saveStepResult(
      session,
      item,
      "skipped",
      { logs: [{ level: "warning", message: warningMessage }] },
      this.options.now().toISOString(),
    );
    session.snapshot.currentStepIndex += 1;

    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.error;
    delete resumedSnapshot.fallback;
    delete resumedSnapshot.pause;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      run: session.run,
      message: "Pasul a fost sărit. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public async continueExecution(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    const wasWaitingForStart = session.snapshot.state === "waiting_for_start";
    if (session.snapshot.state === "waiting_for_missing_data") {
      return this.continueMissingData(session);
    }
    if (
      ![
        "waiting_for_start",
        "waiting_at_breakpoint",
        "waiting_for_manual_intervention",
        "waiting_after_step",
      ].includes(session.snapshot.state)
    ) {
      throw new Error("Rularea nu așteaptă comanda Continue.");
    }

    if (session.snapshot.state === "waiting_at_breakpoint") {
      const breakpoint =
        session.test.flowItems[session.snapshot.currentStepIndex];
      if (breakpoint === undefined || breakpoint.type !== "breakpoint") {
        throw new Error("Breakpoint-ul curent nu mai există.");
      }
      const now = this.options.now().toISOString();
      this.saveStepResult(
        session,
        breakpoint,
        "passed",
        {
          logs: [
            {
              level: "info",
              message: "Breakpoint continuat de utilizator.",
            },
          ],
        },
        now,
      );
      session.snapshot.currentStepIndex += 1;
    }
    if (session.snapshot.state === "waiting_for_manual_intervention") {
      const intervention =
        session.test.flowItems[session.snapshot.currentStepIndex];
      if (
        intervention === undefined ||
        intervention.type !== "manual_intervention"
      ) {
        throw new Error("Intervenția manuală curentă nu mai există.");
      }
      const now = this.options.now().toISOString();
      this.saveStepResult(
        session,
        intervention,
        "passed",
        {
          logs: [
            {
              level: "info",
              message: "Intervenția manuală a fost confirmată de utilizator.",
            },
          ],
        },
        now,
      );
      session.snapshot.currentStepIndex += 1;
    }

    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.pause;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      message: "Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    if (wasWaitingForStart) {
      void this.prepareCurrentStage(session);
    } else {
      void this.continueRun(session);
    }
    return copySnapshot(session.snapshot);
  }

  public configureContinueShortcut(
    projectId: string,
    shortcut: string,
  ): string {
    const project = this.requireProject(projectId);
    const normalized = assertShortcutAvailable(
      project.shortcutConfig,
      shortcut,
    );
    this.projectRepository.update({
      ...project,
      shortcutConfig: withContinueShortcut(project.shortcutConfig, normalized),
      updatedAt: this.options.now().toISOString(),
    });
    return normalized;
  }

  public previewMySqlCleanup(
    runId: string,
    diffId: string,
    rows: MySqlCleanupRowSelection[],
  ): RunnerSnapshot {
    const session = this.requireSession(runId);
    if (this.options.mysql === undefined) {
      throw new Error("Runtime-ul MySQL nu este configurat.");
    }
    const preview = this.options.mysql.previewCleanup(runId, diffId, rows);
    const details = this.options.mysql.getRunDetails(runId);
    this.publish(session, {
      ...session.snapshot,
      mysql: { ...details, cleanupPreview: preview },
      message: "Preview-ul cleanup este pregătit. Confirmă explicit ștergerea.",
    });
    return copySnapshot(session.snapshot);
  }

  public async confirmMySqlCleanup(
    runId: string,
    previewId: string,
  ): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (this.options.mysql === undefined) {
      throw new Error("Runtime-ul MySQL nu este configurat.");
    }
    await this.options.mysql.confirmCleanup(
      session.project.id,
      runId,
      previewId,
    );
    this.publish(session, {
      ...session.snapshot,
      mysql: this.options.mysql.getRunDetails(runId),
      message: "Cleanup-ul MySQL a fost verificat și finalizat.",
    });
    return copySnapshot(session.snapshot);
  }

  public async runCurrentFallback(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireFallbackSession(runId);
    const pending = session.pendingFallback;
    const fallback = pending?.item.fallbacks[pending.index];
    if (pending === undefined || fallback === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }

    this.publish(session, {
      ...session.snapshot,
      state: "running",
      message: `Se execută fallback-ul ${pending.index + 1}.`,
      canStop: true,
    });
    let result: StepExecutionResult;
    try {
      result = await (pending.item.type === "action"
        ? session.networkWaiter.trackAndAwait(() =>
            executeFlowItem(
              session.page,
              pending.item,
              session.datasetValues,
              fallback.locator,
            ),
          )
        : executeFlowItem(
            session.page,
            pending.item,
            session.datasetValues,
            fallback.locator,
          ));
    } catch (error) {
      const details = this.toRunnerError(
        error,
        pending.item.id,
        `fallback_${pending.item.actionType}`,
      );
      pending.logs.push({
        level: "warning",
        message: `Fallback-ul ${pending.index + 1} a eșuat: ${details.message}`,
      });
      if (session.stopRequested) {
        return copySnapshot(session.snapshot);
      }
      pending.index += 1;
      if (pending.index >= pending.item.fallbacks.length) {
        return this.finalizeExhaustedFallbacks(session, details);
      }
      this.publishFallbackDecision(session, details);
      return copySnapshot(session.snapshot);
    }

    if (session.stopRequested) {
      this.saveStepResult(
        session,
        pending.item,
        "stopped",
        {
          ...result,
          logs: [
            ...pending.logs,
            ...result.logs,
            { level: "warning", message: "Rularea a fost oprită manual." },
          ],
        },
        pending.startedAt,
        undefined,
        pending.index,
      );
      return copySnapshot(session.snapshot);
    }

    const wasAutoRepaired = this.persistSuccessfulFallback(
      session,
      pending.item.id,
      fallback.locator,
    );
    const warningMessage = `A fost folosit fallback-ul ${pending.index + 1}: ${fallback.humanDescription}`;
    const warning: JsonValue = {
      code: "fallback_used",
      stepId: pending.item.id,
      fallbackIndex: pending.index,
      message: warningMessage,
      autoRepaired: wasAutoRepaired,
    };
    session.run = this.runRepository.addWarning(session.run.id, warning);
    this.saveStepResult(
      session,
      pending.item,
      "passed_with_fallback",
      {
        ...result,
        logs: [
          ...pending.logs,
          ...result.logs,
          { level: "warning", message: warningMessage },
          ...(wasAutoRepaired
            ? [
                {
                  level: "info",
                  message:
                    "Auto-repair salvat: fallback-ul reușit este acum locator principal.",
                } as JsonValue,
              ]
            : []),
        ],
      },
      pending.startedAt,
      undefined,
      pending.index,
    );
    session.snapshot.currentStepIndex += 1;
    delete session.pendingFallback;
    if (this.pauseAfterStep(session, pending.item)) {
      return copySnapshot(session.snapshot);
    }
    const nextSnapshot = { ...session.snapshot };
    delete nextSnapshot.error;
    delete nextSnapshot.fallback;
    this.publish(session, {
      ...nextSnapshot,
      state: "running",
      run: session.run,
      message: "Fallback-ul a reușit. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  public skipCurrentFallback(runId: string): RunnerSnapshot {
    const session = this.requireFallbackSession(runId);
    const pending = session.pendingFallback;
    if (pending === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }
    pending.logs.push({
      level: "warning",
      message: `Fallback-ul ${pending.index + 1} a fost sărit de utilizator.`,
    });
    pending.index += 1;
    if (pending.index >= pending.item.fallbacks.length) {
      return this.finalizeExhaustedFallbacks(session, pending.primaryError);
    }
    this.publishFallbackDecision(session, pending.primaryError);
    return copySnapshot(session.snapshot);
  }

  public getStatus(projectId: string, testId: string): RunnerSnapshot {
    this.requireTest(projectId, testId);
    return copySnapshot(
      this.latestByTest.get(this.testKey(projectId, testId)) ?? {
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      },
    );
  }

  public listRuns(projectId: string, testId: string): TestRun[] {
    this.requireTest(projectId, testId);
    return this.runRepository
      .listByProject(projectId)
      .filter((run) => run.testId === testId);
  }

  public listStepResults(
    projectId: string,
    testId: string,
    runId: string,
  ): StepRunResult[] {
    this.requireTest(projectId, testId);
    const run = this.runRepository.findById(runId);
    if (
      run === undefined ||
      run.projectId !== projectId ||
      run.testId !== testId
    ) {
      throw new Error("Rularea nu există.");
    }
    return this.runRepository.listStepResults(runId);
  }

  private currentStage(session: RunnerSession): TestStage {
    const stage = session.stages[session.currentStageIndex];
    if (stage === undefined) {
      throw new StepExecutionError(
        "invalid_test",
        "Etapa curentă nu mai există în definiția testului.",
      );
    }
    return stage;
  }

  private stageBaselineKey(
    session: RunnerSession,
    stage: TestStage,
  ): string | undefined {
    return session.legacySingleFlow ? undefined : `stage:${stage.id}`;
  }

  private async prepareCurrentStage(session: RunnerSession): Promise<void> {
    if (session.stopRequested) return;
    const stage = this.currentStage(session);
    session.stageStartedAt = this.options.now().toISOString();
    session.variables.seed("stageId", stage.id, "string", "system");
    session.variables.seed(
      "stageStartedAt",
      session.stageStartedAt,
      "date_time",
      "system",
    );
    const baseSnapshot: RunnerSnapshot = {
      ...session.snapshot,
      state: "resolving_stage_entry",
      stages: structuredClone(session.stages),
      stage: {
        stageId: stage.id,
        stageIndex: session.currentStageIndex,
        totalStages: session.stages.length,
        phase: "resolving_entry",
        currentCheckIndex: 0,
        totalChecks: stage.postChecks.length,
      },
      variables: session.variables.list(true),
      currentStepIndex: 0,
      totalSteps: stage.flowItems.length,
      flowItems: structuredClone(stage.flowItems),
      checkItems: [
        ...stage.flowItems.filter(
          (item): item is CheckStep => item.type === "check" && item.enabled,
        ),
        ...stage.postChecks.filter((item) => item.enabled),
      ],
      message: `Se pregătește etapa ${session.currentStageIndex + 1} din ${session.stages.length}: ${stage.name}.`,
      canStop: true,
      canRetry: false,
    };
    delete baseSnapshot.currentStepId;
    delete baseSnapshot.error;
    delete baseSnapshot.missingVariable;
    this.publish(session, baseSnapshot);

    try {
      let targetUrl: string | undefined;
      switch (stage.entry.type) {
        case "test_start":
        case "continue_current_page":
          break;
        case "static_url":
          targetUrl = validateHttpUrl(stage.entry.url);
          break;
        case "url_template":
          targetUrl = session.variables.resolveUrlTemplate(
            stage.entry.template,
          );
          break;
        case "variable_url":
          targetUrl = session.variables.variableUrl(stage.entry.variableName);
          break;
      }
      if (targetUrl !== undefined) {
        await session.page.goto(targetUrl, { waitUntil: "domcontentloaded" });
      }
    } catch (error) {
      if (error instanceof SessionVariableError) {
        this.pauseForMissingVariable(session, {
          output: {
            name: error.variableName,
            type: stage.entry.type === "variable_url" ? "url" : "string",
            required: true,
            overwritePolicy: "deny",
          },
          stageId: stage.id,
          consumerId: `stage-entry:${stage.id}`,
          reason: error.reason,
          message: error.message,
          resume: async () => this.prepareCurrentStage(session),
          retry: async () => this.prepareCurrentStage(session),
        });
        return;
      }
      this.failStagePreparation(session, error, "stage_entry");
      return;
    }

    const mysqlChecks = stage.postChecks.filter(
      (item) => item.enabled && item.checkType === "mysql",
    );
    if (mysqlChecks.length > 0) {
      if (this.options.mysql === undefined) {
        this.failStagePreparation(
          session,
          new StepExecutionError(
            "mysql_failed",
            "Runtime-ul MySQL nu este configurat.",
          ),
          "stage_baseline",
        );
        return;
      }
      try {
        this.publish(session, {
          ...session.snapshot,
          state: "capturing_stage_baseline",
          stage: {
            ...session.snapshot.stage!,
            phase: "capturing_baseline",
          },
          message: `Se capturează baseline-ul MySQL pentru etapa „${stage.name}”.`,
        });
        const baselineKey = this.stageBaselineKey(session, stage);
        await (baselineKey === undefined
          ? this.options.mysql.captureBaseline(
              session.project.id,
              session.run.id,
              mysqlChecks,
            )
          : this.options.mysql.captureBaseline(
              session.project.id,
              session.run.id,
              mysqlChecks,
              baselineKey,
            ));
      } catch (error) {
        this.failStagePreparation(session, error, "stage_baseline");
        return;
      }
    }

    session.test.flowItems = structuredClone(stage.flowItems);
    session.postRunItems = structuredClone(stage.postChecks);
    session.postRunIndex = 0;
    const runningSnapshot: RunnerSnapshot = {
      ...session.snapshot,
      state: "running",
      currentStepIndex: 0,
      totalSteps: stage.flowItems.length,
      flowItems: structuredClone(stage.flowItems),
      variables: session.variables.list(true),
      stage: {
        ...session.snapshot.stage!,
        phase: "running_flow",
      },
      ...(stage.flowItems[0] === undefined
        ? {}
        : { currentStepId: stage.flowItems[0].id }),
      ...(this.options.mysql === undefined
        ? {}
        : { mysql: this.options.mysql.getRunDetails(session.run.id) }),
      message: `Rulează etapa „${stage.name}”.`,
    };
    this.publish(session, runningSnapshot);
    await this.continueRun(session);
  }

  private async advanceStage(session: RunnerSession): Promise<void> {
    const completedStage = this.currentStage(session);
    if (session.currentStageIndex + 1 >= session.stages.length) {
      try {
        if (session.postRunAiRequested) {
          await this.evaluatePostRunWithAi(session);
        }
      } catch (error) {
        this.failStagePreparation(session, error, "post_run_ai");
        return;
      }
      await this.finalizeRun(session);
      return;
    }
    session.currentStageIndex += 1;
    const next = this.currentStage(session);
    this.publish(session, {
      ...session.snapshot,
      state: "transitioning_stage",
      stage: {
        stageId: completedStage.id,
        stageIndex: session.currentStageIndex - 1,
        totalStages: session.stages.length,
        phase: "completed",
        currentCheckIndex: completedStage.postChecks.length,
        totalChecks: completedStage.postChecks.length,
      },
      variables: session.variables.list(true),
      message: `Etapa „${completedStage.name}” a trecut. Se pregătește „${next.name}”.`,
    });
    await this.prepareCurrentStage(session);
  }

  private failStagePreparation(
    session: RunnerSession,
    error: unknown,
    operation: string,
  ): void {
    const details = this.toRunnerError(error, undefined, operation);
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, details);
    this.publish(session, {
      ...session.snapshot,
      state: "paused_on_error",
      run: session.run,
      error: details,
      message: details.message,
      canStop: true,
      canRetry: details.retryable !== false,
    });
  }

  private async continueRun(session: RunnerSession): Promise<void> {
    while (session.snapshot.currentStepIndex < session.test.flowItems.length) {
      if (session.stopRequested) return;
      const index = session.snapshot.currentStepIndex;
      const item = session.test.flowItems[index];
      if (item === undefined) break;
      const stepStartedAt = this.options.now().toISOString();
      this.publish(session, {
        ...session.snapshot,
        state: "running",
        currentStepId: item.id,
        message: `Se execută pasul ${index + 1} din ${session.test.flowItems.length}.`,
      });

      if (!item.enabled) {
        this.saveStepResult(
          session,
          item,
          "skipped",
          {
            logs: [{ level: "info", message: "Pas dezactivat." }],
          },
          stepStartedAt,
        );
        session.snapshot.currentStepIndex += 1;
        continue;
      }

      if (session.flowOnly && item.type === "check") {
        this.saveStepResult(
          session,
          item,
          "skipped",
          {
            logs: [
              {
                level: "info",
                message:
                  "Check omis în replay-ul pentru continuarea înregistrării.",
              },
            ],
          },
          stepStartedAt,
        );
        session.snapshot.currentStepIndex += 1;
        continue;
      }

      if (
        item.type === "check" &&
        (item.checkType === "mysql" || item.checkType === "imap")
      ) {
        session.snapshot.currentStepIndex += 1;
        continue;
      }

      if (item.type === "breakpoint") {
        const previous = session.test.flowItems[index - 1];
        const next = session.test.flowItems[index + 1];
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_at_breakpoint",
          message: item.title ?? "Rularea este oprită la breakpoint.",
          pause: {
            kind: "breakpoint",
            title: item.title ?? "Breakpoint",
            ...(item.instructions === undefined
              ? {}
              : { instructions: item.instructions }),
            ...(previous === undefined ? {} : { previousStepId: previous.id }),
            ...(next === undefined ? {} : { nextStepId: next.id }),
          },
          canStop: true,
          canRetry: false,
        });
        return;
      }

      if (item.type === "manual_intervention") {
        const previous = session.test.flowItems[index - 1];
        const next = session.test.flowItems[index + 1];
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_for_manual_intervention",
          message: item.title,
          pause: {
            kind: "manual_intervention",
            title: item.title,
            instructions: item.instructions,
            ...(previous === undefined ? {} : { previousStepId: previous.id }),
            ...(next === undefined ? {} : { nextStepId: next.id }),
          },
          canStop: true,
          canRetry: false,
        });
        return;
      }

      let googlePayCdpDebug: GooglePayCdpDebugSession | undefined;
      let googlePayCdpFinished = false;
      const googlePayFlow: GooglePayFlowOptions | undefined = isGooglePayClick(
        item,
      )
        ? {
            ...(item.googlePayCardDescription?.trim()
              ? { cardDescription: item.googlePayCardDescription.trim() }
              : {}),
            ...(this.options.visualCheck?.selectGooglePayCard === undefined
              ? {}
              : {
                  selectCard: this.options.visualCheck.selectGooglePayCard,
                }),
            ...(this.options.visualCheck === undefined
              ? {}
              : { verifyOutcome: this.options.visualCheck.evaluate }),
            ...(session.runAiProvider === undefined
              ? {}
              : { aiProvider: session.runAiProvider }),
            ...(session.runAiModel === undefined
              ? {}
              : { aiModel: session.runAiModel }),
            onSelection: (input, selection) => {
              this.trackAiUsage(
                session,
                selection.provider,
                selection.model,
                selection.usage,
                {
                  reason: `Alegerea cardului Google Pay TEST pentru scenariul „${item.googlePayCardDescription?.trim() ?? "nespecificat"}”.`,
                  payload: JSON.parse(JSON.stringify(input)) as JsonValue,
                  response: JSON.parse(JSON.stringify(selection)) as JsonValue,
                },
              );
            },
            onVerification: (input, verdict, context) => {
              this.trackAiUsage(
                session,
                verdict.provider,
                verdict.model,
                verdict.usage,
                {
                  reason: `Verificarea vizuală a erorii Google Pay pentru scenariul „${item.googlePayCardDescription?.trim() ?? "nespecificat"}” (încercarea ${context.attempt}/5, suprafața ${context.surface === "google_pay" ? "Google Pay" : "comerciant"}).`,
                  payload: {
                    ...input,
                    imagesBase64: input.imagesBase64.map(
                      (image) =>
                        `[imagine omisă din JSON · ${Buffer.byteLength(image, "base64").toLocaleString("ro-RO")} bytes]`,
                    ),
                  },
                  response: JSON.parse(JSON.stringify(verdict)) as JsonValue,
                },
              );
            },
          }
        : undefined;

      try {
        const executableItem =
          item.type === "action" &&
          ["navigate", "wait_for_url"].includes(item.actionType) &&
          item.url !== undefined
            ? {
                ...item,
                url: session.variables.resolveUrlTemplate(item.url),
              }
            : item;
        googlePayCdpDebug =
          googlePayFlow !== undefined
            ? await startGooglePayCdpDebug(session.page)
            : undefined;
        if (
          googlePayFlow?.cardDescription !== undefined &&
          googlePayCdpDebug === undefined
        ) {
          throw new Error(
            "Flow-ul Google Pay este configurat, dar target-ul CDP nu poate fi controlat în această sesiune Chrome.",
          );
        }
        const result =
          item.type === "check" && item.checkType === "visual"
            ? await this.executeVisualCheck(session, item)
            : item.type === "check" && item.checkType === "adaptive"
              ? await this.executeAdaptiveCheck(session, item)
              : item.type === "action" && item.actionType === "visual_ai"
                ? await this.executeVisualAiAction(session, item)
                : item.type === "action"
                  ? googlePayFlow !== undefined
                    ? await executeFlowItem(
                        session.page,
                        executableItem,
                        session.datasetValues,
                      )
                    : await session.networkWaiter.trackAndAwait(() =>
                        executeFlowItem(
                          session.page,
                          executableItem,
                          session.datasetValues,
                        ),
                      )
                  : await executeFlowItem(
                      session.page,
                      executableItem,
                      session.datasetValues,
                    );
        if (googlePayCdpDebug !== undefined) {
          const activeGooglePayDebug = googlePayCdpDebug;
          // finishGooglePayCdpDebug își detașează sesiunea în finally, inclusiv
          // când flow-ul aruncă. Marcăm înainte ca să nu încercăm un al doilea cleanup.
          googlePayCdpFinished = true;
          let googlePayLogs: JsonValue[] = [];
          if (googlePayFlow?.cardDescription !== undefined) {
            const networkWait = await session.networkWaiter.trackActionAndAwait(
              async () => {
                googlePayLogs = await finishGooglePayCdpDebug(
                  session.page,
                  activeGooglePayDebug,
                  "success",
                  googlePayFlow,
                );
              },
              {
                includeAllRequests: true,
                timeoutMs: 10_000,
                postSettleDelayMs: 2_000,
              },
            );
            googlePayLogs.push({
              level: networkWait.settled ? "info" : "warning",
              message: networkWait.settled
                ? "Flow-ul Google Pay s-a încheiat după stabilizarea request-urilor paginii comerciantului."
                : "Flow-ul Google Pay a apăsat plata, dar request-urile paginii comerciantului nu s-au stabilizat în timeout.",
              observedRequests: networkWait.observedRequests,
              settled: networkWait.settled,
            });
          } else {
            googlePayLogs = await finishGooglePayCdpDebug(
              session.page,
              activeGooglePayDebug,
              "success",
              googlePayFlow,
            );
          }
          result.logs.push(...googlePayLogs);
        }
        if (session.stopRequested) {
          this.saveStepResult(
            session,
            item,
            "stopped",
            {
              logs: [
                ...result.logs,
                { level: "warning", message: "Rularea a fost oprită manual." },
              ],
            },
            stepStartedAt,
          );
          return;
        }
        this.saveStepResult(session, item, "passed", result, stepStartedAt);
        session.snapshot.currentStepIndex += 1;
        if (this.pauseAfterStep(session, item)) return;
      } catch (error) {
        if (typeof googlePayCdpDebug !== "undefined" && !googlePayCdpFinished) {
          await finishGooglePayCdpDebug(
            session.page,
            googlePayCdpDebug,
            "step-error",
          ).catch(() => undefined);
        }
        if (session.stopRequested) return;
        if (
          error instanceof SessionVariableError &&
          item.type === "action" &&
          ["navigate", "wait_for_url"].includes(item.actionType)
        ) {
          const exactUrlVariable = item.url?.match(
            /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/,
          );
          this.pauseForMissingVariable(session, {
            output: {
              name: error.variableName,
              type: exactUrlVariable === null ? "string" : "url",
              required: true,
              overwritePolicy: "deny",
            },
            stageId: this.currentStage(session).id,
            consumerId: item.id,
            reason: error.reason,
            message: error.message,
            resume: async () => this.continueRun(session),
          });
          return;
        }
        let details = this.toRunnerError(
          error,
          item.id,
          item.type === "action"
            ? item.actionType
            : item.type === "check"
              ? item.checkType
              : "step",
        );
        if (details.code === "missing_data" && item.type === "action") {
          try {
            const missingData = await inspectMissingInput(session.page, item);
            session.pendingMissingData = {
              item,
              startedAt: stepStartedAt,
              details: missingData,
            };
            const waitingSnapshot = { ...session.snapshot };
            delete waitingSnapshot.pause;
            delete waitingSnapshot.fallback;
            this.publish(session, {
              ...waitingSnapshot,
              state: "waiting_for_missing_data",
              run: session.run,
              message:
                "Completează valoarea direct în browser, apoi apasă Continue.",
              error: details,
              missingData,
              canStop: true,
              canRetry: false,
            });
            return;
          } catch (inspectionError) {
            details = this.toRunnerError(
              inspectionError,
              item.id,
              "inspect_missing_input",
            );
          }
        }
        if (
          item.type === "action" &&
          item.fallbacks.length > 0 &&
          ["locator_not_found", "locator_ambiguous"].includes(details.code)
        ) {
          session.pendingFallback = {
            item,
            index: 0,
            startedAt: stepStartedAt,
            primaryError: details,
            logs: [
              {
                level: "warning",
                message: `Locatorul principal a eșuat: ${details.message}`,
              },
            ],
          };
          this.publishFallbackDecision(session, details);
          if (session.mode !== "breakpoints") {
            await this.runFallbacksAutomatically(session);
          }
          return;
        }
        this.saveStepResult(
          session,
          item,
          "failed",
          { logs: [{ level: "error", message: details.message }] },
          stepStartedAt,
          details,
        );
        const endedAt = this.options.now().toISOString();
        session.run = { ...session.run, status: "failed", endedAt };
        this.runRepository.updateStatus(session.run.id, "failed", endedAt);
        this.persistRunError(session.run.id, details);
        this.publish(session, {
          ...session.snapshot,
          state: "paused_on_error",
          run: session.run,
          message: details.message,
          error: details,
          canStop: true,
          canRetry: details.retryable !== false,
        });
        return;
      }
    }

    if (session.stopRequested) return;
    await this.continuePostRun(session);
  }

  private async continuePostRun(session: RunnerSession): Promise<void> {
    await Promise.resolve();
    const stage = this.currentStage(session);
    this.publish(session, {
      ...session.snapshot,
      stage: {
        stageId: stage.id,
        stageIndex: session.currentStageIndex,
        totalStages: session.stages.length,
        phase: "running_checks",
        currentCheckIndex: session.postRunIndex,
        totalChecks: session.postRunItems.length,
      },
      variables: session.variables.list(true),
    });
    console.info("[IMAP][runner] Intrare în etapa post-run", {
      runId: session.run.id,
      nextIndex: session.postRunIndex,
      checks: session.postRunItems.map((item) => ({
        stepId: item.id,
        type: item.checkType,
        accountId:
          item.checkType === "imap"
            ? (accountIdForImapStep(item) ?? "")
            : undefined,
      })),
    });
    while (session.postRunIndex < session.postRunItems.length) {
      if (session.stopRequested) return;
      const item = session.postRunItems[session.postRunIndex];
      if (item === undefined) break;
      const stepStartedAt = this.options.now().toISOString();

      if (item.checkType === "imap") {
        console.info("[IMAP][runner] Check-ul a intrat în așteptare", {
          runId: session.run.id,
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          mailbox: "mailbox" in item.config ? (item.config.mailbox ?? "") : "",
          receivedAfter: session.stageStartedAt,
        });
        session.pendingImap = { item, startedAt: stepStartedAt };
        const imap: ImapRunDetails = {
          stepId: item.id,
          accountId: accountIdForImapStep(item) ?? "",
          status: "waiting",
          message:
            this.options.imap === undefined
              ? "Conectorul IMAP va fi configurat în setările etapelor Y–Z. Poți abandona verificarea pentru această rulare."
              : "Se așteaptă mesajul care corespunde filtrelor IMAP.",
          startedAt: stepStartedAt,
          allEvidence: session.postRunEvidence.imap,
        };
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_for_imap_check",
          imap,
          currentStepId: item.id,
          message: imap.message,
          canStop: true,
          canRetry: false,
        });
        return;
      }

      if (this.options.mysql === undefined) {
        this.failPostRunCheck(
          session,
          item,
          stepStartedAt,
          new StepExecutionError(
            "mysql_failed",
            "Runtime-ul MySQL nu este configurat.",
          ),
        );
        return;
      }

      try {
        this.publish(session, {
          ...session.snapshot,
          state: "waiting_for_mysql_check",
          currentStepId: item.id,
          message: "Se capturează și se compară snapshot-ul MySQL.",
          canStop: true,
          canRetry: false,
        });
        const baselineKey = this.stageBaselineKey(session, stage);
        const diff = await (baselineKey === undefined
          ? this.options.mysql.check(session.project.id, session.run.id, item)
          : this.options.mysql.check(
              session.project.id,
              session.run.id,
              item,
              baselineKey,
            ));
        const inserted = diff.tables.reduce(
          (total, table) => total + table.inserted.length,
          0,
        );
        const deleted = diff.tables.reduce(
          (total, table) => total + table.deleted.length,
          0,
        );
        const updated = diff.tables.reduce(
          (total, table) => total + table.updated.length,
          0,
        );
        const mysqlExtractors = (item.extractors ?? []).filter(
          (extractor) => extractor.source === "mysql",
        );
        try {
          session.variables.publish(
            extractMysqlVariables(
              mysqlExtractors,
              diff,
              session.variables,
              stage.id,
              item.id,
              this.options.mysql.getSnapshot?.(diff.currentSnapshotId),
            ),
          );
        } catch (error) {
          if (error instanceof VariableExtractionError) {
            const extractor = mysqlExtractors.find(
              (candidate) => candidate.output.name === error.variableName,
            );
            if (extractor !== undefined) {
              this.pauseForMissingVariable(session, {
                output: extractor.output,
                stageId: stage.id,
                consumerId: `stage:${session.stages[session.currentStageIndex + 1]?.id ?? "final"}`,
                producerId: item.id,
                reason: error.reason,
                message: error.message,
                ...(error.candidateCount === undefined
                  ? {}
                  : { candidateCount: error.candidateCount }),
                retry: async () => this.continuePostRun(session),
                resume: async () => {
                  this.saveStepResult(
                    session,
                    item,
                    "passed",
                    {
                      logs: [
                        {
                          level: "warning",
                          message: `Valoarea „${extractor.output.name}” a fost furnizată manual.`,
                          diffId: diff.id,
                        },
                      ],
                    },
                    stepStartedAt,
                  );
                  session.postRunIndex += 1;
                  await this.continuePostRun(session);
                },
              });
              return;
            }
          }
          throw error;
        }
        this.saveStepResult(
          session,
          item,
          "passed",
          {
            logs: [
              {
                level: "info",
                message: `Diff MySQL: ${inserted} inserate, ${deleted} șterse, ${updated} actualizate.`,
                diffId: diff.id,
              },
            ],
          },
          stepStartedAt,
        );
        session.postRunIndex += 1;
        session.snapshot = {
          ...session.snapshot,
          mysql: this.options.mysql.getRunDetails(session.run.id),
          variables: session.variables.list(true),
        };
        session.postRunEvidence.mysql = JSON.parse(
          JSON.stringify(session.snapshot.mysql),
        ) as JsonValue;
        this.persistPostRunResult(session);
      } catch (error) {
        this.failPostRunCheck(session, item, stepStartedAt, error);
        return;
      }
    }

    await this.advanceStage(session);
  }

  private async evaluatePostRunWithAi(session: RunnerSession): Promise<void> {
    const checks = normalizeTestPostRunChecks(session.test.postRunChecks);
    const hasEvidence =
      session.postRunEvidence.mysql !== undefined ||
      session.postRunEvidence.imap !== undefined;
    if (!hasEvidence || checks.aiPrompt.length === 0) return;
    if (this.options.postRunAi === undefined) {
      throw new Error("Evaluatorul AI post-run nu este configurat.");
    }
    this.publish(session, {
      ...session.snapshot,
      state: "waiting_for_ai_analysis",
      message: "AI evaluează rezultatele DB și e-mail conform instrucțiunilor.",
      canStop: true,
      canRetry: false,
    });
    const evaluationInput: PostRunAiEvaluationInput = {
      projectId: session.project.id,
      testId: session.test.id,
      runId: session.run.id,
      prompt: checks.aiPrompt,
      dataset: {
        ...(session.dataset === undefined
          ? {}
          : { id: session.dataset.id, name: session.dataset.name }),
        values: structuredClone(session.datasetValues),
      },
      evidence: structuredClone(session.postRunEvidence),
      ...(session.runAiProvider === undefined
        ? {}
        : { provider: session.runAiProvider }),
      ...(session.runAiModel === undefined
        ? {}
        : { model: session.runAiModel }),
    };
    const evaluation = await this.options.postRunAi.evaluate(evaluationInput);
    this.trackAiUsage(
      session,
      evaluation.provider,
      evaluation.model,
      evaluation.usage,
      {
        reason: "Evaluarea AI a dovezilor colectate după rularea testului.",
        payload: JSON.parse(JSON.stringify(evaluationInput)) as JsonValue,
        response: JSON.parse(JSON.stringify(evaluation)) as JsonValue,
      },
    );
    session.snapshot = {
      ...session.snapshot,
      postRunAi: evaluation,
    };
    this.persistPostRunResult(session);
    if (evaluation.status === "inconclusive") {
      session.run = this.runRepository.addWarning(session.run.id, {
        code: "post_run_ai_inconclusive",
        status: evaluation.status,
        message: evaluation.summary,
      });
    }
  }

  private failPostRunCheck(
    session: RunnerSession,
    item: CheckStep,
    startedAt: string,
    error: unknown,
  ): void {
    const details = this.toRunnerError(
      error,
      item.id,
      `post_run_${item.checkType}`,
    );
    this.saveStepResult(
      session,
      item,
      "failed",
      { logs: [{ level: "error", message: details.message }] },
      startedAt,
      details,
    );
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, details);
    this.persistPostRunResult(session);
    this.publish(session, {
      ...session.snapshot,
      state: "paused_on_error",
      run: session.run,
      message: details.message,
      error: details,
      ...(this.options.mysql === undefined
        ? session.snapshot.mysql === undefined
          ? {}
          : { mysql: session.snapshot.mysql }
        : { mysql: this.options.mysql.getRunDetails(session.run.id) }),
      canStop: true,
      canRetry: details.retryable !== false,
    });
  }

  private persistPostRunResult(session: RunnerSession): void {
    const result = JSON.parse(
      JSON.stringify({
        evidence: session.postRunEvidence,
        stages: session.stages.map(({ id, name }) => ({ id, name })),
        variables: session.variables.history(true),
        ...(session.snapshot.mysql === undefined
          ? {}
          : { mysql: session.snapshot.mysql }),
        ...(session.snapshot.imap === undefined
          ? {}
          : { imap: session.snapshot.imap }),
        ...(session.snapshot.postRunAi === undefined
          ? {}
          : { ai: session.snapshot.postRunAi }),
        ...(session.snapshot.aiCost === undefined
          ? {}
          : { aiCost: session.snapshot.aiCost }),
      }),
    ) as JsonValue;
    this.runRepository.updatePostRunResult(session.run.id, result);
    session.run = { ...session.run, postRunResult: result };
  }

  private async finalizeRun(session: RunnerSession): Promise<void> {
    this.persistPostRunResult(session);
    const endedAt = this.options.now().toISOString();
    const finalStatus =
      session.snapshot.postRunAi?.status === "failed"
        ? "failed"
        : (session.run.warnings?.length ?? 0) > 0
          ? "passed_with_warnings"
          : "passed";
    session.run = { ...session.run, status: finalStatus, endedAt };
    this.runRepository.updateStatus(session.run.id, finalStatus, endedAt);
    if (finalStatus !== "failed") await this.discardTrace(session);
    const completedSnapshot = { ...session.snapshot };
    delete completedSnapshot.currentStepId;
    delete completedSnapshot.error;
    delete completedSnapshot.pause;
    delete completedSnapshot.missingData;
    this.publish(session, {
      ...completedSnapshot,
      state: finalStatus === "failed" ? "failed" : "completed",
      run: session.run,
      currentStepIndex: session.test.flowItems.length,
      variables: session.variables.list(true),
      stage: {
        stageId: this.currentStage(session).id,
        stageIndex: session.currentStageIndex,
        totalStages: session.stages.length,
        phase: "completed",
        currentCheckIndex: session.postRunItems.length,
        totalChecks: session.postRunItems.length,
      },
      message:
        finalStatus === "failed"
          ? "Testul a eșuat la evaluarea AI post-run."
          : finalStatus === "passed_with_warnings"
            ? "Testul a trecut cu warning-uri. Verifică etapa post-run."
            : "Testul a trecut. Verifică etapa post-run.",
      canStop: false,
      canRetry: false,
    });
  }

  private saveStepResult(
    session: RunnerSession,
    item: TestFlowItem,
    status: StepRunResult["status"],
    execution: StepExecutionResult,
    startedAt: string,
    error?: RunnerErrorDetails,
    fallbackIndex?: number,
  ): void {
    const endedAt = this.options.now().toISOString();
    for (const warning of execution.warnings ?? []) {
      session.run = this.runRepository.addWarning(session.run.id, {
        code: warning.code,
        stepId: item.id,
        message: warning.message,
      });
    }
    this.runRepository.createStepResult({
      id: this.options.createId(),
      runId: session.run.id,
      stepId: item.id,
      stageId: this.currentStage(session).id,
      status,
      startedAt,
      endedAt,
      ...(execution.locatorUsed === undefined
        ? {}
        : { locatorUsed: execution.locatorUsed }),
      ...(error === undefined ? {} : { error: jsonError(error) }),
      ...(fallbackIndex === undefined ? {} : { fallbackIndex }),
      logs: execution.logs,
    });
  }

  private async executeVisualCheck(
    session: RunnerSession,
    item: CheckStep,
  ): Promise<StepExecutionResult> {
    if (!("prompt" in item.config) || typeof item.config.prompt !== "string") {
      throw new StepExecutionError(
        "invalid_test",
        "Verificarea vizuală nu are un prompt valid.",
      );
    }
    return this.evaluateVisualScreenshot(
      session,
      item.config.prompt,
      item.config.minimumConfidence ?? 0.6,
      `Verificarea vizuală pentru pasul „${item.title}”.`,
    );
  }

  private async executeVisualAiAction(
    session: RunnerSession,
    item: ActionStep,
  ): Promise<StepExecutionResult> {
    if (this.options.visualCheck?.decide === undefined) {
      throw new StepExecutionError(
        "unsupported_step",
        "Runtime-ul pentru acțiuni vizuale AI nu este configurat.",
      );
    }
    const instruction = item.visualInstruction?.trim();
    if (instruction === undefined || instruction.length < 3) {
      throw new StepExecutionError(
        "invalid_test",
        "Acțiunea vizuală AI necesită o descriere.",
      );
    }
    const savedRegion = item.visualRegion;
    const region = savedRegion ?? {
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      viewportWidth: 1,
      viewportHeight: 1,
    };
    const history: AiVisualActionInput["history"] = [];
    const logs: JsonValue[] = [];
    let actionCount = 0;
    let loadingRetryCount = 0;
    while (true) {
      const viewport = await session.page.evaluate(() => ({
        width: innerWidth,
        height: innerHeight,
        scrollX,
        scrollY,
      }));
      const viewportX = Math.max(0, region.x * viewport.width);
      const viewportY = Math.max(0, region.y * viewport.height);
      const width = Math.max(
        1,
        Math.min(region.width * viewport.width, viewport.width - viewportX),
      );
      const height = Math.max(
        1,
        Math.min(region.height * viewport.height, viewport.height - viewportY),
      );
      const image =
        savedRegion === undefined
          ? await session.page.screenshot({ type: "jpeg", quality: 80 })
          : await session.page.screenshot({
              type: "jpeg",
              quality: 80,
              clip: {
                x: viewport.scrollX + viewportX,
                y: viewport.scrollY + viewportY,
                width,
                height,
              },
            });
      const imageBase64 = image.toString("base64");
      const visualCheckDebug: VisualCheckDebug = {
        dataUrls: [`data:image/jpeg;base64,${imageBase64}`],
        mimeType: "image/jpeg",
        byteLength: image.byteLength,
        prompt: instruction,
      };
      let decision: AiVisualActionResult;
      const decisionInput: AiVisualActionInput = {
        instruction,
        imageBase64,
        mimeType: "image/jpeg",
        actionCount,
        maxActions: 5,
        history,
        ...(session.runAiProvider === undefined
          ? {}
          : { aiProvider: session.runAiProvider }),
        ...(session.runAiModel === undefined
          ? {}
          : { aiModel: session.runAiModel }),
      };
      try {
        decision = await this.options.visualCheck.decide(decisionInput);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new RunnerError("step_failed", message, {
          causeMessage: message,
          retryable: true,
          visualCheckDebug,
        });
      }
      this.trackAiUsage(
        session,
        decision.provider,
        decision.model,
        decision.usage,
        {
          reason:
            loadingRetryCount > 0
              ? `Reverificarea pasului vizual „${item.title}” după ce interfața era încă în loading (retry ${loadingRetryCount}/5).`
              : actionCount > 0
                ? `Verificarea rezultatului după acțiunea vizuală ${actionCount} din pasul „${item.title}”.`
                : `Decizia primei acțiuni pentru pasul vizual „${item.title}”.`,
          payload: JSON.parse(
            JSON.stringify({
              ...decisionInput,
              imageBase64: `[imagine omisă din JSON · ${image.byteLength.toLocaleString("ro-RO")} bytes]`,
            }),
          ) as JsonValue,
          response: JSON.parse(JSON.stringify(decision)) as JsonValue,
        },
      );
      logs.push({
        level: "info",
        visualEvaluation: logs.length + 1,
        clicksPerformed: actionCount,
        loadingRetryCount,
        status: decision.status,
        confidence: decision.confidence,
        observation: decision.observation,
        ...(decision.x === undefined ? {} : { x: decision.x }),
        ...(decision.y === undefined ? {} : { y: decision.y }),
        visualCheckDebug,
        usage: {
          inputTokens: decision.usage.inputTokens,
          outputTokens: decision.usage.outputTokens,
          totalTokens: decision.usage.totalTokens,
        },
      });
      if (decision.status === "done") {
        return { logs };
      }
      if (decision.status === "loading") {
        if (loadingRetryCount >= 5) {
          throw new RunnerError(
            "step_failed",
            "Interfața este încă în loading după 5 reîncercări vizuale.",
            { retryable: true, visualCheckDebug },
          );
        }
        loadingRetryCount += 1;
        await session.page.waitForTimeout(2_000);
        continue;
      }
      if (decision.status === "error") {
        throw new RunnerError(
          "step_failed",
          `AI a detectat o eroare vizibilă în pagină: ${decision.observation}`,
          {
            retryable: true,
            severity: "warning",
            visualCheckDebug,
          },
        );
      }
      if (decision.status === "failed") {
        throw new RunnerError(
          "step_failed",
          `AI nu a putut finaliza acțiunea vizuală: ${decision.observation}`,
          { retryable: true, visualCheckDebug },
        );
      }
      if (actionCount >= 5) {
        throw new RunnerError(
          "step_failed",
          "Acțiunea vizuală nu a fost finalizată în maximum 5 clickuri.",
          { retryable: true, visualCheckDebug },
        );
      }
      if (decision.x === undefined || decision.y === undefined) {
        throw new RunnerError(
          "step_failed",
          "AI a cerut un click fără coordonate valide.",
          { retryable: true, visualCheckDebug },
        );
      }
      const clickX = viewportX + decision.x * width;
      const clickY = viewportY + decision.y * height;
      const networkWait = await session.networkWaiter.trackActionAndAwait(
        () => session.page.mouse.click(clickX, clickY),
        {
          includeAllRequests: true,
          timeoutMs: 10_000,
          postSettleDelayMs: 2_000,
        },
      );
      logs.push({
        level: networkWait.settled ? "info" : "warning",
        message: networkWait.settled
          ? `După click s-au finalizat ${networkWait.observedRequests} requesturi; UI-ul a mai fost lăsat 2 secunde să se stabilizeze.`
          : "Unele requesturi pornite de click nu s-au finalizat în 10 secunde; UI-ul a mai fost lăsat 2 secunde înainte de recaptură.",
        observedRequests: networkWait.observedRequests,
        settled: networkWait.settled,
      });
      history.push({
        actionNumber: actionCount + 1,
        x: decision.x,
        y: decision.y,
        observation: decision.observation,
      });
      actionCount += 1;
      loadingRetryCount = 0;
    }
  }

  private async evaluateVisualScreenshot(
    session: RunnerSession,
    prompt: string,
    minimumConfidence: number,
    reason: string,
  ): Promise<StepExecutionResult> {
    if (this.options.visualCheck === undefined) {
      throw new StepExecutionError(
        "unsupported_step",
        "Runtime-ul pentru verificări vizuale AI nu este configurat.",
      );
    }
    // Așteptăm stabilizarea scroll-ului (max 2 secunde) în caz că există un auto-scroll către o eroare
    await session.page
      .evaluate(() => {
        return new Promise<void>((resolve) => {
          let lastY = window.scrollY;
          let stableCount = 0;
          const interval = setInterval(() => {
            if (window.scrollY === lastY) {
              stableCount++;
              if (stableCount >= 3) {
                clearInterval(interval);
                resolve();
              }
            } else {
              lastY = window.scrollY;
              stableCount = 0;
            }
          }, 100);
          setTimeout(() => {
            clearInterval(interval);
            resolve();
          }, 2000);
        });
      })
      .catch(() => {});

    // Încă o scurtă pauză pentru eventuale animații CSS (fade-in)
    await session.page.waitForTimeout(300).catch(() => {});

    const originalViewport =
      typeof session.page.viewportSize === "function"
        ? session.page.viewportSize()
        : null;
    const rawCurrentScrollY = await session.page
      .evaluate(() => window.scrollY)
      .catch(() => 0);
    const currentScrollY =
      typeof rawCurrentScrollY === "number" ? rawCurrentScrollY : 0;
    const chunkWidth = 1920;
    const chunkHeight = 1080;
    const overlap = 400; // Overlap extins pentru meniuri sticky masive
    const stepHeight = chunkHeight - overlap;

    if (typeof session.page.setViewportSize === "function") {
      await session.page
        .setViewportSize({ width: chunkWidth, height: chunkHeight })
        .catch(() => {});
    }

    const evaluateResult = await session.page
      .evaluate(() => ({
        scrollHeight: Math.max(1, document.documentElement.scrollHeight),
      }))
      .catch(() => ({ scrollHeight: chunkHeight }));
    const scrollHeight =
      typeof evaluateResult?.scrollHeight === "number"
        ? evaluateResult.scrollHeight
        : chunkHeight;

    const imagesBase64: string[] = [];
    const dataUrls: string[] = [];
    let byteLength = 0;

    // Calculăm cele 3 secțiuni (deasupra, curent, dedesubt)
    const rawYs = [
      currentScrollY - stepHeight,
      currentScrollY,
      currentScrollY + stepHeight,
    ];

    const targetYs: number[] = [];
    for (let y of rawYs) {
      if (y < 0) y = 0;
      if (y >= scrollHeight && targetYs.length > 0) continue;

      // Evităm duplicatele (capturi prea apropiate, ex. la top of page)
      if (!targetYs.some((existingY) => Math.abs(existingY - y) < 100)) {
        targetYs.push(y);
      }
    }
    targetYs.sort((a, b) => a - b);

    for (const y of targetYs) {
      await session.page
        .evaluate((yPos) => {
          const htmlStyle = document.documentElement.style.scrollBehavior;
          const bodyStyle = document.body.style.scrollBehavior;
          document.documentElement.style.scrollBehavior = "auto";
          document.body.style.scrollBehavior = "auto";
          window.scrollTo({ top: yPos, left: 0, behavior: "instant" });
          document.documentElement.style.scrollBehavior = htmlStyle;
          document.body.style.scrollBehavior = bodyStyle;
        }, y)
        .catch(() => {});
      await session.page.waitForTimeout(100).catch(() => {});

      const evaluateY = await session.page
        .evaluate(() => window.scrollY)
        .catch(() => y);
      const actualY = typeof evaluateY === "number" ? evaluateY : y;
      const clipHeight = Math.min(chunkHeight, Math.max(1, scrollHeight - y));
      if (clipHeight <= 0) break;

      const clipY = y - actualY;

      const image = await session.page.screenshot({
        clip: {
          x: 0,
          y: Math.max(0, clipY),
          width: chunkWidth,
          height: clipHeight,
        },
        type: "jpeg",
        quality: 70,
        animations: "disabled",
        caret: "hide",
      });
      const base64 = image.toString("base64");
      imagesBase64.push(base64);
      dataUrls.push(`data:image/jpeg;base64,${base64}`);
      byteLength += image.byteLength;
    }

    await session.page
      .evaluate((yPos) => {
        const htmlStyle = document.documentElement.style.scrollBehavior;
        const bodyStyle = document.body.style.scrollBehavior;
        document.documentElement.style.scrollBehavior = "auto";
        document.body.style.scrollBehavior = "auto";
        window.scrollTo({ top: yPos, left: 0, behavior: "instant" });
        document.documentElement.style.scrollBehavior = htmlStyle;
        document.body.style.scrollBehavior = bodyStyle;
      }, currentScrollY)
      .catch(() => {});
    if (
      originalViewport &&
      typeof session.page.setViewportSize === "function"
    ) {
      await session.page.setViewportSize(originalViewport).catch(() => {});
    }

    const visualCheckDebug: VisualCheckDebug = {
      dataUrls,
      mimeType: "image/jpeg",
      byteLength,
      prompt,
    };
    let verdict: AiVisualCheckResult;
    const visualInput: AiVisualCheckInput = {
      prompt,
      imagesBase64,
      mimeType: "image/jpeg",
      ...(session.runAiProvider === undefined
        ? {}
        : { aiProvider: session.runAiProvider }),
      ...(session.runAiModel === undefined
        ? {}
        : { aiModel: session.runAiModel }),
    };
    try {
      verdict = await this.options.visualCheck.evaluate(visualInput);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new RunnerError("step_failed", message, {
        causeMessage: message,
        retryable: true,
        visualCheckDebug,
      });
    }
    this.trackAiUsage(session, verdict.provider, verdict.model, verdict.usage, {
      reason,
      payload: {
        ...visualInput,
        imagesBase64: imagesBase64.map(
          (image) =>
            `[imagine omisă din JSON · ${Buffer.byteLength(image, "base64").toLocaleString("ro-RO")} bytes]`,
        ),
      },
      response: JSON.parse(JSON.stringify(verdict)) as JsonValue,
    });
    const evidence = verdict.evidence.slice(0, 5);
    if (!verdict.passed || verdict.confidence < minimumConfidence) {
      const confidenceReason =
        verdict.confidence < minimumConfidence
          ? ` Încrederea ${Math.round(verdict.confidence * 100)}% este sub pragul ${Math.round(minimumConfidence * 100)}%.`
          : "";
      const evidenceReason =
        evidence.length === 0 ? "" : ` Dovezi: ${evidence.join("; ")}.`;
      throw new RunnerError(
        "step_failed",
        `Verificarea vizuală a eșuat: ${verdict.explanation}.${confidenceReason}${evidenceReason}`,
        { retryable: true, visualCheckDebug },
      );
    }
    return {
      logs: [
        {
          level: "info",
          message: `Verificare vizuală reușită (${Math.round(verdict.confidence * 100)}% încredere): ${verdict.explanation}`,
          provider: verdict.provider,
          model: verdict.model,
          confidence: verdict.confidence,
          minimumConfidence,
          evidence,
          visualCheckDebug,
          usage: {
            inputTokens: verdict.usage.inputTokens,
            outputTokens: verdict.usage.outputTokens,
            totalTokens: verdict.usage.totalTokens,
          },
        },
      ],
    };
  }

  private trackAiUsage(
    session: RunnerSession,
    provider: Exclude<AiProviderId, "none">,
    model: string,
    usage: { inputTokens: number; outputTokens: number; totalTokens: number },
    context: AiUsageContext,
  ): void {
    const previous = session.snapshot.aiCost;
    const local = provider === "ollama" || provider === "lm_studio";
    let requestCost: number | undefined;
    try {
      requestCost = this.options.aiPricing?.estimateCachedCost(
        provider,
        model,
        usage,
      );
    } catch {
      requestCost = undefined;
    }
    session.snapshot = {
      ...session.snapshot,
      aiCost: {
        requestCount: (previous?.requestCount ?? 0) + 1,
        inputTokens: (previous?.inputTokens ?? 0) + usage.inputTokens,
        outputTokens: (previous?.outputTokens ?? 0) + usage.outputTokens,
        totalTokens: (previous?.totalTokens ?? 0) + usage.totalTokens,
        estimatedUsd: (previous?.estimatedUsd ?? 0) + (requestCost ?? 0),
        unpricedRequests:
          (previous?.unpricedRequests ?? 0) +
          (!local && requestCost === undefined ? 1 : 0),
        localOnly: previous === undefined ? local : previous.localOnly && local,
        requests: [
          ...(previous?.requests ?? []),
          {
            id: this.options.createId(),
            reason: context.reason,
            provider,
            model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            totalTokens: usage.totalTokens,
            ...(requestCost === undefined ? {} : { estimatedUsd: requestCost }),
            local,
            payload: context.payload,
            response: context.response,
            createdAt: this.options.now().toISOString(),
          },
        ],
      },
    };
    this.persistPostRunResult(session);
  }

  private normalizeAdaptiveText(
    value: string,
    caseSensitive: boolean,
    ignoreDiacritics: boolean,
  ): string {
    let normalized = value.replace(/\s+/g, " ").trim();
    if (!caseSensitive) normalized = normalized.toLocaleLowerCase("ro");
    if (ignoreDiacritics) {
      normalized = normalized.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    }
    return normalized;
  }

  private async executeAdaptiveDomCheck(
    session: RunnerSession,
    item: CheckStep,
  ): Promise<StepExecutionResult> {
    if (
      !("strategy" in item.config) ||
      item.config.expectedTexts.length === 0
    ) {
      throw new StepExecutionError(
        "invalid_test",
        "Verificarea adaptivă DOM nu are mesaje așteptate.",
      );
    }
    const config = item.config;
    const timeoutMs = item.timeoutMs ?? 5_000;
    const deadline = Date.now() + timeoutMs;
    const caseSensitive = config.caseSensitive ?? false;
    const ignoreDiacritics = config.ignoreDiacritics ?? true;
    const expectedTexts = config.expectedTexts.map((text) =>
      this.normalizeAdaptiveText(text, caseSensitive, ignoreDiacritics),
    );
    let shouldContinue = true;
    while (shouldContinue) {
      const locator =
        config.target === undefined
          ? session.page.locator("body")
          : await resolveUniqueLocator(session.page, config.target, {
              waitForMs: 0,
              waitForState: "visible",
            });
      const lastText = await locator.innerText();
      const normalizedText = this.normalizeAdaptiveText(
        lastText,
        caseSensitive,
        ignoreDiacritics,
      );
      const normalizedLines = lastText
        .split(/\r?\n/)
        .map((line) =>
          this.normalizeAdaptiveText(line, caseSensitive, ignoreDiacritics),
        )
        .filter(Boolean);
      const matches = expectedTexts.map((expected) =>
        config.matchMode === "exact"
          ? config.target === undefined
            ? normalizedLines.includes(expected)
            : normalizedText === expected
          : normalizedText.includes(expected),
      );
      const passed =
        config.matchMode === "all"
          ? matches.every(Boolean)
          : matches.some(Boolean);
      if (passed) {
        return {
          logs: [
            {
              level: "info",
              message: `Verificare DOM adaptivă reușită: ${config.matchMode === "all" ? "toate mesajele" : "un mesaj acceptat"} au fost găsite.`,
              strategy: "dom",
              expectedTexts: config.expectedTexts,
              matchMode: config.matchMode,
            },
          ],
        };
      }
      shouldContinue = Date.now() < deadline;
      if (!shouldContinue) break;
      await session.page.waitForTimeout(Math.min(250, deadline - Date.now()));
    }
    throw new StepExecutionError(
      "step_failed",
      `Verificarea DOM nu a găsit mesajele așteptate: ${config.expectedTexts.join(" | ")}.`,
    );
  }

  private async executeAdaptiveCheck(
    session: RunnerSession,
    item: CheckStep,
  ): Promise<StepExecutionResult> {
    if (!("strategy" in item.config)) {
      throw new StepExecutionError(
        "invalid_test",
        "Configurația verificării adaptive este invalidă.",
      );
    }
    const config = item.config;
    const shouldUseDom =
      config.strategy === "dom" ||
      (config.strategy === "auto" && config.expectedTexts.length > 0);
    const visualPrompt =
      config.visualPrompt?.trim() || item.humanDescription.trim() || item.title;
    if (!shouldUseDom) {
      return this.evaluateVisualScreenshot(
        session,
        visualPrompt,
        config.minimumConfidence ?? 0.6,
        `Verificarea adaptivă vizuală pentru pasul „${item.title}”.`,
      );
    }
    try {
      return await this.executeAdaptiveDomCheck(session, item);
    } catch (error) {
      if (!config.visualFallback) throw error;
      const visual = await this.evaluateVisualScreenshot(
        session,
        visualPrompt,
        config.minimumConfidence ?? 0.6,
        `Fallback vizual după ce verificarea DOM a pasului „${item.title}” a fost neconcludentă.`,
      );
      return {
        ...visual,
        logs: [
          {
            level: "warning",
            message:
              `Verificarea DOM a fost neconcludentă; s-a folosit fallback-ul vizual. ${error instanceof Error ? error.message : ""}`.trim(),
          },
          ...visual.logs,
        ],
      };
    }
  }

  public async manualWipe(
    runId: string,
    resources: ManualWipeResource[],
  ): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    if (
      !["completed", "stopped", "failed", "paused_on_error"].includes(
        session.snapshot.state,
      )
    ) {
      throw new Error("Wipe-ul manual este disponibil numai după rulare.");
    }
    if (resources.length === 0) {
      throw new Error("Selectează cel puțin un tip de date pentru wipe.");
    }
    const allowed = new Set<ManualWipeResource>(MANUAL_WIPE_RESOURCES);
    if (resources.some((resource) => !allowed.has(resource))) {
      throw new Error("Selecția pentru wipe conține o resursă necunoscută.");
    }

    let cleanup: WipeDetails;
    try {
      cleanup = await wipeBrowserStateForOrigin(
        this.browser.getRunnerContext(session.project.id),
        session.page,
        session.test.startUrl,
        { reloadStartPage: false, resources },
      );
    } catch (error) {
      cleanup =
        error instanceof WipeError
          ? error.result
          : {
              origin: new URL(session.test.startUrl).origin,
              status: "failed" as const,
              entries: [
                {
                  resource: "navigation" as const,
                  status: "failed" as const,
                  message:
                    error instanceof Error
                      ? error.message
                      : "Curățarea sesiunii a eșuat.",
                },
              ],
            };
    }
    this.publish(session, {
      ...session.snapshot,
      cleanup,
      message:
        cleanup.status === "completed"
          ? "Wipe-ul manual selectat a fost finalizat."
          : "Wipe-ul manual a întâmpinat erori. Verifică rezultatele.",
    });
    return copySnapshot(session.snapshot);
  }

  public async pollImapCheck(runId: string): Promise<RunnerSnapshot> {
    console.info("[IMAP][runner] Poll solicitat de interfață", {
      runId,
      requestedAt: this.options.now().toISOString(),
    });
    const session = this.requireSession(runId);
    const pending = session.pendingImap;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_imap_check"
    ) {
      console.warn("[IMAP][runner] Poll ignorat: nu există un check pending", {
        runId,
        state: session.snapshot.state,
        hasPendingImap: pending !== undefined,
      });
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }

    const checkedAt = this.options.now().toISOString();
    if (this.options.imap === undefined) {
      console.warn("[IMAP][runner] Conectorul IMAP nu este disponibil", {
        runId,
        stepId: pending.item.id,
      });
      this.publish(session, {
        ...session.snapshot,
        imap: {
          ...(session.snapshot.imap ?? {
            stepId: pending.item.id,
            status: "waiting" as const,
            message: "Conectorul IMAP nu este configurat.",
            startedAt: pending.startedAt,
          }),
          lastCheckedAt: checkedAt,
        },
      });
      return copySnapshot(session.snapshot);
    }

    console.info("[IMAP][runner] Execută interogarea IMAP", {
      runId,
      stepId: pending.item.id,
      accountId: accountIdForImapStep(pending.item) ?? "",
      receivedAfter: session.run.startedAt,
    });
    let result: Awaited<ReturnType<RunnerImapGateway["check"]>>;
    try {
      result = await this.options.imap.check(
        session.project.id,
        session.run.id,
        pending.item,
        session.stageStartedAt,
      );
    } catch (error) {
      console.error("[IMAP][runner] Interogarea IMAP a eșuat", {
        runId,
        stepId: pending.item.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
    console.info("[IMAP][runner] Rezultat poll IMAP", {
      runId,
      stepId: pending.item.id,
      matched: result.matched,
      message: result.message,
      hasEvidence: result.evidence !== undefined,
    });
    let evidence = result.evidence;
    if (result.matched) {
      const messages = imapEvidenceMessages(evidence);
      const consumed = consumedImapMessageKeys(session.postRunEvidence.imap);
      const availableMessages = messages.filter(
        (message) => !consumed.has(imapMessageKey(message)),
      );
      if (messages.length > 0 && availableMessages.length === 0) {
        result = {
          matched: false,
          message:
            "Mesajele găsite au fost deja folosite de un check IMAP anterior; se așteaptă un mesaj nou.",
        };
        evidence = undefined;
      } else if (
        evidence !== undefined &&
        availableMessages.length !== messages.length
      ) {
        evidence = {
          ...(evidence as Record<string, JsonValue>),
          messages: JSON.parse(JSON.stringify(availableMessages)) as JsonValue,
        };
      }
    }
    if (!result.matched) {
      this.publish(session, {
        ...session.snapshot,
        imap: {
          stepId: pending.item.id,
          accountId: accountIdForImapStep(pending.item) ?? "",
          status: "waiting",
          message: result.message,
          startedAt: pending.startedAt,
          lastCheckedAt: checkedAt,
          allEvidence: session.postRunEvidence.imap,
        },
        message: result.message,
      });
      return copySnapshot(session.snapshot);
    }

    evidence =
      evidence ??
      ({
        matched: true,
        message: result.message,
      } satisfies JsonValue);
    const previousEvidence = session.postRunEvidence.imap;
    const previousChecks =
      typeof previousEvidence === "object" &&
      previousEvidence !== null &&
      !Array.isArray(previousEvidence) &&
      "checks" in previousEvidence &&
      Array.isArray(previousEvidence.checks)
        ? previousEvidence.checks
        : [];
    session.postRunEvidence.imap = {
      checks: [...previousChecks, evidence],
    };
    const evidenceRecord =
      typeof evidence === "object" &&
      evidence !== null &&
      !Array.isArray(evidence)
        ? evidence
        : {};
    const matchedMessages = Array.isArray(evidenceRecord.messages)
      ? (evidenceRecord.messages as unknown as ImapMatchedMessage[])
      : [];
    const stage = this.currentStage(session);
    const imapExtractors = (pending.item.extractors ?? []).filter(
      (extractor) => extractor.source === "imap",
    );
    try {
      session.variables.publish(
        extractImapVariables(
          imapExtractors,
          matchedMessages,
          stage.id,
          pending.item.id,
        ),
      );
    } catch (error) {
      if (error instanceof VariableExtractionError) {
        const extractor = imapExtractors.find(
          (candidate) => candidate.output.name === error.variableName,
        );
        if (extractor !== undefined) {
          this.pauseForMissingVariable(session, {
            output: extractor.output,
            stageId: stage.id,
            consumerId: `stage:${session.stages[session.currentStageIndex + 1]?.id ?? "final"}`,
            producerId: pending.item.id,
            reason: error.reason,
            message: error.message,
            ...(error.candidateCount === undefined
              ? {}
              : { candidateCount: error.candidateCount }),
            retry: async () => {
              this.publish(session, {
                ...session.snapshot,
                state: "waiting_for_imap_check",
                message: "Se reîncearcă verificarea IMAP.",
              });
              await this.pollImapCheck(session.run.id);
            },
            resume: async () => {
              this.saveStepResult(
                session,
                pending.item,
                "passed",
                {
                  logs: [
                    {
                      level: "warning",
                      message: `Valoarea „${extractor.output.name}” a fost furnizată manual.`,
                      evidence,
                    },
                  ],
                },
                pending.startedAt,
              );
              session.postRunIndex += 1;
              delete session.pendingImap;
              this.persistPostRunResult(session);
              await this.continuePostRun(session);
            },
          });
          return copySnapshot(session.snapshot);
        }
      }
      throw error;
    }
    this.saveStepResult(
      session,
      pending.item,
      "passed",
      {
        logs: [{ level: "info", message: result.message, evidence }],
      },
      pending.startedAt,
    );
    session.postRunIndex += 1;
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "running",
      imap: {
        stepId: pending.item.id,
        accountId: accountIdForImapStep(pending.item) ?? "",
        status: "matched",
        message: result.message,
        startedAt: pending.startedAt,
        lastCheckedAt: checkedAt,
        matchedAt: checkedAt,
        ...(typeof evidenceRecord.accountName === "string"
          ? { accountName: evidenceRecord.accountName }
          : {}),
        ...(matchedMessages.length === 0 ? {} : { matchedMessages }),
        allEvidence: session.postRunEvidence.imap,
      },
      message: result.message,
      variables: session.variables.list(true),
    });
    this.persistPostRunResult(session);
    await this.continuePostRun(session);
    return copySnapshot(session.snapshot);
  }

  public async abandonImapCheck(runId: string): Promise<RunnerSnapshot> {
    const session = this.requireSession(runId);
    const pending = session.pendingImap;
    if (
      pending === undefined ||
      session.snapshot.state !== "waiting_for_imap_check"
    ) {
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }

    const message = `Verificarea IMAP „${pending.item.title}” a fost abandonată manual.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "imap_check_abandoned",
      stepId: pending.item.id,
      message,
    });
    this.saveStepResult(
      session,
      pending.item,
      "skipped",
      { logs: [{ level: "warning", message }] },
      pending.startedAt,
    );
    session.postRunIndex += 1;
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "running",
      run: session.run,
      imap: {
        stepId: pending.item.id,
        status: "abandoned",
        message,
        startedAt: pending.startedAt,
        lastCheckedAt: this.options.now().toISOString(),
        allEvidence: session.postRunEvidence.imap,
      },
      message,
    });
    this.persistPostRunResult(session);
    await this.continuePostRun(session);
    return copySnapshot(session.snapshot);
  }

  private failPendingImap(session: RunnerSession): RunnerSnapshot {
    const pending = session.pendingImap;
    if (pending === undefined) {
      throw new Error("Nu există o verificare IMAP în așteptare.");
    }
    const endedAt = this.options.now().toISOString();
    const message = `Verificarea IMAP „${pending.item.title}” a fost oprită manual și a eșuat.`;
    const error: RunnerErrorDetails = {
      code: "imap_failed",
      stepId: pending.item.id,
      message,
      operation: "post_run_imap",
      technicalDetails: "Verificarea IMAP a fost oprită manual.",
      occurredAt: endedAt,
      retryable: false,
    };
    this.saveStepResult(
      session,
      pending.item,
      "failed",
      { logs: [{ level: "error", message }] },
      pending.startedAt,
      error,
    );
    session.stopRequested = true;
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, error);
    delete session.pendingImap;
    this.publish(session, {
      ...session.snapshot,
      state: "failed",
      run: session.run,
      imap: {
        stepId: pending.item.id,
        accountId: accountIdForImapStep(pending.item) ?? "",
        status: "abandoned",
        message,
        startedAt: pending.startedAt,
        lastCheckedAt: endedAt,
        allEvidence: session.postRunEvidence.imap,
      },
      error,
      message,
      canStop: false,
      canRetry: false,
    });
    return copySnapshot(session.snapshot);
  }

  private async continueMissingData(
    session: RunnerSession,
  ): Promise<RunnerSnapshot> {
    const pending = session.pendingMissingData;
    if (pending === undefined) {
      throw new Error("Nu există date lipsă în așteptare.");
    }

    let value: string | number | boolean | null;
    try {
      value = await readManualInputValue(session.page, pending.details);
    } catch (error) {
      const details = this.toRunnerError(error, pending.item.id);
      this.publish(session, {
        ...session.snapshot,
        state: "waiting_for_missing_data",
        message: details.message,
        error: details,
        canStop: true,
        canRetry: false,
      });
      return copySnapshot(session.snapshot);
    }

    if (pending.details.inputKind !== "file") {
      this.persistManualValue(session, pending.details.valueKey, value);
    }
    const warningMessage =
      pending.details.inputKind === "file"
        ? `Fișierul pentru ${pending.details.fieldId} a fost selectat manual numai pentru această rulare.`
        : pending.details.inputKind === "password"
          ? `Valoarea pentru ${pending.details.fieldId} a fost colectată manual și salvată local în clar.`
          : `Valoarea pentru ${pending.details.fieldId} a fost colectată manual.`;
    session.run = this.runRepository.addWarning(session.run.id, {
      code: "manual_data_collected",
      stepId: pending.item.id,
      fieldId: pending.details.fieldId,
      message: warningMessage,
    });
    this.saveStepResult(
      session,
      pending.item,
      "passed",
      {
        locatorUsed: JSON.parse(
          JSON.stringify(pending.details.locator),
        ) as JsonValue,
        logs: [{ level: "warning", message: warningMessage }],
      },
      pending.startedAt,
    );
    session.snapshot.currentStepIndex += 1;
    delete session.pendingMissingData;
    const resumedSnapshot = { ...session.snapshot };
    delete resumedSnapshot.error;
    delete resumedSnapshot.missingData;
    this.publish(session, {
      ...resumedSnapshot,
      state: "running",
      run: session.run,
      message:
        pending.details.inputKind === "file"
          ? "Fișierul selectat manual a fost acceptat. Rularea continuă."
          : "Valoarea manuală a fost salvată. Rularea continuă.",
      canStop: true,
      canRetry: false,
    });
    if (this.pauseAfterStep(session, pending.item)) {
      return copySnapshot(session.snapshot);
    }
    void this.continueRun(session);
    return copySnapshot(session.snapshot);
  }

  private persistManualValue(
    session: RunnerSession,
    valueKey: string,
    value: string | number | boolean | null,
  ): void {
    const now = this.options.now();
    let dataset = session.dataset;
    if (dataset === undefined) {
      dataset = {
        id: this.options.createId(),
        testId: session.test.id,
        name: `Run ${now.toISOString().slice(0, 16).replace("T", " ")}`,
        values: {},
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      this.datasetRepository.create(dataset);
      this.runRepository.assignDataset(session.run.id, dataset.id);
      session.run = { ...session.run, datasetId: dataset.id };
    }

    const updated: TestDataset = {
      ...dataset,
      values: {
        ...dataset.values,
        [valueKey]: { type: "fixed", value },
      },
      updatedAt: now.toISOString(),
    };
    this.datasetRepository.update(updated);
    session.dataset = updated;
    session.datasetValues[valueKey] = value === null ? "" : String(value);
    const datasetSnapshot = {
      id: updated.id,
      name: updated.name,
      values: structuredClone(session.datasetValues),
    };
    this.runRepository.updateDatasetSnapshot(session.run.id, datasetSnapshot);
    session.run = { ...session.run, datasetSnapshot };
  }

  private pauseAfterStep(session: RunnerSession, item: TestFlowItem): boolean {
    if (
      session.mode !== "step_by_step" ||
      (item.type !== "action" && item.type !== "check") ||
      session.snapshot.currentStepIndex >= session.test.flowItems.length
    ) {
      return false;
    }
    const next = session.test.flowItems[session.snapshot.currentStepIndex];
    const waitingSnapshot = { ...session.snapshot };
    delete waitingSnapshot.error;
    delete waitingSnapshot.fallback;
    this.publish(session, {
      ...waitingSnapshot,
      state: "waiting_after_step",
      run: session.run,
      message: "Mod pas cu pas: confirmă următorul pas.",
      pause: {
        kind: "after_step",
        title: `Pas finalizat: ${item.title}`,
        previousStepId: item.id,
        ...(next === undefined ? {} : { nextStepId: next.id }),
      },
      canStop: true,
      canRetry: false,
    });
    return true;
  }

  private persistSuccessfulFallback(
    session: RunnerSession,
    stepId: string,
    locator: LocatorDefinition,
  ): boolean {
    const stored = this.testRepository.findById(session.test.id);
    if (stored === undefined || stored.projectId !== session.project.id) {
      return false;
    }
    const repaired = promoteSuccessfulFallback(
      stored,
      stepId,
      locator,
      this.options.now().toISOString(),
    );
    if (repaired === undefined) return false;
    this.testRepository.update(repaired.test);

    const sessionRepair = promoteSuccessfulFallback(
      session.test,
      stepId,
      locator,
      repaired.test.updatedAt,
    );
    if (sessionRepair !== undefined) {
      session.test = {
        ...sessionRepair.test,
        version: repaired.test.version,
      };
      session.snapshot.flowItems = structuredClone(session.test.flowItems);
    }
    return true;
  }

  private publishFallbackDecision(
    session: RunnerSession,
    error: RunnerErrorDetails,
  ): void {
    const pending = session.pendingFallback;
    const fallback = pending?.item.fallbacks[pending.index];
    if (pending === undefined || fallback === undefined) {
      throw new Error("Fallback-ul curent nu există.");
    }
    this.publish(session, {
      ...session.snapshot,
      state: "waiting_for_fallback_decision",
      run: session.run,
      message: `Locatorul principal a eșuat. Alege ce faci cu fallback-ul ${pending.index + 1} din ${pending.item.fallbacks.length}.`,
      error,
      fallback: this.toFallbackDecision(
        fallback,
        pending.index,
        pending.item.fallbacks.length,
      ),
      canStop: true,
      canRetry: false,
    });
  }

  private async runFallbacksAutomatically(
    session: RunnerSession,
  ): Promise<void> {
    while (
      !session.stopRequested &&
      session.pendingFallback !== undefined &&
      session.snapshot.state === "waiting_for_fallback_decision"
    ) {
      await this.runCurrentFallback(session.run.id);
    }
  }

  private finalizeExhaustedFallbacks(
    session: RunnerSession,
    lastError: RunnerErrorDetails,
  ): RunnerSnapshot {
    const pending = session.pendingFallback;
    if (pending === undefined) {
      throw new Error("Nu există fallback-uri în așteptare.");
    }
    const exhaustedError: RunnerErrorDetails = {
      ...lastError,
      message: `Toate fallback-urile au fost epuizate. ${lastError.message}`,
      stepId: pending.item.id,
    };
    this.saveStepResult(
      session,
      pending.item,
      "failed",
      {
        logs: [
          ...pending.logs,
          {
            level: "error",
            message: exhaustedError.message,
          },
        ],
      },
      pending.startedAt,
      exhaustedError,
    );
    const endedAt = this.options.now().toISOString();
    session.run = { ...session.run, status: "failed", endedAt };
    this.runRepository.updateStatus(session.run.id, "failed", endedAt);
    this.persistRunError(session.run.id, exhaustedError);
    delete session.pendingFallback;
    const failedSnapshot = { ...session.snapshot };
    delete failedSnapshot.fallback;
    this.publish(session, {
      ...failedSnapshot,
      state: "paused_on_error",
      run: session.run,
      message: exhaustedError.message,
      error: exhaustedError,
      canStop: true,
      canRetry: exhaustedError.retryable !== false,
    });
    return copySnapshot(session.snapshot);
  }

  private toFallbackDecision(
    fallback: LocatorFallback,
    index: number,
    total: number,
  ): NonNullable<RunnerSnapshot["fallback"]> {
    return {
      index,
      total,
      humanDescription: fallback.humanDescription,
      whyExplanation: fallback.whyExplanation,
      locator: structuredClone(fallback.locator),
    };
  }

  private async prepareBrowser(
    project: Project,
    test: TestDefinition,
  ): Promise<void> {
    const status = this.browser.getStatus();
    if (
      activeBrowserStates.has(status.state) &&
      status.projectId !== project.id
    ) {
      throw new Error("Browserul activ aparține altui proiect.");
    }
    if (!activeBrowserStates.has(status.state)) {
      throw new StepExecutionError(
        "browser_unavailable",
        "Deschide browserul proiectului din secțiunea Browser înainte să pornești testul.",
      );
    }
    const navigation = await this.browser.openProjectUrl(
      project.id,
      test.startUrl,
    );
    if (navigation.state !== "opened") {
      throw new Error("Autentificarea HTTP trebuie finalizată înainte de run.");
    }
  }

  private assertRunnable(test: TestDefinition, datasets: TestDataset[]): void {
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, test.flowItems, datasets),
    );
    if (
      !validation.valid ||
      (test.status !== "valid" && test.status !== "invalidated") ||
      test.workflowState !== "ready"
    ) {
      throw new StepExecutionError(
        "invalid_test",
        "Testul trebuie să fie valid și pregătit de rulare.",
      );
    }
  }

  private selectDataset(
    datasets: TestDataset[],
    datasetId: string | undefined,
  ): TestDataset | undefined {
    if (datasetId === undefined) return undefined;
    const dataset = datasets.find((candidate) => candidate.id === datasetId);
    if (dataset === undefined) {
      throw new StepExecutionError(
        "dataset_missing",
        "Dataset-ul selectat nu există pentru acest test.",
      );
    }
    return dataset;
  }

  private findPageVersionIds(items: TestFlowItem[]): string[] {
    const ids = new Set<string>();
    for (const item of items) {
      if (item.type !== "action" || item.pageId === undefined) continue;
      const version = this.pageRepository.findLatestVersion(item.pageId);
      if (version !== undefined) ids.add(version.id);
    }
    return [...ids];
  }

  private requireProject(projectId: string): Project {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) throw new Error("Proiectul nu există.");
    return project;
  }

  private requireTest(projectId: string, testId: string): TestDefinition {
    const test = this.testRepository.findById(testId);
    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu există.");
    }
    return test;
  }

  private requireSession(runId: string): RunnerSession {
    const session = this.sessions.get(runId);
    if (session === undefined) throw new Error("Rularea nu există.");
    return session;
  }

  private requireFallbackSession(runId: string): RunnerSession {
    const session = this.requireSession(runId);
    if (
      session.snapshot.state !== "waiting_for_fallback_decision" ||
      session.pendingFallback === undefined
    ) {
      throw new Error("Rularea nu așteaptă o decizie de fallback.");
    }
    return session;
  }

  private testKey(projectId: string, testId: string): string {
    return `${projectId}:${testId}`;
  }

  private publish(session: RunnerSession, snapshot: RunnerSnapshot): void {
    session.snapshot = snapshot;
    this.latestByTest.set(
      this.testKey(session.project.id, session.test.id),
      snapshot,
    );
    if (
      (snapshot.state === "failed" || snapshot.state === "paused_on_error") &&
      !session.artifactsCaptured
    ) {
      session.artifactsCaptured = true;
      const capture = this.captureFailureArtifacts(session);
      this.artifactCaptureByProject.set(session.project.id, capture);
      const clearCapture = (): void => {
        if (this.artifactCaptureByProject.get(session.project.id) === capture) {
          this.artifactCaptureByProject.delete(session.project.id);
        }
      };
      void capture.then(clearCapture, (error: unknown) => {
        clearCapture();
        console.warn("[runner] Pachetul de diagnostic nu a putut fi salvat", {
          runId: session.run.id,
          error,
        });
      });
    }
    this.emit(snapshot);
  }

  private async startTrace(session: RunnerSession): Promise<void> {
    if (
      this.options.artifacts === undefined ||
      this.options.artifactRoot === undefined
    ) {
      return;
    }
    await this.artifactCaptureByProject
      .get(session.project.id)
      ?.catch(() => {});
    try {
      await this.browser.getRunnerContext(session.project.id).tracing.start({
        screenshots: true,
        snapshots: true,
        sources: true,
      });
      session.traceActive = true;
    } catch (error) {
      console.warn("[runner] Playwright tracing nu a putut fi pornit", {
        runId: session.run.id,
        error,
      });
    }
  }

  private async discardTrace(session: RunnerSession): Promise<void> {
    if (!session.traceActive) return;
    session.traceActive = false;
    await this.browser
      .getRunnerContext(session.project.id)
      .tracing.stop()
      .catch((error: unknown) => {
        console.warn("[runner] Playwright tracing nu a putut fi oprit", {
          runId: session.run.id,
          error,
        });
      });
  }

  private attachDiagnostics(session: RunnerSession): void {
    if (
      this.options.artifacts === undefined ||
      this.options.artifactRoot === undefined
    ) {
      return;
    }
    session.page.on("console", (message) => {
      if (!["error", "warning"].includes(message.type())) return;
      session.consoleMessages.push({
        type: message.type(),
        text: message.text(),
        location: message.location(),
        timestamp: this.options.now().toISOString(),
      });
    });
    session.page.on("requestfailed", (request) => {
      session.networkFailures.push({
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText ?? "Request failed",
        timestamp: this.options.now().toISOString(),
      });
    });
  }

  private async captureFailureArtifacts(session: RunnerSession): Promise<void> {
    const root = this.options.artifactRoot;
    const repository = this.options.artifacts;
    if (root === undefined || repository === undefined) return;
    const directory = join(root, session.project.id, session.run.id);
    await mkdir(directory, { recursive: true });
    const createdAt = this.options.now().toISOString();
    const save = async (
      kind: "screenshot" | "html" | "console" | "network",
      extension: string,
      mimeType: string,
      content: string | Uint8Array,
    ): Promise<void> => {
      const filePath = join(directory, `${kind}.${extension}`);
      await writeFile(filePath, content);
      repository.create({
        id: this.options.createId(),
        runId: session.run.id,
        kind,
        filePath,
        mimeType,
        sizeBytes:
          typeof content === "string"
            ? Buffer.byteLength(content)
            : content.byteLength,
        createdAt,
      });
    };
    const saveTrace = async (): Promise<void> => {
      if (!session.traceActive) return;
      session.traceActive = false;
      const filePath = join(directory, "trace.zip");
      await this.browser
        .getRunnerContext(session.project.id)
        .tracing.stop({ path: filePath });
      const details = await stat(filePath);
      repository.create({
        id: this.options.createId(),
        runId: session.run.id,
        kind: "trace",
        filePath,
        mimeType: "application/zip",
        sizeBytes: details.size,
        createdAt,
      });
    };
    const results = await Promise.allSettled([
      session.page
        .screenshot({ type: "png", fullPage: true })
        .then((image) => save("screenshot", "png", "image/png", image)),
      session.page
        .content()
        .then((html) => save("html", "html", "text/html", html)),
      save(
        "console",
        "json",
        "application/json",
        JSON.stringify(session.consoleMessages, null, 2),
      ),
      save(
        "network",
        "json",
        "application/json",
        JSON.stringify(session.networkFailures, null, 2),
      ),
      saveTrace(),
    ]);
    for (const result of results) {
      if (result.status === "rejected") {
        console.warn("[runner] Salvarea unui artefact de diagnostic a eșuat", {
          runId: session.run.id,
          error:
            result.reason instanceof Error
              ? result.reason.message
              : String(result.reason),
        });
      }
    }
  }

  private publishForTest(
    projectId: string,
    testId: string,
    snapshot: RunnerSnapshot,
  ): void {
    this.latestByTest.set(this.testKey(projectId, testId), snapshot);
    this.emit(snapshot);
  }

  private emit(snapshot: RunnerSnapshot): void {
    for (const listener of this.listeners) listener(copySnapshot(snapshot));
  }

  private toRunnerError(
    error: unknown,
    stepId?: string,
    operation?: string,
  ): RunnerErrorDetails {
    return classifyRunnerError(error, {
      ...(stepId === undefined ? {} : { stepId }),
      ...(operation === undefined ? {} : { operation }),
      now: this.options.now,
    });
  }

  private persistRunError(runId: string, details: RunnerErrorDetails): void {
    this.runRepository.updateError(
      runId,
      structuredClone(details) as unknown as JsonValue,
    );
  }
}
