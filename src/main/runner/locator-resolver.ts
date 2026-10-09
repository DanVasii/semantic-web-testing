import type { Frame, Locator, Page } from "playwright-core";

import type {
  LocatorDefinition,
  MatchOperator,
  SimpleLocator,
  TargetFrameContext,
} from "../../shared/test-model.js";

type LocatorScope = Pick<
  Page,
  | "getByLabel"
  | "getByPlaceholder"
  | "getByRole"
  | "getByText"
  | "getByTitle"
  | "locator"
>;

type SearchScope = Page | Frame;

type BehaviorFingerprint = {
  kind: "link" | "submit" | "button";
  action: string;
  attributes: Record<string, string>;
};

export class LocatorResolutionError extends Error {
  public constructor(
    public readonly code: "locator_not_found" | "locator_ambiguous",
    public readonly count: number,
  ) {
    super(
      count === 0
        ? "Locatorul nu a găsit niciun element."
        : `Locatorul este ambiguu: au fost găsite ${count} elemente.`,
    );
    this.name = "LocatorResolutionError";
  }
}

const escapeRegex = (value: string): string =>
  value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const asValues = (value: string | string[]): string[] =>
  Array.isArray(value) ? value : [value];

export const createMatchPattern = (
  value: string | string[],
  operator: MatchOperator,
  caseSensitive = false,
): RegExp => {
  const values = asValues(value);
  const flags = caseSensitive ? "" : "i";
  const first = escapeRegex(values[0] ?? "");
  switch (operator) {
    case "equals":
      return new RegExp(`^${first}$`, flags);
    case "contains":
      return new RegExp(first, flags);
    case "starts_with":
      return new RegExp(`^${first}`, flags);
    case "ends_with":
      return new RegExp(`${first}$`, flags);
    case "regex":
      return new RegExp(values[0] ?? "", flags);
    case "contains_all_keywords":
      return new RegExp(
        values.map((item) => `(?=.*${escapeRegex(item)})`).join(""),
        flags,
      );
    case "contains_any_keyword":
      return new RegExp(values.map(escapeRegex).join("|"), flags);
  }
};

export const matchesValue = (
  actual: string,
  value: string | string[],
  operator: MatchOperator,
  caseSensitive = false,
): boolean => createMatchPattern(value, operator, caseSensitive).test(actual);

const escapeCssString = (value: string): string =>
  value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');

const resolveSimple = (
  scope: LocatorScope,
  locator: SimpleLocator,
): Locator => {
  const pattern = createMatchPattern(
    locator.value,
    locator.operator,
    locator.caseSensitive,
  );
  const value = Array.isArray(locator.value)
    ? locator.value.join(" ")
    : locator.value;

  switch (locator.type) {
    case "css":
      return scope.locator(value);
    case "role":
      return scope.getByRole(
        (locator.role ?? "button") as Parameters<Page["getByRole"]>[0],
        { name: pattern },
      );
    case "label":
      return scope.getByLabel(pattern);
    case "text":
      return scope.getByText(pattern);
    case "title":
      return scope.getByTitle(pattern);
    case "placeholder":
      return scope.getByPlaceholder(pattern);
    case "data_attribute": {
      const attribute = locator.attribute ?? "data-testid";
      const safeAttribute = attribute.replace(/[^a-zA-Z0-9_.:-]/g, "");
      const safeValue = escapeCssString(value);
      switch (locator.operator) {
        case "equals":
          return scope.locator(`[${safeAttribute}="${safeValue}"]`);
        case "contains":
        case "contains_all_keywords":
        case "contains_any_keyword":
          return scope.locator(`[${safeAttribute}*="${safeValue}"]`);
        case "starts_with":
          return scope.locator(`[${safeAttribute}^="${safeValue}"]`);
        case "ends_with":
          return scope.locator(`[${safeAttribute}$="${safeValue}"]`);
        case "regex":
          return scope
            .locator(`[${safeAttribute}]`)
            .filter({ hasText: pattern });
      }
    }
  }
};

