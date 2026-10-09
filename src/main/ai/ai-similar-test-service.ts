import type {
  AiEditableStepPatch,
  AiSimilarTestContextMode,
  AiSimilarTestDiff,
  AiSimilarTestInput,
  AiSimilarTestProposal,
  AiSimilarTestRequestPreview,
  AiSimilarTestResult,
  CreateAiSimilarTestInput,
  CreateAiSimilarTestResult,
} from "../../shared/ai.js";
import { AI_SIMILAR_TEST_CONTEXT_MODES } from "../../shared/ai.js";
import type {
  JsonValue,
  TestDataset,
  TestDefinition,
} from "../../shared/persistence.js";
import type {
  CheckStep,
  LocatorDefinition,
  TestFlowItem,
} from "../../shared/test-model.js";
import { toDeclarativeTestDefinition } from "../../shared/test-editor.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import type { DatasetRepository } from "../persistence/repositories.js";
import type { TestsService } from "../tests-service.js";
import {
  createAiSimilarTestOutputSchema,
  validateAiSimilarTestProposal,
} from "./ai-output.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import type { PageAiContextSource } from "./ai-step-editing-service.js";

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

export interface StepReference {
  ref: string;
  stepId: string;
}

interface SimilarTestContextInput {
  test: TestDefinition;
  datasets: TestDataset[];
  instruction: string;
  mode: AiSimilarTestContextMode;
  pageAnalyses: JsonValue[];
}

const isRecord = (value: unknown): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stepReferencesFrom = (test: TestDefinition): StepReference[] =>
  test.flowItems.map(({ id }, index) => ({ ref: `s${index + 1}`, stepId: id }));

const compactStep = (
  item: TestFlowItem,
  reference: string,
  full: boolean,
): JsonValue => {
  if (full) {
    const fullItem = asJson(item);
    if (!isRecord(fullItem)) return fullItem;
    delete fullItem.id;
    return asJson({ ref: reference, ...fullItem });
  }
  if (item.type === "action") {
    return asJson({
      ref: reference,
      type: item.type,
      actionType: item.actionType,
      title: item.title,
      humanDescription: item.humanDescription,
      pageId: item.pageId,
      target:
        item.target === undefined
          ? undefined
          : {
              fieldId: item.target.fieldId,
              primary: item.target.primary,
              frame: item.target.frame,
            },
      inputFieldId: item.inputFieldId,
      valueKey: item.valueKey,
      valueStrategy: item.valueStrategy,
      url: item.url,
      key: item.key,
      scrollX: item.scrollX,
      scrollY: item.scrollY,
      scrollMode: item.scrollMode,
      repeat: item.repeat,
      repeatUntil: item.repeatUntil,
      waitAfter: item.waitAfter,
    });
  }
  if (item.type === "check") {
    return asJson({
      ref: reference,
      type: item.type,
      checkType: item.checkType,
      title: item.title,
      humanDescription: item.humanDescription,
      config: item.config,
      timeoutMs: item.timeoutMs,
    });
  }
  return asJson({
    ref: reference,
    type: item.type,
    title: item.title,
    instructions: item.instructions,
    ...(item.type === "manual_intervention"
      ? { humanDescription: item.humanDescription }
      : {}),
  });
};

const compactDatasetValue = (value: unknown): unknown => {
  if (isRecord(value) && value.type === "file") {
    return { type: "file", name: value.name };
  }
  return value;
};

const compactDataset = (dataset: TestDataset): JsonValue =>
  asJson({
    name: dataset.name,
    values: Object.fromEntries(
      Object.entries(dataset.values).map(([key, value]) => [
        key,
        compactDatasetValue(value),
      ]),
    ),
  });

const searchTermsFrom = (instruction: string, steps: JsonValue[]): string[] =>
  [instruction, JSON.stringify(steps)]
    .join(" ")
    .toLocaleLowerCase("ro")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/[^a-z0-9_-]+/)
    .filter((term) => term.length >= 3)
    .filter((term, index, all) => all.indexOf(term) === index)
    .slice(0, 80);

