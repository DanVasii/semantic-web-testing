import type { TestDefinition, TestDataset } from "./persistence.js";
import type {
  DeclarativeTestDefinition,
  LocatorDefinition,
  TestFlowItem,
} from "./test-model.js";

export const createSimpleLocator = (): LocatorDefinition => ({
  type: "css",
  operator: "equals",
  value: "body",
});

export const createFlowItem = (
  type: TestFlowItem["type"],
  id: string,
): TestFlowItem => {
  switch (type) {
    case "action":
      return {
        id,
        type,
        actionType: "click",
        title: "Acțiune nouă",
        humanDescription: "Apasă elementul selectat.",
        whyExplanation: "Continuă flow-ul testului.",
        target: { primary: createSimpleLocator() },
        fallbacks: [],
        enabled: true,
      };
    case "check":
      return {
        id,
        type,
        checkType: "element",
        title: "Verificare nouă",
        humanDescription: "Verifică dacă elementul este vizibil.",
        config: {
          target: createSimpleLocator(),
          state: "visible",
        },
        timeoutMs: 5_000,
        enabled: true,
      };
    case "breakpoint":
      return {
        id,
        type,
        title: "Punct de oprire",
        instructions: "Inspectează starea paginii.",
        enabled: true,
      };
    case "manual_intervention":
      return {
        id,
        type,
        title: "Intervenție manuală",
        instructions: "Finalizează acțiunea manuală și continuă.",
        humanDescription: "Este necesară intervenția operatorului.",
        whyExplanation: "Pasul nu poate fi automatizat în siguranță.",
        enabled: true,
      };
  }
};

export const toDeclarativeTestDefinition = (
  test: TestDefinition,
  flowItems: TestFlowItem[] = test.flowItems,
  datasets: TestDataset[] = [],
): DeclarativeTestDefinition => ({
  schemaVersion: test.stages === undefined ? 1 : 2,
  id: test.id,
  projectId: test.projectId,
  name: test.name,
  ...(test.description === undefined ? {} : { description: test.description }),
  status: test.status,
  version: test.version,
  wipeBeforeRun: test.wipeBeforeRun,
  startMode: test.startMode,
  startUrl: test.startUrl,
  createdAt: test.createdAt,
  updatedAt: test.updatedAt,
  flowItems,
  ...(test.stages === undefined
    ? {}
    : { stages: structuredClone(test.stages) }),
  datasets,
});

const locatorText = (locator: LocatorDefinition): string => {
  if (locator.type === "relative") {
    return `${locatorText(locator.target)} ${locator.relation} ${locatorText(locator.anchor)}`;
  }
  if (locator.type === "repeated_component") {
    return `elementul din componenta repetitivă ${locatorText(locator.container)}`;
  }
  const value = Array.isArray(locator.value)
    ? locator.value.join(", ")
    : locator.value;
  return `${locator.type} „${value}”`;
};

export const createProceduralDescription = (item: TestFlowItem): string => {
  if (item.type === "action") {
    const revealDescription =
      item.revealBefore === undefined || item.revealBefore.length === 0
        ? ""
        : `Dacă ținta este ascunsă, încearcă ${item.revealBefore.length} pregătiri hover înregistrate.`;
    return `${item.humanDescription} ${
      item.target === undefined
        ? ""
        : `Țintă: ${locatorText(item.target.primary)}.`
    } ${revealDescription}`.trim();
  }
  if (item.type === "check") {
    return `${item.humanDescription} Tip verificare: ${item.checkType}. Timeout: ${item.timeoutMs ?? 5_000} ms. Condiție: ${JSON.stringify(item.config)}.`;
  }
  if (item.type === "manual_intervention") {
    return `${item.humanDescription} ${item.instructions}`;
  }
  return item.instructions ?? "Oprește temporar execuția testului.";
};
