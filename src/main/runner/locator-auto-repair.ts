import type { TestDefinition } from "../../shared/persistence.js";
import type { LocatorDefinition } from "../../shared/test-model.js";

const sameLocator = (
  left: LocatorDefinition,
  right: LocatorDefinition,
): boolean => JSON.stringify(left) === JSON.stringify(right);

export interface LocatorAutoRepairResult {
  test: TestDefinition;
  fallbackIndex: number;
  previousPrimary: LocatorDefinition;
  promotedLocator: LocatorDefinition;
}

export const promoteSuccessfulFallback = (
  test: TestDefinition,
  stepId: string,
  successfulLocator: LocatorDefinition,
  updatedAt: string,
): LocatorAutoRepairResult | undefined => {
  const index = test.flowItems.findIndex(
    (item) => item.id === stepId && item.type === "action",
  );
  const item = test.flowItems[index];
  if (index < 0 || item?.type !== "action" || item.target === undefined) {
    return undefined;
  }
  if (sameLocator(item.target.primary, successfulLocator)) return undefined;
  const fallbackIndex = item.fallbacks.findIndex(({ locator }) =>
    sameLocator(locator, successfulLocator),
  );
  if (fallbackIndex < 0) return undefined;

  const previousPrimary = structuredClone(item.target.primary);
  const promotedLocator = structuredClone(
    item.fallbacks[fallbackIndex]!.locator,
  );
  const nextItem = structuredClone(item);
  nextItem.target!.primary = promotedLocator;
  nextItem.fallbacks = [
    {
      locator: previousPrimary,
      humanDescription: "Locator principal anterior",
      whyExplanation:
        "Păstrat automat ca fallback după ce un alt locator a reparat pasul.",
    },
    ...item.fallbacks
      .filter((_, candidateIndex) => candidateIndex !== fallbackIndex)
      .map((fallback) => structuredClone(fallback)),
  ];
  return {
    test: {
      ...structuredClone(test),
      version: test.version + 1,
      updatedAt,
      flowItems: test.flowItems.map((candidate, candidateIndex) =>
        candidateIndex === index ? nextItem : structuredClone(candidate),
      ),
    },
    fallbackIndex,
    previousPrimary,
    promotedLocator,
  };
};
