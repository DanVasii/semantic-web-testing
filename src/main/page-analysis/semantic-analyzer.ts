import type {
  CalendarCandidateAnalysis,
  RepeatedComponentAnalysis,
  SemanticAnalysis,
  SemanticElementAnalysis,
  SemanticElementReference,
  SemanticLocatorCandidate,
  SemanticLocatorStrategy,
  SlotListAnalysis,
} from "../../shared/semantic-analysis.js";
import type { CapturedElement, PageCapture } from "./page-capture.js";

export interface SemanticAnalyzerOptions {
  generatedAt: string;
  url: string;
}

interface SemanticContext {
  allElements: CapturedElement[];
  byPath: Map<string, CapturedElement>;
  byId: Map<string, CapturedElement>;
  childrenByParent: Map<string, CapturedElement[]>;
}

const ACTION_ROLES = new Set([
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

const REPEATABLE_TAGS = new Set(["article", "div", "li", "section", "tr"]);
const SEMANTIC_CLASS_WORDS = new Set([
  "appointment",
  "booking",
  "card",
  "day",
  "item",
  "product",
  "result",
  "row",
  "service",
  "slot",
  "time",
]);
const DYNAMIC_TOKEN =
  /(?:^|[-_])(?:react|vue|ember|generated|uuid)(?:[-_]|$)|[a-f\d]{12,}|\d{6,}/i;
const TIME_TEXT =
  /^(?:[01]?\d|2[0-3]):[0-5]\d(?:\s*[-–]\s*(?:[01]?\d|2[0-3]):[0-5]\d)?$/;
const CALENDAR_MARKER =
  /calendar|datepicker|date-picker|date_grid|booking-date/i;
const SLOT_MARKER =
  /time-slot|timeslot|slot-list|time-list|appointment-slot|booking-slot/i;

const phraseTranslations: readonly [RegExp, string][] = [
  [/\bemail client\b/, "customer_email"],
  [/\badresa de email\b/, "email"],
  [/\bnume de familie\b/, "last_name"],
  [/\bprenume\b/, "first_name"],
  [/\bcod postal\b/, "postal_code"],
  [/\badauga in cos\b/, "add_to_cart"],
  [/\btrimite formularul\b/, "submit_form"],
  [/\bfinalizeaza comanda\b/, "complete_order"],
  [/\bdata programarii\b/, "booking_date"],
  [/\bora programarii\b/, "booking_time"],
  [/\bprimeste noutati\b/, "newsletter"],
];

const tokenTranslations: Readonly<Record<string, string>> = {
  actiune: "action",
  adauga: "add",
  adresa: "address",
  alege: "choose",
  buton: "button",
  calendar: "calendar",
  cantitate: "quantity",
  cauta: "search",
  client: "customer",
  comanda: "order",
  continua: "continue",
  cos: "cart",
  cumpara: "buy",
  data: "date",
  disponibil: "available",
  email: "email",
  familie: "family",
  formular: "form",
  judet: "county",
  nume: "name",
  noutati: "newsletter",
  oras: "city",
  ora: "time",
  parola: "password",
  plata: "payment",
  pret: "price",
  produs: "product",
  programare: "booking",
  rezerva: "book",
  serviciu: "service",
  telefon: "phone",
  titlu: "title",
  trimite: "submit",
  utilizator: "username",
};

const stopWords = new Set([
  "a",
  "al",
  "ale",
  "cu",
  "de",
  "din",
  "in",
  "la",
  "pentru",
  "pe",
  "si",
]);

const clamp = (value: number): number =>
  Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;

const normalizeWords = (value: string): string =>
  value
    .normalize("NFD")
    .replaceAll(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, " ")
    .trim();

const slug = (value: string): string =>
  normalizeWords(value).replaceAll(/\s+/g, "_");

const englishSlug = (value: string): string => {
  const normalized = normalizeWords(value);
  for (const [pattern, translation] of phraseTranslations) {
    if (pattern.test(normalized)) {
      return translation;
    }
  }

  const translated = normalized
    .split(" ")
    .filter((token) => token.length > 0 && !stopWords.has(token))
    .map((token) => tokenTranslations[token] ?? token)
    .filter(
      (token, index, tokens) => index === 0 || token !== tokens[index - 1],
    )
    .join("_");
  return translated.length > 0 ? translated : "element";
};

const stableClassTokens = (element: CapturedElement): string[] =>
  (element.attributes.class ?? "")
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(
      (token) =>
        token.length > 1 &&
        token.length < 80 &&
        !DYNAMIC_TOKEN.test(token) &&
        !["active", "disabled", "focus", "hover", "selected"].includes(
          token.toLowerCase(),
        ),
    )
    .sort();

const createContext = (allElements: CapturedElement[]): SemanticContext => {
  const byPath = new Map(allElements.map((element) => [element.path, element]));
  const byId = new Map(
    allElements
      .filter((element) => (element.attributes.id ?? "").length > 0)
      .map((element) => [element.attributes.id!, element]),
  );
  const childrenByParent = new Map<string, CapturedElement[]>();
  for (const element of allElements) {
    if (element.parentPath === null) {
      continue;
    }
    const children = childrenByParent.get(element.parentPath) ?? [];
    children.push(element);
    childrenByParent.set(element.parentPath, children);
  }
  return { allElements, byPath, byId, childrenByParent };
};

const descendantsOf = (
  path: string,
  context: SemanticContext,
): CapturedElement[] =>
  context.allElements.filter(
    (element) =>
      element.path.startsWith(`${path}/`) ||
      element.path.startsWith(`${path}::shadow/`),
  );

const implicitRole = (element: CapturedElement): string => {
  const explicit = element.attributes.role?.trim();
  if (explicit) {
    return explicit;
  }

  const type = (element.attributes.type ?? "").toLowerCase();
  switch (element.tag) {
    case "a":
      return element.attributes.href === undefined ? "generic" : "link";
    case "button":
    case "summary":
      return "button";
    case "textarea":
      return "textbox";
    case "select":
      return element.attributes.multiple === undefined ? "combobox" : "listbox";
    case "option":
      return "option";
    case "input":
      if (["button", "image", "reset", "submit"].includes(type)) {
        return "button";
      }
      if (type === "checkbox") {
        return "checkbox";
      }
      if (type === "radio") {
        return "radio";
      }
      if (type === "range") {
        return "slider";
      }
      if (type === "number") {
        return "spinbutton";
      }
      if (type === "search") {
        return "searchbox";
      }
      if (type === "hidden") {
        return "none";
      }
      return "textbox";
    case "h1":
    case "h2":
    case "h3":
    case "h4":
    case "h5":
    case "h6":
      return "heading";
    case "form":
      return "form";
    case "li":
      return "listitem";
    case "ol":
    case "ul":
      return "list";
    case "table":
      return "table";
    case "tr":
      return "row";
    case "td":
      return "cell";
    case "th":
      return "columnheader";
    default:
      return element.attributes.contenteditable === "true"
        ? "textbox"
        : "generic";
  }
};

const textFromIds = (value: string, context: SemanticContext): string =>
  value
    .split(/\s+/)
    .map((id) => context.byId.get(id)?.text.trim() ?? "")
    .filter((text) => text.length > 0)
    .join(" ");

const detectLabel = (
  element: CapturedElement,
  context: SemanticContext,
): string | undefined => {
  const id = element.attributes.id;
  if (id) {
    const explicitLabel = context.allElements.find(
      (candidate) =>
        candidate.tag === "label" && candidate.attributes.for === id,
    );
    const text = explicitLabel?.text.replaceAll(/\s+/g, " ").trim();
    if (text) {
      return text;
    }
  }

  let parentPath = element.parentPath;
  while (parentPath !== null) {
    const parent = context.byPath.get(parentPath);
    if (parent === undefined) {
      break;
    }
    if (parent.tag === "label") {
      const text = parent.text.replaceAll(/\s+/g, " ").trim();
      if (text.length > 0) {
        return text;
      }
    }
    parentPath = parent.parentPath;
  }
  return undefined;
};

const accessibleName = (
  element: CapturedElement,
  label: string | undefined,
  context: SemanticContext,
): string => {
  const ariaLabel = element.attributes["aria-label"]?.trim();
  if (ariaLabel) {
    return ariaLabel;
  }
  const labelledBy = element.attributes["aria-labelledby"];
  if (labelledBy) {
    const labelledText = textFromIds(labelledBy, context);
    if (labelledText.length > 0) {
      return labelledText;
    }
  }
  if (label) {
    return label;
  }
  for (const attribute of ["alt", "title", "placeholder", "value"] as const) {
    const value = element.attributes[attribute]?.trim();
    if (value) {
      return value;
    }
  }
  return element.text.replaceAll(/\s+/g, " ").trim().slice(0, 200);
};

const isDynamicIdentifier = (value: string): boolean =>
  value.length > 100 || DYNAMIC_TOKEN.test(value);

const elementMatchesStrategy = (
  element: CapturedElement,
  strategy: SemanticLocatorStrategy,
  context: SemanticContext,
): boolean => {
  const expected = Array.isArray(strategy.value)
    ? strategy.value.join(" ")
    : strategy.value;
  switch (strategy.type) {
    case "data_attribute":
      return (
        strategy.attribute !== undefined &&
        element.attributes[strategy.attribute] === expected
      );
    case "label":
      return detectLabel(element, context) === expected;
    case "role": {
      const label = detectLabel(element, context);
      return (
        implicitRole(element) === strategy.role &&
        accessibleName(element, label, context) === expected
      );
    }
    case "placeholder":
      return element.attributes.placeholder === expected;
    case "title":
      return element.attributes.title === expected;
    case "text":
      return element.text.replaceAll(/\s+/g, " ").trim() === expected;
    case "css": {
      if (expected.startsWith("#")) {
        return element.attributes.id === expected.slice(1);
      }
      if (expected.startsWith(".")) {
        return stableClassTokens(element).includes(expected.slice(1));
      }
      return element.cssSelector === expected;
    }
    default:
      return false;
  }
};

const locatorCandidate = (
  strategy: SemanticLocatorStrategy,
  baseStability: number,
  reason: string,
  context: SemanticContext,
): SemanticLocatorCandidate => {
  const matchCount = context.allElements.filter((element) =>
    elementMatchesStrategy(element, strategy, context),
  ).length;
  const unique = matchCount === 1;
  return {
    strategy,
    unique,
    stability: clamp(baseStability * (unique ? 1 : 0.72)),
    reason: unique ? reason : `${reason} Potrivirea nu este unică.`,
  };
};

const candidateKey = (candidate: SemanticLocatorCandidate): string =>
  JSON.stringify(candidate.strategy);

const locatorCandidates = (
  element: CapturedElement,
  role: string,
  name: string,
  label: string | undefined,
  context: SemanticContext,
): SemanticLocatorCandidate[] => {
  const candidates: SemanticLocatorCandidate[] = [];
  const stableDataAttributes = [
    "data-testid",
    "data-test",
    "data-qa",
    "data-cy",
    "data-field",
    "data-component",
  ];
  for (const attribute of stableDataAttributes) {
    const value = element.attributes[attribute]?.trim();
    if (value && !isDynamicIdentifier(value)) {
      candidates.push(
        locatorCandidate(
          {
            type: "data_attribute",
            attribute,
            operator: "equals",
            value,
          },
          attribute === "data-field" ? 0.94 : 0.98,
          `Atribut stabil ${attribute}.`,
          context,
        ),
      );
    }
  }

  const id = element.attributes.id?.trim();
  if (id && !isDynamicIdentifier(id)) {
    candidates.push(
      locatorCandidate(
        { type: "css", operator: "equals", value: `#${id}` },
        0.93,
        "ID stabil și lizibil.",
        context,
      ),
    );
  }
  if (label) {
    candidates.push(
      locatorCandidate(
        { type: "label", operator: "equals", value: label },
        0.92,
        "Label asociat controlului.",
        context,
      ),
    );
  }
  if (role !== "generic" && role !== "none" && name.length > 0) {
    candidates.push(
      locatorCandidate(
        { type: "role", role, operator: "equals", value: name },
        0.9,
        "Rol și accessible name.",
        context,
      ),
    );
  }
  const placeholder = element.attributes.placeholder?.trim();
  if (placeholder) {
    candidates.push(
      locatorCandidate(
        { type: "placeholder", operator: "equals", value: placeholder },
        0.72,
        "Placeholder-ul controlului.",
        context,
      ),
    );
  }
  const title = element.attributes.title?.trim();
  if (title) {
    candidates.push(
      locatorCandidate(
        { type: "title", operator: "equals", value: title },
        0.7,
        "Atribut title.",
        context,
      ),
    );
  }
  const classToken = stableClassTokens(element)[0];
  if (classToken) {
    candidates.push(
      locatorCandidate(
        { type: "css", operator: "equals", value: `.${classToken}` },
        0.65,
        "Clasă CSS stabilă.",
        context,
      ),
    );
  }
  const text = element.text.replaceAll(/\s+/g, " ").trim();
  if (text.length > 0 && text.length <= 120) {
    candidates.push(
      locatorCandidate(
        { type: "text", operator: "equals", value: text },
        0.55,
        "Text vizibil.",
        context,
      ),
    );
  }
  candidates.push(
    locatorCandidate(
      { type: "css", operator: "equals", value: element.cssSelector },
      element.cssSelector.includes(":nth-of-type") ? 0.28 : 0.5,
      "Calea CSS exactă din captura DOM.",
      context,
    ),
  );

  const uniqueCandidates = new Map<string, SemanticLocatorCandidate>();
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (!uniqueCandidates.has(key)) {
      uniqueCandidates.set(key, candidate);
    }
  }
  return [...uniqueCandidates.values()].sort(
    (left, right) => right.stability - left.stability,
  );
};

const semanticBase = (
  element: CapturedElement,
  name: string,
  label: string | undefined,
  role: string,
): string => {
  const technicalName =
    element.attributes["data-field"] ?? element.attributes.name;
  let base =
    technicalName?.trim() ||
    label ||
    name ||
    element.attributes.id ||
    element.attributes.placeholder ||
    element.tag;
  base = technicalName ? slug(base) : englishSlug(base);

  if (role === "button" && !base.endsWith("_button")) {
    return `${base}_button`;
  }
  if (role === "link" && !base.endsWith("_link")) {
    return `${base}_link`;
  }
  return base;
};

const relevantElements = (
  capture: PageCapture,
  context: SemanticContext,
): CapturedElement[] => {
  const relevantPaths = new Set([
    ...capture.interactiveElements.map(({ path }) => path),
    ...capture.inputs.map(({ path }) => path),
    ...capture.buttons.map(({ path }) => path),
    ...capture.links.map(({ path }) => path),
    ...capture.selectableElements.map(({ path }) => path),
    ...context.allElements
      .filter(
        (element) =>
          /^h[1-6]$/.test(element.tag) ||
          element.attributes["data-field"] !== undefined ||
          element.attributes.role === "grid" ||
          CALENDAR_MARKER.test(
            `${element.attributes.id ?? ""} ${element.attributes.class ?? ""} ${
              element.attributes["data-component"] ?? ""
            }`,
          ),
      )
      .map(({ path }) => path),
  ]);
  return context.allElements
    .filter((element) => relevantPaths.has(element.path))
    .sort((left, right) => left.path.localeCompare(right.path));
};

const analyzeElements = (
  capture: PageCapture,
  context: SemanticContext,
): SemanticElementAnalysis[] => {
  const usedFieldIds = new Map<string, number>();
  return relevantElements(capture, context).map((element) => {
    const label = detectLabel(element, context);
    const role = implicitRole(element);
    const name = accessibleName(element, label, context);
    const semanticId = semanticBase(element, name, label, role);
    const baseFieldId = /^[a-z_]/.test(semanticId)
      ? semanticId
      : `${role}_${semanticId}`;
    const occurrence = (usedFieldIds.get(baseFieldId) ?? 0) + 1;
    usedFieldIds.set(baseFieldId, occurrence);
    const fieldId =
      occurrence === 1 ? baseFieldId : `${baseFieldId}_${occurrence}`;
    const candidates = locatorCandidates(element, role, name, label, context);
    const primaryLocator = candidates[0]!;

    return {
      path: element.path,
      tag: element.tag,
      role,
      accessibleName: name,
      fieldId,
      ...(label === undefined ? {} : { label }),
      primaryLocator,
      fallbackLocators: candidates.slice(1, 4),
      locatorStability: primaryLocator.stability,
    };
  });
};

const structureSignature = (
  element: CapturedElement,
  context: SemanticContext,
): string => {
  const classes = stableClassTokens(element).join(".");
  const component = element.attributes["data-component"] ?? "";
  const children = (context.childrenByParent.get(element.path) ?? [])
    .map(
      (child) =>
        `${child.tag}:${implicitRole(child)}:${stableClassTokens(child).join(".")}`,
    )
    .sort()
    .join("|");
  return `${element.tag}|${classes}|${component}|${children}`;
};

const componentName = (element: CapturedElement): string => {
  const source =
    element.attributes["data-component"] ??
    stableClassTokens(element).find((token) =>
      [...SEMANTIC_CLASS_WORDS].some((word) =>
        token.toLowerCase().includes(word),
      ),
    );
  if (source) {
    return englishSlug(source)
      .split("_")
      .map((word, index) =>
        index === 0 ? `${word.charAt(0).toUpperCase()}${word.slice(1)}` : word,
      )
      .join(" ");
  }
  if (element.tag === "tr") {
    return "Table row";
  }
  if (element.tag === "li") {
    return "List item";
  }
  return "Repeated item";
};

const repeatedContainerLocator = (
  element: CapturedElement,
  context: SemanticContext,
): SemanticLocatorCandidate => {
  const dataComponent = element.attributes["data-component"]?.trim();
  if (dataComponent) {
    return locatorCandidate(
      {
        type: "data_attribute",
        attribute: "data-component",
        operator: "equals",
        value: dataComponent,
      },
      0.92,
      "Tipul componentei este marcat prin data-component.",
      context,
    );
  }
  const classToken = stableClassTokens(element)[0];
  if (classToken) {
    return locatorCandidate(
      { type: "css", operator: "equals", value: `.${classToken}` },
      0.75,
      "Clasa comună identifică toate instanțele componentei.",
      context,
    );
  }
  return locatorCandidate(
    { type: "css", operator: "equals", value: element.cssSelector },
    0.3,
    "Fallback structural pentru container.",
    context,
  );
};

const toReference = (
  analysis: SemanticElementAnalysis,
): SemanticElementReference => ({
  path: analysis.path,
  fieldId: analysis.fieldId,
  role: analysis.role,
  accessibleName: analysis.accessibleName,
  primaryLocator: analysis.primaryLocator,
});

const detectRepeatedComponents = (
  context: SemanticContext,
  elements: SemanticElementAnalysis[],
): RepeatedComponentAnalysis[] => {
  const grouped = new Map<string, CapturedElement[]>();

  for (const element of context.allElements) {
    if (
      element.parentPath === null ||
      !REPEATABLE_TAGS.has(element.tag) ||
      element.states.disabled
    ) {
      continue;
    }
    const key = `${element.parentPath}\0${structureSignature(element, context)}`;
    const group = grouped.get(key) ?? [];
    group.push(element);
    grouped.set(key, group);
  }

  const components: RepeatedComponentAnalysis[] = [];
  for (const items of grouped.values()) {
    if (items.length < 2) {
      continue;
    }
    const first = items[0]!;
    const classes = stableClassTokens(first);
    const semanticClass = classes.some((token) =>
      [...SEMANTIC_CLASS_WORDS].some((word) =>
        token.toLowerCase().includes(word),
      ),
    );
    const itemDescendants = descendantsOf(first.path, context);
    const hasUsefulStructure =
      itemDescendants.length >= 2 &&
      itemDescendants.some((element) =>
        ACTION_ROLES.has(implicitRole(element)),
      );
    if (
      !semanticClass &&
      !["li", "tr", "article"].includes(first.tag) &&
      !hasUsefulStructure
    ) {
      continue;
    }

    const childAnalyses = elements.filter((element) =>
      element.path.startsWith(`${first.path}/`),
    );
    const actions = childAnalyses.filter((element) =>
      ACTION_ROLES.has(element.role),
    );
    const title =
      childAnalyses.find((element) =>
        /^h[1-6]$/.test(context.byPath.get(element.path)?.tag ?? ""),
      ) ??
      childAnalyses.find((element) =>
        /title|name/i.test(
          context.byPath.get(element.path)?.attributes.class ?? "",
        ),
      ) ??
      childAnalyses.find(
        (element) =>
          element.role === "link" && element.accessibleName.length > 0,
      );
    const semanticName = componentName(first);
    components.push({
      id: `${slug(semanticName)}_${components.length + 1}`,
      semanticName,
      containerSelector: repeatedContainerLocator(first, context),
      repeatedCount: items.length,
      itemPaths: items.map(({ path }) => path),
      childFields: childAnalyses.map(toReference),
      actions: actions.map(toReference),
      ...(title === undefined ? {} : { titleField: toReference(title) }),
    });
  }

  return components.sort(
    (left, right) =>
      left.itemPaths[0]!.localeCompare(right.itemPaths[0]!) ||
      left.id.localeCompare(right.id),
  );
};

const elementLocator = (
  element: CapturedElement,
  analysesByPath: Map<string, SemanticElementAnalysis>,
  context: SemanticContext,
): SemanticLocatorCandidate => {
  const analysis = analysesByPath.get(element.path);
  if (analysis) {
    return analysis.primaryLocator;
  }
  const label = detectLabel(element, context);
  const role = implicitRole(element);
  const name = accessibleName(element, label, context);
  return locatorCandidates(element, role, name, label, context)[0]!;
};

const detectCalendars = (
  context: SemanticContext,
  elements: SemanticElementAnalysis[],
): CalendarCandidateAnalysis[] => {
  const analysesByPath = new Map(
    elements.map((element) => [element.path, element]),
  );
  const candidates: CalendarCandidateAnalysis[] = [];
  for (const element of context.allElements) {
    const marker = `${element.attributes.id ?? ""} ${
      element.attributes.class ?? ""
    } ${element.attributes["data-component"] ?? ""}`;
    const isDateInput =
      element.tag === "input" && element.attributes.type === "date";
    const isCalendarDay =
      element.attributes.role === "gridcell" ||
      /calendar-day|date-cell/i.test(marker);
    const isCalendar =
      isDateInput ||
      element.attributes.role === "grid" ||
      (!isCalendarDay && CALENDAR_MARKER.test(marker));
    if (!isCalendar) {
      continue;
    }
    const descendants = descendantsOf(element.path, context);
    const dayElementPaths = descendants
      .filter((candidate) => {
        const childMarker = `${candidate.attributes.id ?? ""} ${
          candidate.attributes.class ?? ""
        }`;
        return (
          candidate.attributes.role === "gridcell" ||
          /\bday\b|calendar-day|date-cell/i.test(childMarker)
        );
      })
      .map(({ path }) => path);
    const confidence = clamp(
      (isDateInput ? 0.75 : 0) +
        (element.attributes.role === "grid" ? 0.55 : 0) +
        (CALENDAR_MARKER.test(marker) ? 0.35 : 0) +
        (dayElementPaths.length >= 7 ? 0.15 : 0),
    );
    candidates.push({
      id: `calendar_${candidates.length + 1}`,
      semanticName:
        accessibleName(element, detectLabel(element, context), context) ||
        "Calendar",
      path: element.path,
      locator: elementLocator(element, analysesByPath, context),
      confidence,
      dayElementPaths,
    });
  }
  return candidates;
};

const detectSlotLists = (
  context: SemanticContext,
  elements: SemanticElementAnalysis[],
  repeatedComponents: RepeatedComponentAnalysis[],
): SlotListAnalysis[] => {
  const analysesByPath = new Map(
    elements.map((element) => [element.path, element]),
  );
  const slotPathsByContainer = new Map<string, Set<string>>();

  for (const element of context.allElements) {
    const marker = `${element.attributes.id ?? ""} ${
      element.attributes.class ?? ""
    } ${element.attributes["data-component"] ?? ""}`;
    if (SLOT_MARKER.test(marker)) {
      const slots = descendantsOf(element.path, context)
        .filter((candidate) =>
          TIME_TEXT.test(candidate.text.replaceAll(/\s+/g, " ").trim()),
        )
        .map(({ path }) => path);
      if (slots.length >= 2) {
        slotPathsByContainer.set(element.path, new Set(slots));
      }
    }
  }

  for (const [parentPath, children] of context.childrenByParent) {
    const timeChildren = children.filter((element) =>
      TIME_TEXT.test(element.text.replaceAll(/\s+/g, " ").trim()),
    );
    if (timeChildren.length >= 2) {
      slotPathsByContainer.set(
        parentPath,
        new Set(timeChildren.map(({ path }) => path)),
      );
    }
  }

  for (const component of repeatedComponents) {
    if (/slot|time/i.test(component.semanticName)) {
      const parent = context.byPath.get(component.itemPaths[0]!)?.parentPath;
      if (parent) {
        slotPathsByContainer.set(parent, new Set(component.itemPaths));
      }
    }
  }

  return [...slotPathsByContainer.entries()].flatMap(
    ([path, slotElementPaths], index): SlotListAnalysis[] => {
      const element = context.byPath.get(path);
      if (element === undefined) {
        return [];
      }
      return [
        {
          id: `slot_list_${index + 1}`,
          semanticName:
            accessibleName(element, detectLabel(element, context), context) ||
            "Time slots",
          path,
          locator: elementLocator(element, analysesByPath, context),
          confidence: clamp(0.65 + Math.min(slotElementPaths.size, 4) * 0.08),
          slotElementPaths: [...slotElementPaths].sort(),
        },
      ];
    },
  );
};

export const analyzePageSemantics = (
  capture: PageCapture,
  options: SemanticAnalyzerOptions,
): SemanticAnalysis => {
  const context = createContext(capture.allElements);
  const elements = analyzeElements(capture, context);
  const repeatedComponents = detectRepeatedComponents(context, elements);

  return {
    schemaVersion: 1,
    generatedAt: options.generatedAt,
    url: options.url,
    elements,
    repeatedComponents,
    calendarCandidates: detectCalendars(context, elements),
    slotLists: detectSlotLists(context, elements, repeatedComponents),
  };
};
