import type { TestDefinition } from "./persistence.js";

export const testFlowRequiresAi = (test: TestDefinition): boolean =>
  test.testMode === "dynamic_ai" ||
  test.flowItems.some((item) => {
    if (item.type === "action" && item.enabled) {
      return (
        item.actionType === "visual_ai" ||
        (item.actionType === "click" &&
          item.googlePayCardDescription !== undefined &&
          item.googlePayCardDescription.trim().length > 0)
      );
    }
    if (item.type !== "check" || !item.enabled) return false;
    if (item.checkType === "visual") return true;
    if (item.checkType !== "adaptive" || !("strategy" in item.config)) {
      return false;
    }
    return (
      item.config.strategy === "visual" ||
      item.config.visualFallback ||
      (item.config.strategy === "auto" &&
        item.config.expectedTexts.length === 0)
    );
  });
