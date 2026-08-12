import type { Page } from "playwright-core";

import type {
  InaccessibleStylesheet,
  PageAnalysisCounts,
  PageAnalysisProgress,
  PageAnalysisStage,
} from "../../shared/page-analysis.js";

export interface CapturedElement {
  path: string;
  cssSelector: string;
  tag: string;
  text: string;
  attributes: Record<string, string>;
  ariaAttributes: Record<string, string>;
  dataAttributes: Record<string, string>;
  states: {
    checked: boolean | null;
    selected: boolean | null;
    disabled: boolean;
  };
  parentPath: string | null;
  formPath: string | null;
}

export interface CapturedForm {
  path: string;
  cssSelector: string;
  name: string;
  method: string;
  action: string;
  fieldPaths: string[];
}

export interface CapturedVisibleText {
  path: string;
  text: string;
}

export interface CapturedInlineStyle {
  path: string;
  cssSelector: string;
  cssText: string;
}

export interface CapturedStyleTag {
  order: number;
  media: string;
  cssText: string;
}

export interface CapturedStylesheet {
  order: number;
  href: string | null;
  media: string;
  disabled: boolean;
  accessible: boolean;
  cssText: string;
  failureReason: string | null;
}

export interface CapturedShadowRoot {
  hostPath: string;
  innerHtml: string;
}

export interface PageCapture {
  url: string;
  title: string;
  html: string;
  serializedDom: string;
  accessibilitySnapshot: string;
  allElements: CapturedElement[];
  visibleTexts: CapturedVisibleText[];
  interactiveElements: CapturedElement[];
  ariaElements: CapturedElement[];
  dataElements: CapturedElement[];
  statefulElements: CapturedElement[];
  forms: CapturedForm[];
  inputs: CapturedElement[];
  buttons: CapturedElement[];
  links: CapturedElement[];
  selectableElements: CapturedElement[];
  inlineStyles: CapturedInlineStyle[];
  styleTags: CapturedStyleTag[];
  stylesheets: CapturedStylesheet[];
  shadowRoots: CapturedShadowRoot[];
  css: string;
  counts: PageAnalysisCounts;
  inaccessibleStylesheets: InaccessibleStylesheet[];
}

export type PageCaptureProgressListener = (
  stage: PageAnalysisStage,
  completedSteps: number,
  message: string,
) => void;

interface DomCapture {
  serializedDom: string;
  allElements: CapturedElement[];
  visibleTexts: CapturedVisibleText[];
  interactiveElements: CapturedElement[];
  ariaElements: CapturedElement[];
  dataElements: CapturedElement[];
  statefulElements: CapturedElement[];
  forms: CapturedForm[];
  inputs: CapturedElement[];
  buttons: CapturedElement[];
  links: CapturedElement[];
  selectableElements: CapturedElement[];
  shadowRoots: CapturedShadowRoot[];
}

interface StyleCapture {
  inlineStyles: CapturedInlineStyle[];
  styleTags: CapturedStyleTag[];
  stylesheets: CapturedStylesheet[];
}

const TOTAL_CAPTURE_STEPS = 9;

const emit = (
  listener: PageCaptureProgressListener | undefined,
  stage: PageAnalysisStage,
  completedSteps: number,
  message: string,
): void => {
  listener?.(stage, completedSteps, message);
};

