import type { Page } from "playwright-core";

import type {
  RecorderElementSnapshot,
  RecorderRawEvent,
} from "../../shared/recorder.js";

export const recorderInitScript = ({
  bindingName,
  controlName,
}: {
  bindingName: string;
  controlName: string;
}): void => {
  const recorderGlobal = globalThis as unknown as Record<string, unknown>;
  if (recorderGlobal[controlName] !== undefined) return;

  let active = true;
  let blocked = false;
  let overlay: HTMLDivElement | undefined;
  type ScrollSource = Document | Element;
  type ScrollPosition = { x: number; y: number };
  type PendingScroll = {
    start: ScrollPosition;
    current: ScrollPosition;
    timer: ReturnType<typeof setTimeout>;
    mode: "dom" | "wheel";
    wheelX: number;
    wheelY: number;
    target?: RecorderElementSnapshot;
  };
  const settledScrollPositions = new WeakMap<ScrollSource, ScrollPosition>();
  const pendingScrolls = new Map<ScrollSource, PendingScroll>();
  settledScrollPositions.set(document, { x: scrollX, y: scrollY });
  const pendingInputs = new WeakMap<Element, string>();
  let lastPendingInput: Element | undefined;
  let lastPointerOption: { element: Element; capturedAt: number } | undefined;
  let lastCustomOptionSelectionAt = 0;
  type HoverRule = { selector: string; ownerSelector: string };
  type PointerContext = { owners: Element[]; capturedAt: number };
  type RevealContext = PointerContext & {
    affected: Set<Element>;
    ownerStateChanged: boolean;
  };
  let hoverRules: HoverRule[] = [];
  let hoverRulesDirty = true;
  let pointerContext: PointerContext | undefined;
  let revealContexts: RevealContext[] = [];

  const compact = (value: string | null | undefined): string | undefined => {
    const result = value?.replace(/\s+/g, " ").trim();
    return result === undefined || result.length === 0
      ? undefined
      : result.slice(0, 200);
  };

  const cssPath = (element: Element): string => {
    if (element.id.length > 0) {
      return `#${CSS.escape(element.id)}`;
    }
    const testId = element.getAttribute("data-testid");
    if (testId !== null) {
      return `[data-testid="${CSS.escape(testId)}"]`;
    }
    const parts: string[] = [];
    let current: Element | null = element;
    while (current !== null && current !== document.documentElement) {
      let part = current.tagName.toLowerCase();
      const name = current.getAttribute("name");
      if (name !== null) {
        part += `[name="${CSS.escape(name)}"]`;
        parts.unshift(part);
        break;
      }
      const siblings = current.parentElement
        ? [...current.parentElement.children].filter(
            (sibling) => sibling.tagName === current?.tagName,
          )
        : [];
      if (siblings.length > 1) {
        part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
      }
      parts.unshift(part);
      current = current.parentElement;
    }
    return parts.join(" > ");
  };

  const implicitRole = (element: Element): string | undefined => {
    const explicit = element.getAttribute("role");
    if (explicit !== null) return explicit;
    const tagName = element.tagName.toLowerCase();
    const inputType = element.getAttribute("type")?.toLowerCase();
    if (tagName === "button") return "button";
    if (tagName === "a" && element.hasAttribute("href")) return "link";
    if (tagName === "select") return "combobox";
    if (tagName === "textarea") return "textbox";
    if (tagName === "input") {
      if (inputType === "checkbox") return "checkbox";
      if (inputType === "radio") return "radio";
      if (inputType === "button" || inputType === "submit") return "button";
      return "textbox";
    }
    return undefined;
  };

  const simpleContainerLocator = (
    container: Element,
  ): RecorderElementSnapshot["repeated"] => {
    const component = container.getAttribute("data-component");
    const parent = container.parentElement;
    if (parent === null) return undefined;
    const peers = [...parent.children].filter((candidate) =>
      component === null
        ? candidate.tagName === container.tagName
        : candidate.getAttribute("data-component") === component,
    );
    if (peers.length < 2) return undefined;
    const heading = container.querySelector(
      "h1, h2, h3, h4, [data-title], .title, [class*='title']",
    );
    const result: NonNullable<RecorderElementSnapshot["repeated"]> = {
      containerLocator:
        component === null
          ? {
              type: "css",
              operator: "equals",
              value: container.tagName.toLowerCase(),
            }
          : {
              type: "data_attribute",
              attribute: "data-component",
              operator: "equals",
              value: component,
            },
    };
    const distinguishingText = compact(heading?.textContent);
    if (distinguishingText !== undefined) {
      result.distinguishingText = distinguishingText;
    }
    return result;
  };

  const snapshot = (element: Element): RecorderElementSnapshot => {
    const htmlElement = element as HTMLElement;
    const input = element as HTMLInputElement;
    const labels =
      "labels" in input && input.labels !== null
        ? [...input.labels]
            .map((label) => compact(label.textContent))
            .filter((value): value is string => value !== undefined)
            .join(" ")
        : undefined;
    const dataAttributes: Record<string, string> = {};
    for (const attribute of [...element.attributes]) {
      if (attribute.name.startsWith("data-")) {
        dataAttributes[attribute.name] = attribute.value;
      }
    }
    const repeatedContainer = element.closest(
      "[data-component], article, li, tr",
    );
    const repeated =
      repeatedContainer === null
        ? undefined
        : simpleContainerLocator(repeatedContainer);
    const heading = element.matches("h1, h2, h3, h4, h5, h6")
      ? element
      : element.querySelector("h1, h2, h3, h4, h5, h6");
    const result: RecorderElementSnapshot = {
      tagName: element.tagName.toLowerCase(),
      dataAttributes,
      cssPath: cssPath(element),
    };
    const optionalValues = {
      inputType: element.getAttribute("type")?.toLowerCase(),
      id: element.id.length === 0 ? undefined : element.id,
      href:
        element instanceof HTMLAnchorElement
          ? (element.getAttribute("href") ?? undefined)
          : undefined,
      name: element.getAttribute("name") ?? undefined,
      text: compact(htmlElement.innerText ?? element.textContent),
      label: compact(labels),
      role: implicitRole(element),
      actionText: compact(heading?.textContent),
      ariaLabel: compact(element.getAttribute("aria-label")),
      placeholder: compact(element.getAttribute("placeholder")),
      title: compact(element.getAttribute("title")),
    };
    for (const [key, value] of Object.entries(optionalValues)) {
      if (value !== undefined) {
        Object.assign(result, { [key]: value });
      }
    }
    if (repeated !== undefined) result.repeated = repeated;
    return result;
  };

  const setBlocked = (next: boolean): void => {
    blocked = next;
    if (next) {
      if (overlay === undefined) {
        overlay = document.createElement("div");
        overlay.setAttribute("data-semantic-recorder-internal", "blocker");
        overlay.setAttribute("aria-label", "Recorder: analiza este în curs");
        Object.assign(overlay.style, {
          position: "fixed",
          inset: "0",
          zIndex: "2147483647",
          cursor: "wait",
          background: "rgba(255,255,255,0.08)",
        });
        document.documentElement.append(overlay);
      }
    } else {
      overlay?.remove();
      overlay = undefined;
    }
  };

  const emit = async (
    event: Omit<RecorderRawEvent, "timestamp" | "url">,
  ): Promise<void> => {
    if (!active || blocked) return;
    const binding = recorderGlobal[bindingName];
    if (typeof binding !== "function") return;
    await (binding as (value: RecorderRawEvent) => Promise<void>)({
      ...event,
      url: location.href,
      timestamp: new Date().toISOString(),
    }).catch(() => undefined);
  };

  const isInternal = (element: Element): boolean =>
    element.closest("[data-semantic-recorder-internal]") !== null;

  const normalizeScrollSource = (target: EventTarget | null): ScrollSource => {
    if (
      target instanceof Element &&
      target !== document.documentElement &&
      target !== document.body &&
      target !== document.scrollingElement
    ) {
      return target;
    }
    return document;
  };

  const scrollPosition = (source: ScrollSource): ScrollPosition =>
    source instanceof Document
      ? { x: scrollX, y: scrollY }
      : { x: source.scrollLeft, y: source.scrollTop };

  const wheelScrollSource = (event: WheelEvent): ScrollSource => {
    let current: Element | null =
      event.target instanceof Element ? event.target : document.body;
    while (current !== null) {
      const style = getComputedStyle(current);
      const scrollsVertically =
        event.deltaY !== 0 &&
        /(auto|scroll|overlay)/.test(style.overflowY) &&
        current.scrollHeight > current.clientHeight;
      const scrollsHorizontally =
        event.deltaX !== 0 &&
        /(auto|scroll|overlay)/.test(style.overflowX) &&
        current.scrollWidth > current.clientWidth;
      if (scrollsVertically || scrollsHorizontally) {
        return normalizeScrollSource(current);
      }
      current = current.parentElement;
    }
    return document;
  };

  const flushScroll = async (source: ScrollSource): Promise<void> => {
    const pending = pendingScrolls.get(source);
    if (pending === undefined) return;
    clearTimeout(pending.timer);
    pendingScrolls.delete(source);
    const current = scrollPosition(source);
    settledScrollPositions.set(source, current);
    const positionDeltaX = current.x - pending.start.x;
    const positionDeltaY = current.y - pending.start.y;
    const positionDistance =
      Math.abs(positionDeltaX) + Math.abs(positionDeltaY);
    const deltaX =
      pending.mode === "wheel" && positionDistance < 8
        ? pending.wheelX
        : positionDeltaX;
    const deltaY =
      pending.mode === "wheel" && positionDistance < 8
        ? pending.wheelY
        : positionDeltaY;
    const minimumDistance = pending.mode === "wheel" ? 8 : 40;
    if (Math.abs(deltaX) + Math.abs(deltaY) < minimumDistance) return;
    // For a real page scroll, the element under the mouse is only the wheel
    // hit target, not the scroll container. Keeping it would make replay try
    // to hover an unrelated element (for example a screen-reader-only span).
    // Preserve the target only for nested scroll containers or for wheel-only
    // interactions where the document position did not actually change
    // (virtual/custom JavaScript scrolling).
    const target =
      source instanceof Document && positionDistance >= 8
        ? undefined
        : pending.target;
    await emit({
      type: "scroll",
      scrollX: deltaX,
      scrollY: deltaY,
      scrollMode: pending.mode,
      ...(target === undefined ? {} : { target }),
    });
  };

  const queueScroll = (
    source: ScrollSource,
    wheelDelta?: ScrollPosition,
    wheelTarget?: Element,
  ): void => {
    if (source instanceof Element && isInternal(source)) return;
    const current = scrollPosition(source);
    const existing = pendingScrolls.get(source);
    if (existing !== undefined) {
      clearTimeout(existing.timer);
      existing.current = current;
    }
    const start =
      existing?.start ??
      settledScrollPositions.get(source) ??
      (source instanceof Document ? current : { x: 0, y: 0 });
    const mode = wheelDelta === undefined ? (existing?.mode ?? "dom") : "wheel";
    const target =
      wheelTarget === undefined
        ? (existing?.target ??
          (source instanceof Element ? snapshot(source) : undefined))
        : snapshot(wheelTarget);
    const timer = setTimeout(() => {
      void flushScroll(source);
    }, 180);
    pendingScrolls.set(source, {
      start,
      current,
      timer,
      mode,
      wheelX: (existing?.wheelX ?? 0) + (wheelDelta?.x ?? 0),
      wheelY: (existing?.wheelY ?? 0) + (wheelDelta?.y ?? 0),
      ...(target === undefined ? {} : { target }),
    });
  };

  const nativeClickableTags = new Set(["button", "summary"]);
  const clickableRoles = new Set([
    "button",
    "checkbox",
    "gridcell",
    "link",
    "menuitem",
    "option",
    "radio",
    "switch",
    "tab",
    "treeitem",
  ]);
  const clickableDataAttributes = [
    "data-action",
    "data-click",
    "data-command",
    "data-date",
  ];

  const hasPointerCursor = (element: Element): boolean => {
    if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
      return false;
    }
    const style = getComputedStyle(element);
    return style.pointerEvents !== "none" && style.cursor === "pointer";
  };

  const isPointerBoundary = (element: Element): boolean => {
    if (!hasPointerCursor(element)) return false;
    const parent = element.parentElement;
    return parent === null || !hasPointerCursor(parent);
  };

  const isExplicitlyClickable = (element: Element): boolean => {
    const tagName = element.tagName.toLowerCase();
    if (nativeClickableTags.has(tagName)) return true;
    if (tagName === "a" && element.hasAttribute("href")) return true;
    if (
      ["input", "select", "textarea"].includes(tagName) ||
      clickableRoles.has(element.getAttribute("role") ?? "") ||
      element.hasAttribute("onclick") ||
      clickableDataAttributes.some((attribute) =>
        element.hasAttribute(attribute),
      )
    ) {
      return true;
    }
    const tabIndex = element.getAttribute("tabindex");
    return tabIndex !== null && Number(tabIndex) >= 0;
  };

  const resolveClickTarget = (event: MouseEvent): Element | undefined => {
    const path = event
      .composedPath()
      .filter(
        (candidate): candidate is Element => candidate instanceof Element,
      );
    const explicitTarget = path.find(isExplicitlyClickable);
    if (explicitTarget !== undefined) return explicitTarget;

    const pointerTarget = path.find(isPointerBoundary);
    if (pointerTarget !== undefined) return pointerTarget;

    const semanticCardTarget = path.find((candidate) => {
      const tagName = candidate.tagName.toLowerCase();
      const className =
        candidate instanceof HTMLElement ? candidate.className : "";
      const hasCardIdentity =
        ["article", "li"].includes(tagName) ||
        candidate.hasAttribute("data-component") ||
        /(^|[\s_-])(card|product|item|tile)([\s_-]|$)/i.test(className);
      return (
        hasCardIdentity &&
        candidate.querySelector("h1, h2, h3, h4, h5, h6, [data-title]") !== null
      );
    });
    if (semanticCardTarget !== undefined) return semanticCardTarget;

    const directTarget =
      event.target instanceof Element ? event.target : undefined;
    if (
      directTarget === undefined ||
      ["body", "html"].includes(directTarget.tagName.toLowerCase()) ||
      directTarget.closest("label") !== null
    ) {
      return undefined;
    }

    // Clickul utilizatorului este el însuși un semnal comportamental. Acest
    // fallback acoperă componentele care atașează addEventListener pe div/span
    // fără rol, tabindex, onclick inline sau cursor:pointer.
    return directTarget;
  };

  const splitSelectors = (value: string): string[] => {
    const result: string[] = [];
    let start = 0;
    let depth = 0;
    let quote = "";
    for (let index = 0; index < value.length; index += 1) {
      const character = value[index] ?? "";
      if (quote.length > 0) {
        if (character === quote && value[index - 1] !== "\\") quote = "";
        continue;
      }
      if (character === '"' || character === "'") {
        quote = character;
      } else if (["(", "["].includes(character)) {
        depth += 1;
      } else if ([")", "]"].includes(character)) {
        depth = Math.max(0, depth - 1);
      } else if (character === "," && depth === 0) {
        result.push(value.slice(start, index).trim());
        start = index + 1;
      }
    }
    result.push(value.slice(start).trim());
    return result.filter(Boolean);
  };

  const refreshHoverRules = (): void => {
    if (!hoverRulesDirty) return;
    hoverRulesDirty = false;
    const next = new Map<string, HoverRule>();
    const scan = (rules: CSSRuleList): void => {
      for (const rule of [...rules]) {
        try {
          if ("cssRules" in rule) {
            scan((rule as CSSGroupingRule).cssRules);
          }
          const selectorText =
            "selectorText" in rule && typeof rule.selectorText === "string"
              ? rule.selectorText
              : undefined;
          if (selectorText === undefined) continue;
          for (const selector of splitSelectors(selectorText)) {
            const hoverIndex = selector.indexOf(":hover");
            if (hoverIndex < 0) continue;
            const afterHover = selector.slice(hoverIndex + 6);
            if (!/^\s+(?![:])|^\s*[>+~]/.test(afterHover)) continue;
            const ownerSelector = selector.slice(0, hoverIndex).trim();
            if (ownerSelector.length === 0) continue;
            const dependency = { selector, ownerSelector };
            next.set(`${ownerSelector}\n${selector}`, dependency);
          }
        } catch {
          // Unele reguli sau stylesheet-uri nu sunt accesibile cross-origin.
        }
      }
    };
    for (const sheet of [...document.styleSheets]) {
      try {
        scan(sheet.cssRules);
      } catch {
        // Stylesheet cross-origin; detectorul JS rămâne disponibil.
      }
    }
    hoverRules = [...next.values()];
  };

  const pointerOwners = (event: MouseEvent): Element[] => {
    const path = event
      .composedPath()
      .filter(
        (candidate): candidate is Element =>
          candidate instanceof Element &&
          !["body", "html"].includes(candidate.tagName.toLowerCase()) &&
          !isInternal(candidate),
      );
    const semanticTarget = resolveClickTarget(event);
    const informative = path.filter(
      (element) =>
        element === semanticTarget ||
        isExplicitlyClickable(element) ||
        element.id.length > 0 ||
        [...element.attributes].some(
          ({ name }) =>
            name.startsWith("data-") ||
            [
              "aria-haspopup",
              "aria-controls",
              "onmouseover",
              "onmouseenter",
            ].includes(name),
        ),
    );
    return [...new Set([...informative, ...path.slice(0, 3)])].slice(0, 3);
  };

  const cssRevealOwners = (clickTarget: Element): Element[] => {
    refreshHoverRules();
    const owners: Element[] = [];
    for (const dependency of hoverRules) {
      try {
        const revealed = clickTarget.closest(dependency.selector);
        if (revealed === null) continue;
        const ancestorOwner = revealed.closest(dependency.ownerSelector);
        const owner =
          ancestorOwner ??
          [...document.querySelectorAll(dependency.ownerSelector)].find(
            (candidate) => candidate.matches(":hover"),
          );
        if (owner !== undefined && owner !== null) owners.push(owner);
      } catch {
        // Selectorii cu pseudo-elemente sau sintaxă nouă pot fi ignorați sigur.
      }
    }
    return owners;
  };

  const hoverChainRevealOwners = (clickTarget: Element): Element[] => {
    const popupTarget =
      clickTarget.closest(
        '[role="menu"], [role="dialog"], [data-popover], [data-dropdown-menu]',
      ) !== null;
    try {
      return [...document.querySelectorAll(":hover")]
        .filter(
          (candidate) =>
            candidate !== clickTarget &&
            candidate.contains(clickTarget) &&
            !["body", "html"].includes(candidate.tagName.toLowerCase()),
        )
        .filter((candidate) => {
          const identity = [
            candidate.id,
            candidate.getAttribute("class") ?? "",
            candidate.getAttribute("role") ?? "",
          ].join(" ");
          return (
            popupTarget ||
            candidate.hasAttribute("aria-haspopup") ||
            /cart|basket|menu|dropdown|popover|navigation|account|profile/i.test(
              identity,
            )
          );
        })
        .reverse()
        .slice(0, 3);
    } catch {
      return [];
    }
  };

  const takeRevealCandidates = (clickTarget: Element): Element[] => {
    const now = Date.now();
    const candidates = [
      ...cssRevealOwners(clickTarget),
      ...hoverChainRevealOwners(clickTarget),
    ];
    for (const context of revealContexts) {
      if (now - context.capturedAt > 5_000) continue;
      const related =
        context.ownerStateChanged ||
        [...context.affected].some(
          (element) =>
            element === document.body ||
            element === document.documentElement ||
            element === clickTarget ||
            element.contains(clickTarget) ||
            clickTarget.contains(element),
        );
      if (related) candidates.push(...context.owners);
    }
    revealContexts = [];
    pointerContext = undefined;
    return [...new Set(candidates)]
      .filter((candidate) => candidate !== clickTarget)
      .slice(0, 3);
  };

  const mutationObserver = new MutationObserver((records) => {
    if (!active) return;
    if (
      records.some((record) =>
        [...record.addedNodes].some(
          (node) =>
            node instanceof HTMLStyleElement || node instanceof HTMLLinkElement,
        ),
      )
    ) {
      hoverRulesDirty = true;
    }
    const context = pointerContext;
    if (context === undefined || Date.now() - context.capturedAt > 1_000)
      return;
    const affected = new Set<Element>();
    let ownerStateChanged = false;
    for (const record of records) {
      if (!(record.target instanceof Element) || isInternal(record.target)) {
        continue;
      }
      affected.add(record.target);
      for (const node of [...record.addedNodes]) {
        if (node instanceof Element && !isInternal(node)) affected.add(node);
      }
      if (
        context.owners.some(
          (owner) => owner === record.target || owner.contains(record.target),
        )
      ) {
        ownerStateChanged = true;
      }
    }
    if (affected.size === 0) return;
    revealContexts.push({ ...context, affected, ownerStateChanged });
    revealContexts = revealContexts.slice(-3);
  });
  mutationObserver.observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "hidden",
      "aria-expanded",
      "aria-hidden",
    ],
  });

  const takePendingInput = (
    element: Element | undefined,
  ): Omit<RecorderRawEvent, "timestamp" | "url"> | undefined => {
    if (element === undefined) return undefined;
    const value = pendingInputs.get(element);
    if (value === undefined) return undefined;
    pendingInputs.delete(element);
    if (lastPendingInput === element) lastPendingInput = undefined;
    return { type: "fill", target: snapshot(element), value };
  };

  const flushInput = (element: Element): void => {
    const event = takePendingInput(element);
    if (event !== undefined) void emit(event);
  };

  const resolveCustomOption = (event: MouseEvent): Element | undefined => {
    const path = event
      .composedPath()
      .filter(
        (candidate): candidate is Element => candidate instanceof Element,
      );
    for (const candidate of path) {
      const option = candidate.closest(
        '[role="option"], [role="treeitem"], .select2-results__option',
      );
      if (option === null || isInternal(option)) continue;
      const role = option.getAttribute("role");
      const belongsToPopup =
        role === "option" ||
        role === "treeitem" ||
        option.closest(
          '[role="listbox"], [role="tree"], .select2-results, .select2-dropdown',
        ) !== null;
      if (belongsToPopup) return option;
    }
    return undefined;
  };

  const resolveKeyboardCustomOption = (input: Element): Element | undefined => {
    const activeDescendant = input.getAttribute("aria-activedescendant");
    if (activeDescendant !== null && activeDescendant.length > 0) {
      const active = document.getElementById(activeDescendant);
      if (
        active !== null &&
        active.matches(
          '[role="option"], [role="treeitem"], .select2-results__option',
        ) &&
        !isInternal(active)
      ) {
        return active;
      }
    }

    const controlledId = input.getAttribute("aria-controls");
    const controlled =
      controlledId === null ? null : document.getElementById(controlledId);
    const roots = [
      controlled,
      input.closest('.select2-container, [role="combobox"]'),
      document,
    ].filter(
      (candidate): candidate is Element | Document => candidate !== null,
    );
    for (const root of roots) {
      for (const selector of [
        ".select2-results__option--highlighted",
        '[role="option"][aria-selected="true"]',
        '[role="treeitem"][aria-selected="true"]',
        '[role="option"][data-selected="true"]',
      ]) {
        const option = root.querySelector(selector);
        if (option !== null && !isInternal(option)) return option;
      }
    }
    return undefined;
  };

  const captureCustomOptionSelection = (option: Element): void => {
    const pendingFill = takePendingInput(lastPendingInput);
    const optionSnapshot = snapshot(option);
    const capturedAt = Date.now();
    lastPointerOption = { element: option, capturedAt };
    lastCustomOptionSelectionAt = capturedAt;
    void (async () => {
      if (pendingFill !== undefined) await emit(pendingFill);
      await emit({ type: "click", target: optionSnapshot });
    })();
  };

  document.addEventListener(
    "input",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      if (isInternal(event.target)) return;
      const isTextInput =
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLInputElement &&
          ![
            "button",
            "checkbox",
            "color",
            "file",
            "hidden",
            "image",
            "radio",
            "range",
            "reset",
            "submit",
          ].includes(event.target.type));
      if (isTextInput) {
        pendingInputs.set(event.target, event.target.value);
        lastPendingInput = event.target;
      }
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      flushInput(event.target);
    },
    true,
  );
  document.addEventListener(
    "change",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      if (isInternal(event.target)) return;
      if (event.target instanceof HTMLSelectElement) {
        if (
          Date.now() - lastCustomOptionSelectionAt <= 1_000 &&
          (event.target.classList.contains("select2-hidden-accessible") ||
            event.target.getAttribute("aria-hidden") === "true")
        ) {
          return;
        }
        void emit({
          type: "select",
          target: snapshot(event.target),
          value: event.target.value,
        });
      } else if (event.target instanceof HTMLInputElement) {
        if (event.target.type === "file") {
          void emit({
            type: "upload_file",
            target: snapshot(event.target),
            value: Array.from(
              event.target.files ?? [],
              ({ name }) => name,
            ).join(", "),
          });
        } else if (event.target.type === "checkbox") {
          void emit({
            type: "checkbox",
            target: snapshot(event.target),
            checked: event.target.checked,
          });
        } else if (event.target.type === "radio" && event.target.checked) {
          void emit({
            type: "radio",
            target: snapshot(event.target),
            checked: true,
            value: event.target.value,
          });
        } else {
          flushInput(event.target);
        }
      } else if (event.target instanceof HTMLTextAreaElement) {
        flushInput(event.target);
      }
    },
    true,
  );
  document.addEventListener(
    "mouseover",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      const owners = pointerOwners(event);
      if (owners.length === 0) return;
      pointerContext = { owners, capturedAt: Date.now() };
    },
    true,
  );
  document.addEventListener(
    "pointerdown",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      const option = resolveCustomOption(event);
      if (option === undefined) return;

      // Select2/SelectWoo și alte dropdownuri elimină frecvent opțiunea din DOM
      // înainte de `click`. Facem snapshot acum și consumăm sincron inputul de
      // căutare, ca focusout-ul să nu emită același fill încă o dată.
      captureCustomOptionSelection(option);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      const target = resolveClickTarget(event);
      if (target === undefined || isInternal(target)) return;
      const pointerOption = lastPointerOption;
      if (
        pointerOption !== undefined &&
        Date.now() - pointerOption.capturedAt <= 1_000 &&
        (target === pointerOption.element ||
          pointerOption.element.contains(target) ||
          target.contains(pointerOption.element))
      ) {
        lastPointerOption = undefined;
        return;
      }
      if (
        pointerOption !== undefined &&
        Date.now() - pointerOption.capturedAt > 1_000
      ) {
        lastPointerOption = undefined;
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      const hoverCandidates = takeRevealCandidates(target).map(snapshot);
      void emit({
        type: "click",
        target: snapshot(target),
        ...(hoverCandidates.length === 0 ? {} : { hoverCandidates }),
      });
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      if (isInternal(event.target)) return;
      const textInput =
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLInputElement &&
          !["button", "checkbox", "radio", "submit"].includes(
            event.target.type,
          ));
      if (textInput) {
        if (event.key === "Enter") {
          const option = resolveKeyboardCustomOption(event.target);
          if (option !== undefined) captureCustomOptionSelection(option);
        }
        // Editarea unui câmp este reprezentată de un singur pas `fill`, emis
        // la focusout (sau la flush-ul explicit de la Done). Taste precum
        // Backspace/Delete/Enter nu trebuie să devină pași separați.
        return;
      }
      if (event.key === "Tab") {
        // Tab doar mută focusul. Evenimentul focusout va salva valoarea
        // câmpului, fără să creeze un pas press_key care să o suprascrie.
        return;
      }
      if (
        event.key.length === 1 ||
        ["Shift", "Control", "Alt", "Meta"].includes(event.key)
      ) {
        return;
      }
      const modifiers = [
        event.ctrlKey ? "Control" : "",
        event.altKey ? "Alt" : "",
        event.shiftKey ? "Shift" : "",
        event.metaKey ? "Meta" : "",
      ].filter(Boolean);
      void emit({
        type: "press_key",
        target: snapshot(event.target),
        key: [...modifiers, event.key].join("+"),
      });
    },
    true,
  );
  addEventListener(
    "wheel",
    (event) => {
      if (!active || blocked || !(event instanceof WheelEvent)) return;
      const source = wheelScrollSource(event);
      const unit =
        event.deltaMode === WheelEvent.DOM_DELTA_LINE
          ? 16
          : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
            ? innerHeight
            : 1;
      const wheelDelta = {
        x: event.deltaX * unit,
        y: event.deltaY * unit,
      };
      if (!pendingScrolls.has(source) && !settledScrollPositions.has(source)) {
        const current = scrollPosition(source);
        settledScrollPositions.set(source, {
          x: Math.max(0, current.x - wheelDelta.x),
          y: Math.max(0, current.y - wheelDelta.y),
        });
      }
      const directTarget =
        source instanceof Element ? source : resolveClickTarget(event);
      const wheelTarget =
        directTarget === undefined ||
        directTarget === document.body ||
        directTarget === document.documentElement
          ? undefined
          : directTarget;
      queueScroll(source, wheelDelta, wheelTarget);
    },
    { capture: true, passive: true },
  );
  addEventListener(
    "scroll",
    (event) => {
      if (!active || blocked) return;
      queueScroll(normalizeScrollSource(event.target));
    },
    true,
  );

  recorderGlobal[controlName] = {
    setBlocked,
    flushPending: async () => {
      const event = takePendingInput(lastPendingInput);
      if (event !== undefined) await emit(event);
      await Promise.all([...pendingScrolls.keys()].map(flushScroll));
    },
    stop: () => {
      active = false;
      setBlocked(false);
      for (const pending of pendingScrolls.values()) {
        clearTimeout(pending.timer);
      }
      pendingScrolls.clear();
      mutationObserver.disconnect();
    },
  };
};