const relevanceScore = (value: JsonValue, terms: readonly string[]): number => {
  const text = JSON.stringify(value)
    .toLocaleLowerCase("ro")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  return terms.reduce(
    (score, term) => score + (text.includes(term) ? 1 : 0),
    0,
  );
};

const compactSemanticElement = (value: JsonValue): JsonValue | undefined => {
  if (!isRecord(value)) return undefined;
  const primary = isRecord(value.primaryLocator)
    ? value.primaryLocator.strategy
    : undefined;
  return asJson({
    fieldId: value.fieldId,
    role: value.role,
    accessibleName: value.accessibleName,
    primaryLocator: primary,
  });
};

const compactPageAnalysis = (
  value: JsonValue,
  searchTerms: readonly string[],
): JsonValue => {
  if (!isRecord(value)) return value;
  const semantic = isRecord(value.semanticAnalysis)
    ? value.semanticAnalysis
    : undefined;
  const elements = Array.isArray(semantic?.elements)
    ? semantic.elements
        .map(compactSemanticElement)
        .filter((entry): entry is JsonValue => entry !== undefined)
        .map((entry, index) => ({
          entry,
          index,
          score: relevanceScore(entry, searchTerms),
        }))
        .sort(
          (left, right) => right.score - left.score || left.index - right.index,
        )
        .slice(0, 12)
        .map(({ entry }) => entry)
    : [];
  const repeatedComponents = Array.isArray(semantic?.repeatedComponents)
    ? semantic.repeatedComponents.slice(0, 4).map((component) => {
        if (!isRecord(component)) return component;
        const container = isRecord(component.containerSelector)
          ? component.containerSelector.strategy
          : undefined;
        return asJson({
          semanticName: component.semanticName,
          repeatedCount: component.repeatedCount,
          containerLocator: container,
          childFields: Array.isArray(component.childFields)
            ? component.childFields
                .map(compactSemanticElement)
                .filter((entry) => entry !== undefined)
                .slice(0, 8)
            : [],
          actions: Array.isArray(component.actions)
            ? component.actions
                .map(compactSemanticElement)
                .filter((entry) => entry !== undefined)
                .slice(0, 8)
            : [],
        });
      })
    : [];
  const calendarCandidates = Array.isArray(semantic?.calendarCandidates)
    ? semantic.calendarCandidates.slice(0, 4).map((candidate) => {
        if (!isRecord(candidate)) return candidate;
        const locator = isRecord(candidate.locator)
          ? candidate.locator.strategy
          : undefined;
        return asJson({
          semanticName: candidate.semanticName,
          locator,
          confidence: candidate.confidence,
        });
      })
    : [];
  return asJson({
    pageId: value.pageId,
    title: value.title,
    normalizedUrl: value.normalizedUrl,
    elements,
    repeatedComponents,
    calendarCandidates,
    calendarRuntimeHints: value.calendarRuntimeHints,
  });
};

export const buildAiSimilarTestPromptContext = ({
  test,
  datasets,
  instruction,
  mode,
  pageAnalyses,
}: SimilarTestContextInput): {
  context: JsonValue;
  references: StepReference[];
} => {
  const references = stepReferencesFrom(test);
  const steps = test.flowItems.map((item, index) =>
    compactStep(
      item,
      references[index]?.ref ?? `s${index + 1}`,
      mode === "full",
    ),
  );
  const terms = searchTermsFrom(instruction, steps);
  return {
    references,
    context: asJson({
      userInstruction: instruction.trim(),
      sourceTest: {
        name: test.name,
        description: test.description ?? "",
        startUrl: test.startUrl,
        flowItems: steps,
      },
      datasets:
        mode === "full" ? datasets.map(asJson) : datasets.map(compactDataset),
      pageAnalyses:
        mode === "economic"
          ? []
          : mode === "full"
            ? pageAnalyses
            : pageAnalyses.map((page) => compactPageAnalysis(page, terms)),
      constraints: {
        preserveUnchangedSteps: true,
        existingStepReferencesUseAliases: true,
        datasetChangesBelongOnlyInDatasets: true,
        insertedStepIdPrefix: "ai-",
        allowedInsertedStepTypes: ["action", "check"],
        datasetValuesMustBePrimitive: true,
      },
    }),
  };
};