const captureDom = async (page: Page): Promise<DomCapture> =>
  page.evaluate(() => {
    interface ElementSnapshot {
      path: string;
      cssSelector: string;
      tag: string;
      text: string;
      attributes: Record<string, string>;
      ariaAttributes: Record<string, string>;
      dataAttributes: Record<string, string>;
      states: {
        checked: boolean | null;
        selected: boolean | null;
        disabled: boolean;
      };
      parentPath: string | null;
      formPath: string | null;
    }

    const childIndex = (element: Element): number => {
      let index = 1;
      let sibling = element.previousElementSibling;

      while (sibling !== null) {
        if (sibling.tagName === element.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }

      return index;
    };

    const elementPath = (element: Element): string => {
      const segment = `${element.tagName.toLowerCase()}[${childIndex(element)}]`;
      const parent = element.parentElement;

      if (parent !== null) {
        return `${elementPath(parent)}/${segment}`;
      }

      const root = element.getRootNode();
      if (root instanceof ShadowRoot) {
        return `${elementPath(root.host)}::shadow/${segment}`;
      }

      return `/${segment}`;
    };

    const escapeCss = (value: string): string =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");

    const cssSelector = (element: Element): string => {
      if (element.id.length > 0) {
        return `#${escapeCss(element.id)}`;
      }

      const segment = `${element.tagName.toLowerCase()}:nth-of-type(${childIndex(element)})`;
      const parent = element.parentElement;

      if (parent !== null) {
        return `${cssSelector(parent)} > ${segment}`;
      }

      const root = element.getRootNode();
      if (root instanceof ShadowRoot) {
        return `${cssSelector(root.host)} ::shadow ${segment}`;
      }

      return segment;
    };

    const allElements: Element[] = [];
    const shadowRoots: { hostPath: string; innerHtml: string }[] = [];
    const collectElements = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll("*")) {
        allElements.push(element);
        if (element.shadowRoot !== null) {
          shadowRoots.push({
            hostPath: elementPath(element),
            innerHtml: element.shadowRoot.innerHTML,
          });
          collectElements(element.shadowRoot);
        }
      }
    };
    collectElements(document);

    const isVisible = (element: Element): boolean => {
      if (!(element instanceof HTMLElement || element instanceof SVGElement)) {
        return true;
      }

      const style = getComputedStyle(element);
      return (
        !element.hasAttribute("hidden") &&
        element.getAttribute("aria-hidden") !== "true" &&
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.visibility !== "collapse" &&
        element.getClientRects().length > 0
      );
    };

    const attributesOf = (element: Element): Record<string, string> =>
      Object.fromEntries(
        [...element.attributes].map((attribute) => [
          attribute.name,
          element instanceof HTMLInputElement &&
          element.type === "password" &&
          attribute.name.toLowerCase() === "value"
            ? "[REDACTED]"
            : attribute.value,
        ]),
      );

    const snapshot = (element: Element): ElementSnapshot => {
      const attributes = attributesOf(element);
      const ariaAttributes = Object.fromEntries(
        Object.entries(attributes).filter(([name]) => name.startsWith("aria-")),
      );
      const dataAttributes = Object.fromEntries(
        Object.entries(attributes).filter(([name]) => name.startsWith("data-")),
      );
      const form = element.closest("form");
      const supportsDisabled = "disabled" in element;

      return {
        path: elementPath(element),
        cssSelector: cssSelector(element),
        tag: element.tagName.toLowerCase(),
        text:
          element instanceof HTMLInputElement && element.type === "password"
            ? ""
            : (element.textContent ?? "").trim(),
        attributes,
        ariaAttributes,
        dataAttributes,
        states: {
          checked: element instanceof HTMLInputElement ? element.checked : null,
          selected:
            element instanceof HTMLOptionElement ? element.selected : null,
          disabled:
            supportsDisabled &&
            Boolean((element as Element & { disabled?: boolean }).disabled),
        },
        parentPath:
          element.parentElement === null
            ? null
            : elementPath(element.parentElement),
        formPath: form === null ? null : elementPath(form),
      };
    };

    const visibleTexts: { path: string; text: string }[] = [];
    const collectTextNodes = (root: Document | ShadowRoot): void => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node = walker.nextNode();

      while (node !== null) {
        const parent = node.parentElement;
        const text = node.textContent?.replaceAll(/\s+/g, " ").trim() ?? "";

        if (
          parent !== null &&
          text.length > 0 &&
          !["script", "style", "noscript", "template"].includes(
            parent.tagName.toLowerCase(),
          ) &&
          isVisible(parent)
        ) {
          visibleTexts.push({ path: elementPath(parent), text });
        }
        node = walker.nextNode();
      }

      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot !== null) {
          collectTextNodes(element.shadowRoot);
        }
      }
    };
    collectTextNodes(document);

    const interactiveRoles = new Set([
      "button",
      "checkbox",
      "combobox",
      "link",
      "listbox",
      "menuitem",
      "option",
      "radio",
      "searchbox",
      "slider",
      "spinbutton",
      "switch",
      "tab",
      "textbox",
      "treeitem",
    ]);
    const interactiveTags = new Set([
      "a",
      "button",
      "details",
      "input",
      "select",
      "summary",
      "textarea",
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
    const interactiveElements = allElements.filter((element) => {
      const role = element.getAttribute("role") ?? "";
      const tabIndex = element.getAttribute("tabindex");
      return (
        interactiveTags.has(element.tagName.toLowerCase()) ||
        interactiveRoles.has(role) ||
        element.getAttribute("contenteditable") === "true" ||
        (tabIndex !== null && Number(tabIndex) >= 0) ||
        element.hasAttribute("onclick") ||
        clickableDataAttributes.some((attribute) =>
          element.hasAttribute(attribute),
        ) ||
        (hasPointerCursor(element) &&
          (element.parentElement === null ||
            !hasPointerCursor(element.parentElement)))
      );
    });
    const ariaElements = allElements.filter((element) =>
      [...element.attributes].some(({ name }) => name.startsWith("aria-")),
    );
    const dataElements = allElements.filter((element) =>
      [...element.attributes].some(({ name }) => name.startsWith("data-")),
    );
    const statefulElements = allElements.filter(
      (element) =>
        element instanceof HTMLInputElement ||
        element instanceof HTMLOptionElement ||
        "disabled" in element,
    );
    const inputs = allElements.filter((element) =>
      ["input", "select", "textarea"].includes(element.tagName.toLowerCase()),
    );
    const buttons = allElements.filter((element) => {
      if (
        element.tagName.toLowerCase() === "button" ||
        element.getAttribute("role") === "button"
      ) {
        return true;
      }

      return (
        element instanceof HTMLInputElement &&
        ["button", "reset", "submit"].includes(element.type)
      );
    });
    const links = allElements.filter(
      (element) =>
        (element instanceof HTMLAnchorElement &&
          element.hasAttribute("href")) ||
        element.getAttribute("role") === "link",
    );
    const selectableElements = allElements.filter((element) => {
      const role = element.getAttribute("role");
      return (
        ["option", "select"].includes(element.tagName.toLowerCase()) ||
        (element instanceof HTMLInputElement &&
          ["checkbox", "radio"].includes(element.type)) ||
        ["checkbox", "listbox", "option", "radio"].includes(role ?? "")
      );
    });
    const forms = allElements
      .filter(
        (element): element is HTMLFormElement =>
          element instanceof HTMLFormElement,
      )
      .map((form) => ({
        path: elementPath(form),
        cssSelector: cssSelector(form),
        name: form.name,
        method: form.method,
        action: form.action,
        fieldPaths: [...form.elements]
          .filter((element): element is Element => element instanceof Element)
          .map(elementPath),
      }));

    return {
      serializedDom: document.documentElement.outerHTML,
      allElements: allElements.map(snapshot),
      visibleTexts,
      interactiveElements: interactiveElements.map(snapshot),
      ariaElements: ariaElements.map(snapshot),
      dataElements: dataElements.map(snapshot),
      statefulElements: statefulElements.map(snapshot),
      forms,
      inputs: inputs.map(snapshot),
      buttons: buttons.map(snapshot),
      links: links.map(snapshot),
      selectableElements: selectableElements.map(snapshot),
      shadowRoots,
    };
  });