export const installRecorderCapture = async (
  page: Page,
  bindingName: string,
  onEvent: (event: unknown) => void,
): Promise<void> => {
  const controlName = `${bindingName}Control`;
  await page.exposeBinding(bindingName, (source, event: unknown) => {
    if (
      source.frame === page.mainFrame() ||
      typeof event !== "object" ||
      event === null ||
      Array.isArray(event)
    ) {
      onEvent(event);
      return;
    }
    try {
      const origin = new URL(source.frame.url()).origin;
      if (!/^https?:\/\//i.test(origin)) {
        onEvent(event);
        return;
      }
      onEvent({ ...event, frameContext: { origin } });
    } catch {
      onEvent(event);
    }
  });
  const options = { bindingName, controlName };
  await page.addInitScript(recorderInitScript, options);
  const existingFrames = typeof page.frames === "function" ? page.frames() : [];
  if (existingFrames.length === 0) {
    await page.evaluate(recorderInitScript, options);
  } else {
    await Promise.all(
      existingFrames.map(async (frame) =>
        frame.evaluate(recorderInitScript, options).catch(() => undefined),
      ),
    );
  }
};

export const setRecorderPageBlocked = async (
  page: Page,
  bindingName: string,
  blocked: boolean,
): Promise<void> => {
  const applyBlocked = async (scope: Pick<Page, "evaluate">): Promise<void> => {
    await scope.evaluate(
      ({ controlName, nextBlocked }) => {
        const control = (
          globalThis as unknown as Record<
            string,
            { setBlocked?: (value: boolean) => void } | undefined
          >
        )[controlName];
        control?.setBlocked?.(nextBlocked);
      },
      { controlName: `${bindingName}Control`, nextBlocked: blocked },
    );
  };
  const frames = typeof page.frames === "function" ? page.frames() : [];
  if (frames.length === 0) {
    await applyBlocked(page);
  } else {
    await Promise.all(
      frames.map(async (frame) => applyBlocked(frame).catch(() => undefined)),
    );
  }
};