export const resolveLocator = (
  page: Page,
  definition: LocatorDefinition,
  scope: LocatorScope = page,
): Locator => {
  if (
    definition.type !== "relative" &&
    definition.type !== "repeated_component"
  ) {
    return resolveSimple(scope, definition);
  }

  if (definition.type === "relative") {
    const anchor = resolveLocator(page, definition.anchor, scope);
    if (definition.relation === "inside") {
      return resolveLocator(page, definition.target, anchor);
    }
    const target = resolveLocator(page, definition.target, scope);
    const related =
      definition.relation === "parent"
        ? anchor.locator("xpath=parent::*")
        : definition.relation === "ancestor"
          ? anchor.locator("xpath=ancestor::*")
          : definition.relation === "sibling"
            ? anchor.locator(
                "xpath=following-sibling::* | preceding-sibling::*",
              )
            : definition.relation === "following"
              ? anchor.locator("xpath=following::*")
              : anchor.locator("xpath=preceding::*");
    return related.and(target);
  }

  let containers = resolveLocator(page, definition.container, scope);
  for (const filter of definition.filters) {
    const matchingField = resolveLocator(page, filter.field, containers).filter(
      {
        hasText: createMatchPattern(
          filter.value,
          filter.operator,
          filter.caseSensitive,
        ),
      },
    );
    containers = containers.filter({ has: matchingField });
  }
  return resolveLocator(page, definition.targetInsideContainer, containers);
};

const behaviorFingerprint = async (
  locator: Locator,
): Promise<BehaviorFingerprint | undefined> => {
  try {
    return await locator.evaluate(
      (element): BehaviorFingerprint | undefined => {
        const htmlElement = element as HTMLElement;
        const tag = element.tagName.toLowerCase();
        const type =
          tag === "button" || tag === "input"
            ? (
                element.getAttribute("type") ??
                (tag === "button" ? "submit" : "text")
              ).toLowerCase()
            : "";
        const dataAttributes: Record<string, string> = {};
        for (const { name, value } of [...element.attributes]
          .filter(({ name }) => name.startsWith("data-"))
          .sort((left, right) => left.name.localeCompare(right.name))) {
          dataAttributes[name] = value;
        }
        const common = {
          ...dataAttributes,
          onclick: element.getAttribute("onclick") ?? "",
        };

        if (tag === "a" && element instanceof HTMLAnchorElement) {
          return {
            kind: "link" as const,
            action: element.href,
            attributes: {
              ...common,
              download: element.download,
              rel: element.rel,
              target: element.target,
            },
          };
        }

        if (
          (tag === "button" || tag === "input") &&
          ["submit", "image"].includes(type)
        ) {
          const control = element as HTMLButtonElement | HTMLInputElement;
          const form = control.form;
          const formAction = control.getAttribute("formaction");
          return {
            kind: "submit" as const,
            action:
              formAction === null
                ? (form?.action ?? "")
                : new URL(formAction, element.baseURI).href,
            attributes: {
              ...common,
              formMethod:
                control.getAttribute("formmethod") ?? form?.method ?? "get",
              formTarget:
                control.getAttribute("formtarget") ?? form?.target ?? "",
              name: control.name,
              type,
              value: control.value,
            },
          };
        }

        if (
          (tag === "button" || element.getAttribute("role") === "button") &&
          (common.onclick.length > 0 || Object.keys(dataAttributes).length > 0)
        ) {
          return {
            kind: "button" as const,
            action: common.onclick,
            attributes: {
              ...common,
              ariaControls: element.getAttribute("aria-controls") ?? "",
              ariaExpanded: element.getAttribute("aria-expanded") ?? "",
              name: htmlElement.getAttribute("name") ?? "",
              type,
              value: htmlElement.getAttribute("value") ?? "",
            },
          };
        }
        return undefined;
      },
    );
  } catch {
    return undefined;
  }
};

const chooseEquivalentActionable = async (
  candidates: Locator[],
  preferInteractive: boolean,
): Promise<Locator | undefined> => {
  const actionable: Locator[] = [];
  for (const candidate of candidates) {
    try {
      if ((await candidate.isVisible()) && (await candidate.isEnabled())) {
        actionable.push(candidate);
      }
    } catch {
      // Un locator detașat în timpul verificării nu este o alegere sigură.
    }
  }
  if (actionable.length === 1) return actionable[0];
  if (actionable.length < 2) return undefined;

  const fingerprints = await Promise.all(actionable.map(behaviorFingerprint));
  if (preferInteractive) {
    const interactive = actionable.filter(
      (_, index) => fingerprints[index] !== undefined,
    );
    if (interactive.length === 1) return interactive[0];
    if (interactive.length > 1) {
      const interactiveFingerprints = fingerprints.filter(
        (fingerprint): fingerprint is BehaviorFingerprint =>
          fingerprint !== undefined,
      );
      const firstInteractive = interactiveFingerprints[0];
      if (
        firstInteractive !== undefined &&
        interactiveFingerprints.every(
          (fingerprint) =>
            JSON.stringify(fingerprint) === JSON.stringify(firstInteractive),
        )
      ) {
        return interactive[0];
      }
    }
    return undefined;
  }
  const first = fingerprints[0];
  if (first === undefined) return undefined;
  const serialized = JSON.stringify(first);
  return fingerprints.every(
    (fingerprint) =>
      fingerprint !== undefined && JSON.stringify(fingerprint) === serialized,
  )
    ? actionable[0]
    : undefined;
};