export const resolveAiSimilarTestStepReferences = (
  proposal: AiSimilarTestProposal,
  references: readonly StepReference[],
): AiSimilarTestProposal => {
  const aliases = new Map(references.map(({ ref, stepId }) => [ref, stepId]));
  const resolve = (value: string): string => aliases.get(value) ?? value;
  return {
    ...structuredClone(proposal),
    changes: proposal.changes.map((change) => ({
      ...structuredClone(change),
      stepId: resolve(change.stepId),
    })),
    insertions: proposal.insertions.map((insertion) => ({
      ...structuredClone(insertion),
      anchorStepId: resolve(insertion.anchorStepId),
    })),
    removals: proposal.removals.map((removal) => ({
      ...structuredClone(removal),
      stepId: resolve(removal.stepId),
    })),
  };
};

const estimatedTokens = (value: JsonValue): number =>
  Math.ceil(JSON.stringify(value).length / 4);

const validateInput = (input: AiSimilarTestInput): void => {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.projectId !== "string" ||
    input.projectId.length === 0 ||
    typeof input.sourceTestId !== "string" ||
    input.sourceTestId.length === 0 ||
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > 4_000 ||
    (input.contextMode !== undefined &&
      !AI_SIMILAR_TEST_CONTEXT_MODES.includes(input.contextMode)) ||
    (input.model !== undefined &&
      (typeof input.model !== "string" ||
        input.model.length > 200 ||
        /[\r\n]/.test(input.model)))
  ) {
    throw new Error("Cererea de generare a testului similar nu este validă.");
  }
};

const pageIdsFrom = (test: TestDefinition): string[] =>
  [
    ...new Set(
      test.flowItems.flatMap((item) =>
        item.type === "action" && item.pageId !== undefined
          ? [item.pageId]
          : [],
      ),
    ),
  ].slice(0, 10);

const firstDuplicate = (values: readonly string[]): string | undefined => {
  const seen = new Set<string>();
  return values.find((value) => {
    if (seen.has(value)) return true;
    seen.add(value);
    return false;
  });
};

const isEmptyObject = (value: unknown): boolean =>
  typeof value === "object" &&
  value !== null &&
  !Array.isArray(value) &&
  Object.keys(value).length === 0;

const normalizeBooleanExpectedResult = (value: unknown): unknown => {
  if (isEmptyObject(value)) return true;
  if (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).type === "boolean" &&
    typeof (value as Record<string, unknown>).value === "boolean"
  ) {
    return (value as Record<string, unknown>).value;
  }
  return value;
};

const normalizeCheckConfigPatch = (
  source: CheckStep,
  patch: AiEditableStepPatch,
): AiEditableStepPatch => {
  if (patch.checkConfig === undefined) return patch;
  const normalized = structuredClone(patch);
  const config = structuredClone(patch.checkConfig) as unknown as Record<
    string,
    unknown
  >;
  const checkType = patch.checkType ?? source.checkType;
  if (checkType !== "visual" && checkType !== "adaptive") {
    delete config.minimumConfidence;
    delete config.prompt;
  }
  if (checkType === "js_eval" && config.expectedResult !== undefined) {
    config.expectedResult = normalizeBooleanExpectedResult(
      config.expectedResult,
    );
  }
  normalized.checkConfig = config as unknown as NonNullable<
    AiEditableStepPatch["checkConfig"]
  >;
  return normalized;
};

