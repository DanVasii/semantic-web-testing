import type { LocatorDefinition } from "../shared/test-model.js";

export const locatorConsoleSnippet = (
  locator: LocatorDefinition,
  options: { frameOrigin?: string | undefined } = {},
): string => `(() => {
  const definition = ${JSON.stringify(locator, null, 2)};
  const expectedFrameOrigin = ${JSON.stringify(options.frameOrigin ?? "")};
  if (expectedFrameOrigin && location.origin !== expectedFrameOrigin) {
    console.warn(
      "[Locator diagnostic] Locatorul aparține frame-ului " + expectedFrameOrigin +
      ". Contextul curent este " + location.origin +
      ". Selectează frame-ul corect în consola DevTools."
    );
  }
  const normalize = (value) => String(value ?? "").replace(/\\s+/g, " ").trim();
  const values = (value) => Array.isArray(value) ? value : [value];
  const matches = (actual, value, operator, caseSensitive = false) => {
    const source = caseSensitive ? normalize(actual) : normalize(actual).toLocaleLowerCase();
    const expected = values(value).map((item) => caseSensitive ? normalize(item) : normalize(item).toLocaleLowerCase());
    if (operator === "equals") return source === (expected[0] ?? "");
    if (operator === "contains") return source.includes(expected[0] ?? "");
    if (operator === "starts_with") return source.startsWith(expected[0] ?? "");
    if (operator === "ends_with") return source.endsWith(expected[0] ?? "");
    if (operator === "contains_all_keywords") return expected.every((item) => source.includes(item));
    if (operator === "contains_any_keyword") return expected.some((item) => source.includes(item));
    return new RegExp(String(values(value)[0] ?? ""), caseSensitive ? "" : "i").test(normalize(actual));
  };
  const descendants = (scope) => Array.from(scope.querySelectorAll("*"));
  const implicitRole = (element) => {
    const explicit = element.getAttribute("role");
    if (explicit) return explicit;
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    if (tag === "button") return "button";
    if (tag === "a" && element.hasAttribute("href")) return "link";
    if (tag === "select") return "combobox";
    if (tag === "textarea") return "textbox";
    if (tag === "input") {
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (["button", "submit", "reset"].includes(type)) return "button";
      if (type !== "hidden") return "textbox";
    }
    return "";
  };
  const referencedText = (element) => normalize((element.getAttribute("aria-labelledby") ?? "")
    .split(/\\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" "));
  const labelText = (element) => normalize([
    ...Array.from(element.labels ?? []).map((label) => label.textContent ?? ""),
    element.getAttribute("aria-label") ?? "",
    referencedText(element),
  ].filter(Boolean).join(" "));
  const accessibleName = (element) => {
    const tag = element.tagName.toLowerCase();
    const type = (element.getAttribute("type") ?? "").toLowerCase();
    const inputValueName = tag === "input" && ["button", "submit", "reset"].includes(type)
      ? element.value
      : "";
    return normalize(
      element.getAttribute("aria-label") ||
      referencedText(element) ||
      labelText(element) ||
      element.getAttribute("alt") ||
      inputValueName ||
      element.textContent ||
      element.getAttribute("title")
    );
  };
  const resolveSimple = (item, scope) => {
    if (item.type === "css") return Array.from(scope.querySelectorAll(Array.isArray(item.value) ? item.value.join(" ") : item.value));
    let candidates = descendants(scope);
    if (item.type === "role") candidates = candidates.filter((element) => implicitRole(element) === (item.role ?? "button"));
    if (item.type === "label") candidates = candidates.filter((element) => "labels" in element || element.hasAttribute("aria-label") || element.hasAttribute("aria-labelledby"));
    if (item.type === "title") candidates = candidates.filter((element) => element.hasAttribute("title"));
    if (item.type === "placeholder") candidates = candidates.filter((element) => element.hasAttribute("placeholder"));
    if (item.type === "data_attribute") candidates = candidates.filter((element) => element.hasAttribute(item.attribute ?? "data-testid"));
    const actual = (element) => item.type === "role" ? accessibleName(element)
      : item.type === "label" ? labelText(element)
      : item.type === "title" ? element.getAttribute("title")
      : item.type === "placeholder" ? element.getAttribute("placeholder")
      : item.type === "data_attribute" ? element.getAttribute(item.attribute ?? "data-testid")
      : element.textContent;
    const matched = candidates.filter((element) => matches(actual(element), item.value, item.operator, item.caseSensitive));
    if (item.type !== "text") return matched;
    return matched.filter((element) => !Array.from(element.children).some((child) => matches(child.textContent, item.value, item.operator, item.caseSensitive)));
  };
  const unique = (elements) => Array.from(new Set(elements));
  const resolve = (item, scope = document) => {
    if (item.type !== "relative" && item.type !== "repeated_component") return resolveSimple(item, scope);
    if (item.type === "relative") {
      const anchors = resolve(item.anchor, scope);
      if (item.relation === "inside") return unique(anchors.flatMap((anchor) => resolve(item.target, anchor)));
      const targets = new Set(resolve(item.target, scope));
      const related = [];
      for (const anchor of anchors) {
        if (item.relation === "parent" && anchor.parentElement) related.push(anchor.parentElement);
        if (item.relation === "ancestor") for (let current = anchor.parentElement; current; current = current.parentElement) related.push(current);
        if (item.relation === "sibling" && anchor.parentElement) related.push(...Array.from(anchor.parentElement.children).filter((element) => element !== anchor));
        if (item.relation === "following" || item.relation === "preceding") {
          for (const candidate of descendants(scope)) {
            const position = anchor.compareDocumentPosition(candidate);
            if (item.relation === "following" && (position & Node.DOCUMENT_POSITION_FOLLOWING)) related.push(candidate);
            if (item.relation === "preceding" && (position & Node.DOCUMENT_POSITION_PRECEDING)) related.push(candidate);
          }
        }
      }
      return unique(related).filter((element) => targets.has(element));
    }
    let containers = resolve(item.container, scope);
    for (const filter of item.filters) {
      containers = containers.filter((container) => resolve(filter.field, container)
        .some((field) => matches(field.textContent, filter.value, filter.operator, filter.caseSensitive)));
    }
    return unique(containers.flatMap((container) => resolve(item.targetInsideContainer, container)));
  };
  const elements = resolve(definition);
  console.info("[Locator diagnostic]", elements.length, "element(e) găsit(e)");
  console.table(elements.map((element, index) => ({
    index,
    tag: element.tagName.toLowerCase(),
    id: element.id,
    role: implicitRole(element),
    name: accessibleName(element).slice(0, 120),
  })));
  return elements;
})()`;
