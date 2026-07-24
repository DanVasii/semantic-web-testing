import type { Locator, Page } from "playwright-core";

import type {
  LocatorDefinition,
  MatchOperator,
  SimpleLocator,
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

export const resolveUniqueLocator = async (
  page: Page,
  definition: LocatorDefinition,
): Promise<Locator> => {
  const locator = resolveLocator(page, definition);
  const count = await locator.count();
  if (count !== 1) {
    throw new LocatorResolutionError(
      count === 0 ? "locator_not_found" : "locator_ambiguous",
      count,
    );
  }
  return locator;
};
