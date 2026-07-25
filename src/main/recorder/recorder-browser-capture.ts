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
  let scrollTimer: ReturnType<typeof setTimeout> | undefined;
  let lastScrollX = scrollX;
  let lastScrollY = scrollY;
  const pendingInputs = new WeakMap<Element, string>();

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
    const result: RecorderElementSnapshot = {
      tagName: element.tagName.toLowerCase(),
      dataAttributes,
      cssPath: cssPath(element),
    };
    const optionalValues = {
      inputType: element.getAttribute("type")?.toLowerCase(),
      id: element.id.length === 0 ? undefined : element.id,
      name: element.getAttribute("name") ?? undefined,
      text: compact(htmlElement.innerText ?? element.textContent),
      label: compact(labels),
      role: implicitRole(element),
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

  const emit = (event: Omit<RecorderRawEvent, "timestamp" | "url">): void => {
    if (!active || blocked) return;
    const binding = recorderGlobal[bindingName];
    if (typeof binding !== "function") return;
    setBlocked(true);
    void (binding as (value: RecorderRawEvent) => Promise<void>)({
      ...event,
      url: location.href,
      timestamp: new Date().toISOString(),
    }).catch(() => {
      setBlocked(true);
    });
  };

  const isInternal = (element: Element): boolean =>
    element.closest("[data-semantic-recorder-internal]") !== null;

  const flushInput = (element: Element): void => {
    const value = pendingInputs.get(element);
    if (value === undefined) return;
    pendingInputs.delete(element);
    emit({ type: "fill", target: snapshot(element), value });
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
        emit({
          type: "select",
          target: snapshot(event.target),
          value: event.target.value,
        });
      } else if (event.target instanceof HTMLInputElement) {
        if (event.target.type === "checkbox") {
          emit({
            type: "checkbox",
            target: snapshot(event.target),
            checked: event.target.checked,
          });
        } else if (event.target.type === "radio" && event.target.checked) {
          emit({
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
    "click",
    (event) => {
      if (!active || blocked || !(event.target instanceof Element)) return;
      const target = event.target.closest(
        "button, a, input, select, textarea, [role='button'], [role='link']",
      );
      if (target === null || isInternal(target)) return;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLSelectElement ||
        target instanceof HTMLTextAreaElement
      ) {
        return;
      }
      emit({ type: "click", target: snapshot(target) });
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
      if (textInput && event.key === "Enter") {
        flushInput(event.target);
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
      emit({
        type: "press_key",
        target: snapshot(event.target),
        key: [...modifiers, event.key].join("+"),
      });
    },
    true,
  );
  addEventListener(
    "scroll",
    () => {
      if (!active || blocked) return;
      if (scrollTimer !== undefined) clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        const deltaX = scrollX - lastScrollX;
        const deltaY = scrollY - lastScrollY;
        lastScrollX = scrollX;
        lastScrollY = scrollY;
        if (Math.abs(deltaX) + Math.abs(deltaY) >= 120) {
          emit({ type: "scroll", scrollX: deltaX, scrollY: deltaY });
        }
      }, 450);
    },
    true,
  );

  recorderGlobal[controlName] = {
    setBlocked,
    stop: () => {
      active = false;
      setBlocked(false);
      if (scrollTimer !== undefined) clearTimeout(scrollTimer);
    },
  };
};

export const installRecorderCapture = async (
  page: Page,
  bindingName: string,
  onEvent: (event: unknown) => void,
): Promise<void> => {
  const controlName = `${bindingName}Control`;
  await page.exposeBinding(bindingName, (_source, event: unknown) => {
    onEvent(event);
  });
  const options = { bindingName, controlName };
  await page.addInitScript(recorderInitScript, options);
  await page.evaluate(recorderInitScript, options);
};

export const setRecorderPageBlocked = async (
  page: Page,
  bindingName: string,
  blocked: boolean,
): Promise<void> => {
  await page.evaluate(
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

export const stopRecorderCapture = async (
  page: Page,
  bindingName: string,
): Promise<void> => {
  await page.evaluate((controlName) => {
    const globals = globalThis as unknown as Record<
      string,
      { stop?: () => void } | undefined
    >;
    globals[controlName]?.stop?.();
  }, `${bindingName}Control`);
};