export const flushRecorderPendingInputs = async (
  page: Page,
  bindingName: string,
): Promise<void> => {
  const flush = async (scope: Pick<Page, "evaluate">): Promise<void> => {
    await scope.evaluate(async (controlName) => {
      const control = (
        globalThis as unknown as Record<
          string,
          { flushPending?: () => Promise<void> } | undefined
        >
      )[controlName];
      await control?.flushPending?.();
    }, `${bindingName}Control`);
  };
  const frames = typeof page.frames === "function" ? page.frames() : [];
  if (frames.length === 0) {
    await flush(page);
  } else {
    await Promise.all(
      frames.map(async (frame) => flush(frame).catch(() => undefined)),
    );
  }
};

export const stopRecorderCapture = async (
  page: Page,
  bindingName: string,
): Promise<void> => {
  const stop = async (scope: Pick<Page, "evaluate">): Promise<void> => {
    await scope.evaluate((controlName) => {
      const globals = globalThis as unknown as Record<
        string,
        { stop?: () => void } | undefined
      >;
      globals[controlName]?.stop?.();
    }, `${bindingName}Control`);
  };
  const frames = typeof page.frames === "function" ? page.frames() : [];
  if (frames.length === 0) {
    await stop(page);
  } else {
    await Promise.all(
      frames.map(async (frame) => stop(frame).catch(() => undefined)),
    );
  }
};