const individualLocators = (locator: Locator, count: number): Locator[] => {
  try {
    return Array.from({ length: count }, (_, index) => locator.nth(index));
  } catch {
    return [];
  }
};

const locatorIsVisible = async (locator: Locator): Promise<boolean> =>
  typeof locator.isVisible !== "function" || (await locator.isVisible());

const locatorIsEnabled = async (locator: Locator): Promise<boolean> =>
  typeof locator.isEnabled !== "function" || (await locator.isEnabled());

export const resolveUniqueLocator = async (
  page: Page,
  definition: LocatorDefinition,
  options: {
    waitForMs?: number;
    waitForState?: "attached" | "visible";
    frame?: TargetFrameContext;
    preferInteractive?: boolean;
    requireEnabled?: boolean;
    searchAllFrames?: boolean;
    pollIntervalMs?: number;
  } = {},
): Promise<Locator> => {
  if (options.frame !== undefined || options.searchAllFrames === true) {
    const timeout = Math.max(0, options.waitForMs ?? 0);
    const pollInterval = Math.max(50, options.pollIntervalMs ?? 250);
    let remaining = timeout;
    let lastCount: number;
    while (true) {
      const availableFrames =
        typeof page.frames === "function" ? page.frames() : [];
      const scopes: SearchScope[] =
        availableFrames.length === 0
          ? [page]
          : options.frame === undefined
            ? availableFrames
            : availableFrames.filter((frame) => {
                if (frame === page.mainFrame()) return false;
                try {
                  return new URL(frame.url()).origin === options.frame?.origin;
                } catch {
                  return false;
                }
              });
      const matches: Array<{ locator: Locator; count: number }> = [];
      for (const candidateScope of scopes) {
        const candidate = resolveLocator(page, definition, candidateScope);
        const count = await candidate.count();
        if (count > 0) matches.push({ locator: candidate, count });
      }
      lastCount = matches.reduce((total, match) => total + match.count, 0);
      if (lastCount > 1) {
        const selected = await chooseEquivalentActionable(
          matches.flatMap(({ locator, count }) =>
            individualLocators(locator, count),
          ),
          options.preferInteractive === true,
        );
        if (selected !== undefined) return selected;
        throw new LocatorResolutionError("locator_ambiguous", lastCount);
      }
      if (lastCount === 1) {
        const locator = matches[0]?.locator;
        if (locator !== undefined) {
          if (
            (options.waitForState !== "visible" ||
              (await locatorIsVisible(locator))) &&
            (options.requireEnabled !== true ||
              (await locatorIsEnabled(locator)))
          ) {
            return locator;
          }
        }
      }
      if (remaining <= 0) break;
      const delay = Math.min(pollInterval, remaining);
      await page.waitForTimeout(delay);
      remaining -= delay;
    }
    throw new LocatorResolutionError("locator_not_found", lastCount);
  }

  const locator = resolveLocator(page, definition);
  if (options.waitForMs !== undefined && options.waitForMs > 0) {
    try {
      await locator.waitFor({
        state: options.waitForState ?? "attached",
        timeout: options.waitForMs,
      });
    } catch {
      // Count-ul de mai jos produce eroarea semantică exactă și permite
      // runnerului să treacă automat la fallback.
    }
  }
  const count = await locator.count();
  if (count > 1) {
    const selected = await chooseEquivalentActionable(
      individualLocators(locator, count),
      options.preferInteractive === true,
    );
    if (selected !== undefined) return selected;
  }
  if (
    count === 1 &&
    ((options.waitForState === "visible" &&
      !(await locatorIsVisible(locator))) ||
      (options.requireEnabled === true && !(await locatorIsEnabled(locator))))
  ) {
    throw new LocatorResolutionError("locator_not_found", 0);
  }
  if (count !== 1) {
    throw new LocatorResolutionError(
      count === 0 ? "locator_not_found" : "locator_ambiguous",
      count,
    );
  }
  return locator;
};