const captureStyles = async (page: Page): Promise<StyleCapture> =>
  page.evaluate(() => {
    const childIndex = (element: Element): number => {
      let index = 1;
      let sibling = element.previousElementSibling;

      while (sibling !== null) {
        if (sibling.tagName === element.tagName) {
          index += 1;
        }
        sibling = sibling.previousElementSibling;
      }

      return index;
    };
    const pathOf = (element: Element): string => {
      const segment = `${element.tagName.toLowerCase()}[${childIndex(element)}]`;
      if (element.parentElement !== null) {
        return `${pathOf(element.parentElement)}/${segment}`;
      }

      const root = element.getRootNode();
      return root instanceof ShadowRoot
        ? `${pathOf(root.host)}::shadow/${segment}`
        : `/${segment}`;
    };
    const escapeCss = (value: string): string =>
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(value)
        : value.replaceAll(/[^a-zA-Z0-9_-]/g, "\\$&");
    const selectorOf = (element: Element): string => {
      if (element.id.length > 0) {
        return `#${escapeCss(element.id)}`;
      }
      const segment = `${element.tagName.toLowerCase()}:nth-of-type(${childIndex(element)})`;
      if (element.parentElement !== null) {
        return `${selectorOf(element.parentElement)} > ${segment}`;
      }

      const root = element.getRootNode();
      return root instanceof ShadowRoot
        ? `${selectorOf(root.host)} ::shadow ${segment}`
        : segment;
    };

    const roots: (Document | ShadowRoot)[] = [document];
    const collectShadowRoots = (root: Document | ShadowRoot): void => {
      for (const element of root.querySelectorAll("*")) {
        if (element.shadowRoot !== null) {
          roots.push(element.shadowRoot);
          collectShadowRoots(element.shadowRoot);
        }
      }
    };
    collectShadowRoots(document);
    const elements = roots.flatMap((root) => [...root.querySelectorAll("*")]);
    const inlineStyles = elements
      .filter((element) => element.hasAttribute("style"))
      .map((element) => ({
        path: pathOf(element),
        cssSelector: selectorOf(element),
        cssText: element.getAttribute("style") ?? "",
      }))
      .filter(({ cssText }) => cssText.length > 0);
    const styleTags = roots
      .flatMap((root) => [...root.querySelectorAll("style")])
      .map((element, order) => ({
        order,
        media: element.media,
        cssText: element.textContent ?? "",
      }));
    const allStylesheets: CSSStyleSheet[] = [...document.styleSheets];
    for (const root of roots) {
      for (const element of root.querySelectorAll(
        "style, link[rel=stylesheet]",
      )) {
        const stylesheet =
          element instanceof HTMLStyleElement ||
          element instanceof HTMLLinkElement
            ? element.sheet
            : null;
        if (
          stylesheet instanceof CSSStyleSheet &&
          !allStylesheets.includes(stylesheet)
        ) {
          allStylesheets.push(stylesheet);
        }
      }
      if ("adoptedStyleSheets" in root) {
        for (const stylesheet of root.adoptedStyleSheets) {
          if (!allStylesheets.includes(stylesheet)) {
            allStylesheets.push(stylesheet);
          }
        }
      }
    }
    const stylesheets = allStylesheets.map((stylesheet, order) => {
      try {
        const cssText = [...stylesheet.cssRules]
          .map((rule) => rule.cssText)
          .join("\n");
        return {
          order,
          href: stylesheet.href,
          media: stylesheet.media.mediaText,
          disabled: stylesheet.disabled,
          accessible: true,
          cssText,
          failureReason: null,
        };
      } catch {
        return {
          order,
          href: stylesheet.href,
          media: stylesheet.media.mediaText,
          disabled: stylesheet.disabled,
          accessible: false,
          cssText: "",
          failureReason: "Stylesheet inaccesibil (CORS).",
        };
      }
    });

    return { inlineStyles, styleTags, stylesheets };
  });