const expectedTextsFromInstruction = (instruction: string): string[] => {
  const quoted = [
    ...instruction.matchAll(/["“«]([^"”»\r\n]{2,200})["”»]/g),
  ].flatMap((match) => (match[1]?.trim() ? [match[1].trim()] : []));
  const labeled = [
    ...instruction.matchAll(
      /(?:textul|mesajul|eroarea)(?:\s+exact(?:ă|a)?)?\s*[-:=]?\s+(?!(?:care|pentru|despre|de|sau|ori|ce)\b)([^,.!?;\r\n]{2,120})/giu,
    ),
  ].flatMap((match) => (match[1]?.trim() ? [match[1].trim()] : []));
  return [...new Set([...quoted, ...labeled])].slice(0, 20);
};

const adaptiveConfigFor = (
  prompt: string,
  expectedTexts: string[],
): NonNullable<AiEditableStepPatch["checkConfig"]> => ({
  strategy: "auto",
  expectedTexts,
  matchMode: "any",
  caseSensitive: false,
  ignoreDiacritics: true,
  visualPrompt: prompt,
  visualFallback: true,
  minimumConfidence: 0.6,
});

const usesWholePageTextHeuristic = (item: CheckStep): boolean =>
  item.checkType === "js_eval" &&
  "jsSnippet" in item.config &&
  /document\s*\.\s*body[\s\S]{0,120}innerText/i.test(item.config.jsSnippet);

const patchUsesWholePageTextHeuristic = (
  source: CheckStep,
  patch: AiEditableStepPatch,
): boolean => {
  const checkType = patch.checkType ?? source.checkType;
  const config = patch.checkConfig;
  return (
    checkType === "js_eval" &&
    config !== undefined &&
    "jsSnippet" in config &&
    /document\s*\.\s*body[\s\S]{0,120}innerText/i.test(config.jsSnippet)
  );
};

export const normalizeAiAdaptiveCheckPatch = (
  source: CheckStep,
  patch: AiEditableStepPatch,
  instruction: string,
): AiEditableStepPatch => {
  const normalized = normalizeCheckConfigPatch(source, patch);
  const shouldBecomeAdaptive =
    patchUsesWholePageTextHeuristic(source, normalized) ||
    normalized.checkType === "visual";
  if (!shouldBecomeAdaptive) return normalized;
  const prompt =
    normalized.humanDescription?.trim() ||
    source.humanDescription.trim() ||
    normalized.title?.trim() ||
    source.title;
  return {
    ...normalized,
    checkType: "adaptive",
    checkConfig: adaptiveConfigFor(
      prompt,
      expectedTextsFromInstruction(instruction),
    ),
  };
};

export const normalizeAiSimilarTestAdaptiveChecks = (
  source: TestDefinition,
  proposal: AiSimilarTestProposal,
  instruction: string,
): AiSimilarTestProposal => ({
  ...structuredClone(proposal),
  changes: proposal.changes.map((change) => {
    const sourceItem = source.flowItems.find(({ id }) => id === change.stepId);
    if (sourceItem?.type !== "check") return structuredClone(change);
    return {
      ...structuredClone(change),
      patch: normalizeAiAdaptiveCheckPatch(
        sourceItem,
        change.patch,
        instruction,
      ),
    };
  }),
  insertions: proposal.insertions.map((insertion) => {
    const step = structuredClone(insertion.step);
    if (
      step.type !== "check" ||
      (!usesWholePageTextHeuristic(step) && step.checkType !== "visual")
    ) {
      if (
        step.type === "check" &&
        step.checkType === "js_eval" &&
        "expectedResult" in step.config &&
        step.config.expectedResult !== undefined
      ) {
        step.config.expectedResult = normalizeBooleanExpectedResult(
          step.config.expectedResult,
        ) as typeof step.config.expectedResult;
      }
      return { ...structuredClone(insertion), step };
    }
    return {
      ...structuredClone(insertion),
      step: {
        ...step,
        checkType: "adaptive",
        config: adaptiveConfigFor(
          step.humanDescription.trim() || step.title,
          expectedTextsFromInstruction(instruction),
        ),
      },
    };
  }),
});

const applyPatch = (
  source: TestFlowItem,
  patch: AiEditableStepPatch,
): TestFlowItem => {
  const item = structuredClone(source);
  if (patch.title !== undefined && "title" in item) item.title = patch.title;
  if (patch.humanDescription !== undefined && "humanDescription" in item) {
    item.humanDescription = patch.humanDescription;
  }
  if (patch.whyExplanation !== undefined && "whyExplanation" in item) {
    item.whyExplanation = patch.whyExplanation;
  }
  if (patch.instructions !== undefined && "instructions" in item) {
    item.instructions = patch.instructions;
  }
  if (patch.primaryLocator !== undefined) {
    const locator = structuredClone(patch.primaryLocator) as LocatorDefinition;
    if (item.type === "action" && item.target !== undefined) {
      item.target.primary = locator;
    } else if (item.type === "check" && "target" in item.config) {
      item.config.target = locator;
    }
  }
  if (item.type === "check") {
    const normalizedPatch = normalizeCheckConfigPatch(item, patch);
    if (normalizedPatch.checkType !== undefined) {
      item.checkType = normalizedPatch.checkType;
    }
    if (normalizedPatch.checkConfig !== undefined) {
      item.config = structuredClone(normalizedPatch.checkConfig);
    }
    if (normalizedPatch.timeoutMs !== undefined) {
      item.timeoutMs = normalizedPatch.timeoutMs;
    }
  }
  return item;
};

const buildCandidate = (
  source: TestDefinition,
  proposal: AiSimilarTestProposal,
): { flowItems: TestFlowItem[]; diffs: AiSimilarTestDiff[] } => {
  const sourceIds = new Set(source.flowItems.map(({ id }) => id));
  const changeIds = proposal.changes.map(({ stepId }) => stepId);
  const removalIds = proposal.removals.map(({ stepId }) => stepId);
  const duplicateChangeId = firstDuplicate(changeIds);
  if (duplicateChangeId !== undefined) {
    throw new Error(
      `Propunerea AI repetă changes[].stepId „${duplicateChangeId}”.`,
    );
  }
  const duplicateRemovalId = firstDuplicate(removalIds);
  if (duplicateRemovalId !== undefined) {
    throw new Error(
      `Propunerea AI repetă removals[].stepId „${duplicateRemovalId}”.`,
    );
  }
  const invalidChangeIndex = changeIds.findIndex((id) => !sourceIds.has(id));
  if (invalidChangeIndex >= 0) {
    throw new Error(
      `changes[${invalidChangeIndex}].stepId „${changeIds[invalidChangeIndex]}” nu este ID-ul unui pas existent.`,
    );
  }
  const invalidRemovalIndex = removalIds.findIndex((id) => !sourceIds.has(id));
  if (invalidRemovalIndex >= 0) {
    throw new Error(
      `removals[${invalidRemovalIndex}].stepId „${removalIds[invalidRemovalIndex]}” nu este ID-ul unui pas existent.`,
    );
  }
  const removals = new Set(removalIds);
  const changedAndRemoved = changeIds.find((id) => removals.has(id));
  if (changedAndRemoved !== undefined) {
    throw new Error(
      `Pasul „${changedAndRemoved}” nu poate fi modificat și eliminat simultan.`,
    );
  }
  const insertedIds = proposal.insertions.map(({ step }) => step.id);
  const duplicateInsertedId = firstDuplicate(insertedIds);
  if (duplicateInsertedId !== undefined) {
    throw new Error(
      `Propunerea AI repetă ID-ul inserat „${duplicateInsertedId}”.`,
    );
  }
  const invalidInsertedIdIndex = insertedIds.findIndex(
    (id) => sourceIds.has(id) || !id.startsWith("ai-"),
  );
  if (invalidInsertedIdIndex >= 0) {
    throw new Error(
      `insertions[${invalidInsertedIdIndex}].step.id „${insertedIds[invalidInsertedIdIndex]}” trebuie să fie nou și să înceapă cu „ai-”.`,
    );
  }
  const invalidAnchorIndex = proposal.insertions.findIndex(
    ({ anchorStepId }) => !sourceIds.has(anchorStepId),
  );
  if (invalidAnchorIndex >= 0) {
    throw new Error(
      `insertions[${invalidAnchorIndex}].anchorStepId „${proposal.insertions[invalidAnchorIndex]?.anchorStepId}” nu este ID-ul unui pas existent.`,
    );
  }
  const changes = new Map(
    proposal.changes.map((change) => [change.stepId, change]),
  );
  const before = new Map<string, typeof proposal.insertions>();
  const after = new Map<string, typeof proposal.insertions>();
  for (const insertion of proposal.insertions) {
    const target = insertion.position === "before" ? before : after;
    target.set(insertion.anchorStepId, [
      ...(target.get(insertion.anchorStepId) ?? []),
      insertion,
    ]);
  }
  const flowItems: TestFlowItem[] = [];
  const diffs: AiSimilarTestDiff[] = [];
  if (source.name !== proposal.name) {
    diffs.push({
      kind: "metadata",
      label: "Numele testului",
      before: source.name,
      after: proposal.name,
    });
  }
  if ((source.description ?? "") !== proposal.description) {
    diffs.push({
      kind: "metadata",
      label: "Descrierea testului",
      before: source.description ?? "",
      after: proposal.description,
    });
  }
  for (const dataset of proposal.datasets) {
    diffs.push({
      kind: "dataset_added",
      label: `Dataset nou: ${dataset.name}`,
      after: asJson(
        Object.fromEntries(
          dataset.values.map(({ key, value }) => [key, value]),
        ),
      ),
    });
  }
  for (const item of source.flowItems) {
    for (const insertion of before.get(item.id) ?? []) {
      flowItems.push(structuredClone(insertion.step));
      diffs.push({
        kind: "step_added",
        label: `Pas nou înainte de „${"title" in item ? (item.title ?? item.id) : item.id}”`,
        stepId: insertion.step.id,
        after: asJson(insertion.step),
        rationale: insertion.rationale,
      });
    }
    const removal = proposal.removals.find(({ stepId }) => stepId === item.id);
    if (removal !== undefined) {
      diffs.push({
        kind: "step_removed",
        label: `Pas eliminat: ${"title" in item ? (item.title ?? item.id) : item.id}`,
        stepId: item.id,
        before: asJson(item),
        rationale: removal.rationale,
      });
    } else {
      const change = changes.get(item.id);
      const next =
        change === undefined
          ? structuredClone(item)
          : applyPatch(item, change.patch);
      flowItems.push(next);
      if (
        change !== undefined &&
        JSON.stringify(next) !== JSON.stringify(item)
      ) {
        diffs.push({
          kind: "step_modified",
          label: `Pas modificat: ${"title" in item ? (item.title ?? item.id) : item.id}`,
          stepId: item.id,
          before: asJson(item),
          after: asJson(next),
          rationale: change.rationale,
        });
      }
    }
    for (const insertion of after.get(item.id) ?? []) {
      flowItems.push(structuredClone(insertion.step));
      diffs.push({
        kind: "step_added",
        label: `Pas nou după „${"title" in item ? (item.title ?? item.id) : item.id}”`,
        stepId: insertion.step.id,
        after: asJson(insertion.step),
        rationale: insertion.rationale,
      });
    }
  }
  return { flowItems, diffs };
};

export class AiSimilarTestService {
  public constructor(
    private readonly aiSettings: AiSettingsService,
    private readonly tests: TestsService,
    private readonly datasets: DatasetRepository,
    private readonly pageContext: PageAiContextSource,
  ) {}

  public async preview(
    input: AiSimilarTestInput,
  ): Promise<AiSimilarTestRequestPreview> {
    validateInput(input);
    const test = this.tests.get(input.projectId, input.sourceTestId);
    if (test.flowItems.length === 0) {
      throw new Error(
        "Testul-sursă nu are pași din care să fie creată o variantă.",
      );
    }
    const mode = input.contextMode ?? "balanced";
    const datasets = this.datasets.listByTest(test.id);
    const pageIds =
      mode === "economic"
        ? []
        : pageIdsFrom(test).slice(0, mode === "balanced" ? 3 : 10);
    const pageAnalyses =
      pageIds.length === 0
        ? []
        : await this.pageContext.getAiSemanticContext(input.projectId, pageIds);
    const { context, references } = buildAiSimilarTestPromptContext({
      test,
      datasets,
      instruction: input.instruction,
      mode,
      pageAnalyses,
    });
    const outputSchema = createAiSimilarTestOutputSchema(
      references.map(({ ref }) => ref),
    );
    const request = this.aiSettings.preview({
      task: "generate_test",
      context,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      outputSchema,
    });
    const sentContext = isRecord(request.contextPreview)
      ? request.contextPreview
      : {};
    const sourceTokens = estimatedTokens(sentContext.sourceTest ?? null);
    const datasetTokens = estimatedTokens(sentContext.datasets ?? []);
    const pageTokens = estimatedTokens(sentContext.pageAnalyses ?? []);
    const outputSchemaTokens = estimatedTokens(request.outputSchema);
    const instructionTokens = Math.max(
      0,
      request.estimatedInputTokens -
        sourceTokens -
        datasetTokens -
        pageTokens -
        outputSchemaTokens,
    );
    return {
      request,
      baseVersion: test.version,
      stepIds: test.flowItems.map(({ id }) => id),
      datasetNames: datasets.map(({ name }) => name),
      contextMode: mode,
      tokenBreakdown: {
        instructions: instructionTokens,
        sourceTest: sourceTokens,
        datasets: datasetTokens,
        pageContext: pageTokens,
        outputSchema: outputSchemaTokens,
        estimatedTotal: request.estimatedInputTokens,
      },
    };
  }

  public async generate(
    input: AiSimilarTestInput,
  ): Promise<AiSimilarTestResult> {
    const preview = await this.preview(input);
    const generation = await this.aiSettings.generate({
      task: "generate_test",
      context: preview.request.contextPreview,
      provider: preview.request.provider,
      model: preview.request.model,
      outputSchema: preview.request.outputSchema,
    });
    const aliasedProposal = validateAiSimilarTestProposal(generation.output);
    const source = this.tests.get(input.projectId, input.sourceTestId);
    if (source.version !== preview.baseVersion) {
      throw new Error("Testul-sursă s-a modificat în timpul generării.");
    }
    const resolvedProposal = resolveAiSimilarTestStepReferences(
      aliasedProposal,
      stepReferencesFrom(source),
    );
    const proposal = normalizeAiSimilarTestAdaptiveChecks(
      source,
      resolvedProposal,
      input.instruction,
    );
    const candidate = buildCandidate(source, proposal);
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(source, candidate.flowItems),
    );
    if (!validation.valid) {
      throw new Error(
        `Propunerea AI produce un test invalid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    if (candidate.diffs.length === 0) {
      throw new Error("AI nu a propus nicio diferență față de testul-sursă.");
    }
    return {
      provider: generation.provider,
      model: generation.model,
      baseVersion: source.version,
      proposal,
      diffs: candidate.diffs,
      usage: generation.usage,
    };
  }

  public create(input: CreateAiSimilarTestInput): CreateAiSimilarTestResult {
    const source = this.tests.get(input.projectId, input.sourceTestId);
    if (source.version !== input.baseVersion) {
      throw new Error(
        "Testul-sursă s-a modificat. Generează din nou preview-ul.",
      );
    }
    const proposal = normalizeAiSimilarTestAdaptiveChecks(
      source,
      validateAiSimilarTestProposal(input.proposal),
      input.instruction,
    );
    const candidate = buildCandidate(source, proposal);
    if (candidate.diffs.length === 0) {
      throw new Error("Varianta AI nu conține nicio modificare.");
    }
    return this.tests.createAiGeneratedVariant(input.projectId, source.id, {
      name: proposal.name,
      description: proposal.description,
      flowItems: candidate.flowItems,
      datasets: proposal.datasets.map((dataset) => ({
        name: dataset.name,
        values: Object.fromEntries(
          dataset.values.map(({ key, value }) => [key, value]),
        ),
      })),
      instruction: input.instruction,
      provider: input.provider,
      model: input.model,
    });
  }
}

export const applyAiSimilarTestProposal = buildCandidate;