const concatenateCss = (capture: StyleCapture): string => {
  const stylesheetBlocks = capture.stylesheets.map((stylesheet) => {
    const source = stylesheet.href ?? "<style>";
    if (!stylesheet.accessible) {
      return `/* Stylesheet inaccesibil: ${source} */`;
    }
    return `/* Stylesheet ${stylesheet.order + 1}: ${source} */\n${stylesheet.cssText}`;
  });
  const inlineBlocks = capture.inlineStyles.map(
    (style) =>
      `/* Stil inline: ${style.path} */\n${style.cssSelector} { ${style.cssText} }`,
  );
  return [...stylesheetBlocks, ...inlineBlocks].join("\n\n");
};

export const capturePage = async (
  page: Page,
  onProgress?: PageCaptureProgressListener,
): Promise<PageCapture> => {
  emit(onProgress, "preparing", 1, "Pagina curentă a fost identificată.");
  await page.waitForLoadState("domcontentloaded");
  const url = page.url();
  const title = await page.title();

  emit(onProgress, "capturing_html", 2, "Se capturează HTML-ul complet.");
  const html = await page.content();

  emit(
    onProgress,
    "capturing_accessibility",
    3,
    "Se capturează arborele de accesibilitate.",
  );
  const accessibilitySnapshot = await page
    .locator("html")
    .ariaSnapshot({ timeout: 10_000 });

  emit(
    onProgress,
    "capturing_elements",
    4,
    "Se capturează textele și elementele interactive.",
  );
  const domCapture = await captureDom(page);

  emit(onProgress, "capturing_styles", 5, "Se capturează stilurile paginii.");
  const styleCapture = await captureStyles(page);
  const inaccessibleStylesheets = styleCapture.stylesheets
    .filter(
      (
        stylesheet,
      ): stylesheet is CapturedStylesheet & {
        href: string;
        failureReason: string;
      } =>
        !stylesheet.accessible &&
        stylesheet.href !== null &&
        stylesheet.failureReason !== null,
    )
    .map(({ href, failureReason }) => ({
      href,
      reason: failureReason,
    }));
  const css = concatenateCss(styleCapture);
  const counts: PageAnalysisCounts = {
    visibleTexts: domCapture.visibleTexts.length,
    interactiveElements: domCapture.interactiveElements.length,
    forms: domCapture.forms.length,
    inputs: domCapture.inputs.length,
    buttons: domCapture.buttons.length,
    links: domCapture.links.length,
    selectableElements: domCapture.selectableElements.length,
    inlineStyles: styleCapture.inlineStyles.length,
    styleTags: styleCapture.styleTags.length,
    externalStylesheets: styleCapture.stylesheets.filter(
      ({ href }) => href !== null,
    ).length,
  };

  return {
    url,
    title,
    html,
    ...domCapture,
    accessibilitySnapshot,
    ...styleCapture,
    css,
    counts,
    inaccessibleStylesheets,
  };
};

export const toPageAnalysisProgress = (
  projectId: string,
  stage: PageAnalysisStage,
  completedSteps: number,
  message: string,
): PageAnalysisProgress => ({
  projectId,
  stage,
  completedSteps,
  totalSteps: TOTAL_CAPTURE_STEPS,
  message,
});

export { TOTAL_CAPTURE_STEPS };
