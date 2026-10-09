import type {
  AiEditableStepPatch,
  AiStepChangeProposal,
  AiStepEditInput,
  AiStepEditPreview,
  AiStepEditProposal,
  AiStepEditResult,
  AiStepFieldDiff,
  ApplyAiStepChangesInput,
  ApplyAiStepChangesResult,
  UndoAiStepChangeInput,
} from "../../shared/ai.js";
import type { JsonValue, TestDefinition } from "../../shared/persistence.js";
import type {
  LocatorDefinition,
  TestFlowItem,
} from "../../shared/test-model.js";
import { toDeclarativeTestDefinition } from "../../shared/test-editor.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import type { TestsService } from "../tests-service.js";
import { validateAiStepEditProposal } from "./ai-output.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import { normalizeAiAdaptiveCheckPatch } from "./ai-similar-test-service.js";

export interface PageAiContextSource {
  getAiSemanticContext: (
    projectId: string,
    pageIds: string[],
  ) => Promise<JsonValue[]>;
}

const MAX_PREVIOUS_STEPS = 3;
const MAX_NEXT_STEPS = 5;
const editableFields = [
  "title",
  "humanDescription",
  "whyExplanation",
  "instructions",
  "primaryLocator",
  "checkType",
  "checkConfig",
  "timeoutMs",
] as const;

const clone = <T>(value: T): T => structuredClone(value);

const asJson = (value: unknown): JsonValue =>
  JSON.parse(JSON.stringify(value)) as JsonValue;

const validateInput = (input: AiStepEditInput): void => {
  if (
    typeof input !== "object" ||
    input === null ||
    typeof input.projectId !== "string" ||
    input.projectId.length === 0 ||
    typeof input.testId !== "string" ||
    input.testId.length === 0 ||
    typeof input.selectedStepId !== "string" ||
    input.selectedStepId.length === 0 ||
    typeof input.instruction !== "string" ||
    input.instruction.trim().length === 0 ||
    input.instruction.length > 2_000 ||
    (input.model !== undefined &&
      (typeof input.model !== "string" ||
        input.model.length > 200 ||
        /[\r\n]/.test(input.model)))
  ) {
    throw new Error("Cererea de editare AI nu este validă.");
  }
};

const flowWindow = (
  test: TestDefinition,
  selectedStepId: string,
): {
  current: TestFlowItem;
  previous: TestFlowItem[];
  next: TestFlowItem[];
  selectedIndex: number;
} => {
  const selectedIndex = test.flowItems.findIndex(
    (item) => item.id === selectedStepId,
  );
  const current = test.flowItems[selectedIndex];
  if (selectedIndex < 0 || current === undefined) {
    throw new Error("Pasul selectat pentru AI nu mai există.");
  }
  return {
    current,
    previous: test.flowItems.slice(
      Math.max(0, selectedIndex - MAX_PREVIOUS_STEPS),
      selectedIndex,
    ),
    next: test.flowItems.slice(
      selectedIndex + 1,
      selectedIndex + 1 + MAX_NEXT_STEPS,
    ),
    selectedIndex,
  };
};

const pageIdsFrom = (items: TestFlowItem[]): string[] =>
  [
    ...new Set(
      items.flatMap((item) =>
        item.type === "action" && item.pageId !== undefined
          ? [item.pageId]
          : [],
      ),
    ),
  ].slice(0, 10);

const patchFieldValue = (
  item: TestFlowItem,
  field: (typeof editableFields)[number],
): JsonValue | undefined => {
  if (field === "primaryLocator") {
    if (item.type === "action") {
      return item.target === undefined
        ? undefined
        : asJson(item.target.primary);
    }
    if (item.type === "check" && "target" in item.config) {
      return asJson(item.config.target);
    }
    return undefined;
  }
  if (field === "checkType") {
    return item.type === "check" ? item.checkType : undefined;
  }
  if (field === "checkConfig") {
    return item.type === "check" ? asJson(item.config) : undefined;
  }
  if (field === "timeoutMs") {
    return item.type === "check" && item.timeoutMs !== undefined
      ? item.timeoutMs
      : undefined;
  }
  if (field === "title") {
    return "title" in item && item.title !== undefined
      ? asJson(item.title)
      : undefined;
  }
  if (field === "humanDescription") {
    return "humanDescription" in item
      ? asJson(item.humanDescription)
      : undefined;
  }
  if (field === "whyExplanation") {
    return "whyExplanation" in item ? asJson(item.whyExplanation) : undefined;
  }
  return "instructions" in item && item.instructions !== undefined
    ? asJson(item.instructions)
    : undefined;
};

const buildDiffs = (
  test: TestDefinition,
  proposal: AiStepEditProposal,
): AiStepFieldDiff[] => {
  const changes = [proposal.currentStepChange, ...proposal.downstreamChanges];
  return changes.flatMap((change) => {
    const item = test.flowItems.find(
      (candidate) => candidate.id === change.stepId,
    );
    if (item === undefined) return [];
    return editableFields.flatMap((field): AiStepFieldDiff[] => {
      const after =
        field === "primaryLocator"
          ? change.patch.primaryLocator
          : field === "checkConfig"
            ? change.patch.checkConfig
            : change.patch[field];
      if (after === undefined) return [];
      const before = patchFieldValue(item, field);
      const afterJson = asJson(after);
      if (JSON.stringify(before) === JSON.stringify(afterJson)) return [];
      return [
        {
          stepId: item.id,
          field,
          ...(before === undefined ? {} : { before }),
          after: afterJson,
        },
      ];
    });
  });
};

const applyPatch = (
  source: TestFlowItem,
  patch: AiEditableStepPatch,
): TestFlowItem => {
  const item = clone(source);
  if (patch.title !== undefined && "title" in item) {
    item.title = patch.title;
  }
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
    const locator = clone(patch.primaryLocator) as LocatorDefinition;
    if (item.type === "action" && item.target !== undefined) {
      item.target.primary = locator;
    } else if (item.type === "check" && "target" in item.config) {
      item.config.target = locator;
    }
  }
  if (item.type === "check") {
    if (patch.checkType !== undefined) item.checkType = patch.checkType;
    if (patch.checkConfig !== undefined) {
      item.config = clone(patch.checkConfig);
    }
    if (patch.timeoutMs !== undefined) item.timeoutMs = patch.timeoutMs;
  }
  return item;
};

const assertProposalScope = (
  test: TestDefinition,
  selectedStepId: string,
  proposal: AiStepEditProposal,
): void => {
  const selectedIndex = test.flowItems.findIndex(
    (item) => item.id === selectedStepId,
  );
  if (
    selectedIndex < 0 ||
    proposal.currentStepChange.stepId !== selectedStepId
  ) {
    throw new Error("Propunerea AI nu corespunde pasului selectat.");
  }
  const allowedDownstream = new Set(
    test.flowItems
      .slice(selectedIndex + 1, selectedIndex + 1 + MAX_NEXT_STEPS)
      .map((item) => item.id),
  );
  const downstreamIds = proposal.downstreamChanges.map(
    (change) => change.stepId,
  );
  if (
    new Set(downstreamIds).size !== downstreamIds.length ||
    downstreamIds.some((stepId) => !allowedDownstream.has(stepId))
  ) {
    throw new Error(
      "Propunerea AI conține schimbări în afara downstream-ului.",
    );
  }
};

const normalizeAdaptiveChecks = (
  test: TestDefinition,
  proposal: AiStepEditProposal,
  instruction: string,
): AiStepEditProposal => {
  const normalizeChange = (change: AiStepChangeProposal) => {
    const source = test.flowItems.find(({ id }) => id === change.stepId);
    return source?.type === "check"
      ? {
          ...clone(change),
          patch: normalizeAiAdaptiveCheckPatch(
            source,
            change.patch,
            instruction,
          ),
        }
      : clone(change);
  };
  return {
    ...clone(proposal),
    currentStepChange: normalizeChange(proposal.currentStepChange),
    downstreamChanges: proposal.downstreamChanges.map(normalizeChange),
  };
};

export class AiStepEditingService {
  public constructor(
    private readonly aiSettings: AiSettingsService,
    private readonly tests: TestsService,
    private readonly pageContext: PageAiContextSource,
  ) {}

  public async preview(input: AiStepEditInput): Promise<AiStepEditPreview> {
    validateInput(input);
    const test = this.tests.get(input.projectId, input.testId);
    if (test.testMode !== "dynamic_ai") {
      throw new Error(
        "Editarea AI este disponibilă numai pentru testele marcate dinamice.",
      );
    }
    const window = flowWindow(test, input.selectedStepId);
    const relevantItems = [...window.previous, window.current, ...window.next];
    const pageIds = pageIdsFrom(relevantItems);
    const pageAnalyses = await this.pageContext.getAiSemanticContext(
      input.projectId,
      pageIds,
    );
    const context: JsonValue = asJson({
      userInstruction: input.instruction.trim(),
      test: {
        id: test.id,
        name: test.name,
        description: test.description ?? "",
        startUrl: test.startUrl,
        testMode: test.testMode,
        version: test.version,
      },
      selectedStep: window.current,
      previousRelevantSteps: window.previous,
      nextRelevantSteps: window.next,
      pageAnalyses,
      constraints: {
        editableFields,
        selectedStepId: input.selectedStepId,
        downstreamStepIds: window.next.map((item) => item.id),
      },
    });
    return {
      request: this.aiSettings.preview({
        task: "edit_step",
        context,
        ...(input.provider === undefined ? {} : { provider: input.provider }),
        ...(input.model === undefined ? {} : { model: input.model }),
      }),
      context: {
        selectedStepId: input.selectedStepId,
        previousStepIds: window.previous.map((item) => item.id),
        nextStepIds: window.next.map((item) => item.id),
        pageIds,
      },
    };
  }

  public async generate(input: AiStepEditInput): Promise<AiStepEditResult> {
    const preview = await this.preview(input);
    const generation = await this.aiSettings.generate({
      task: "edit_step",
      context: preview.request.contextPreview,
      provider: preview.request.provider,
      model: preview.request.model,
    });
    const rawProposal = validateAiStepEditProposal(generation.output);
    const test = this.tests.get(input.projectId, input.testId);
    const proposal = normalizeAdaptiveChecks(
      test,
      rawProposal,
      input.instruction,
    );
    assertProposalScope(test, input.selectedStepId, proposal);
    return {
      provider: generation.provider,
      model: generation.model,
      proposal,
      diffs: buildDiffs(test, proposal),
      usage: generation.usage,
    };
  }

  public async apply(
    input: ApplyAiStepChangesInput,
  ): Promise<ApplyAiStepChangesResult> {
    if (
      typeof input !== "object" ||
      input === null ||
      !Number.isInteger(input.baseVersion) ||
      !Array.isArray(input.approvedDownstreamStepIds) ||
      input.approvedDownstreamStepIds.some(
        (stepId) => typeof stepId !== "string",
      )
    ) {
      throw new Error("Aprobarea schimbărilor AI nu este validă.");
    }
    const test = this.tests.get(input.projectId, input.testId);
    if (test.version !== input.baseVersion) {
      throw new Error(
        "Testul s-a modificat după propunerea AI. Generează o propunere nouă.",
      );
    }
    const proposal = validateAiStepEditProposal(input.proposal);
    assertProposalScope(test, input.selectedStepId, proposal);
    const approvedDownstream = new Set(input.approvedDownstreamStepIds);
    const allowedDownstream = new Set(
      proposal.downstreamChanges.map((change) => change.stepId),
    );
    if (
      [...approvedDownstream].some((stepId) => !allowedDownstream.has(stepId))
    ) {
      throw new Error("Aprobarea conține un pas downstream necunoscut.");
    }
    const approvedChanges = new Map<string, AiStepChangeProposal>([
      [proposal.currentStepChange.stepId, proposal.currentStepChange],
      ...proposal.downstreamChanges
        .filter((change) => approvedDownstream.has(change.stepId))
        .map((change): [string, AiStepChangeProposal] => [
          change.stepId,
          change,
        ]),
    ]);
    const appliedStepIds: string[] = [];
    const flowItems = test.flowItems.map((item) => {
      const change = approvedChanges.get(item.id);
      if (change === undefined) return item;
      const changed = applyPatch(item, change.patch);
      if (JSON.stringify(changed) !== JSON.stringify(item)) {
        appliedStepIds.push(item.id);
      }
      return changed;
    });
    if (appliedStepIds.length === 0) {
      throw new Error("Propunerea aprobată nu conține modificări aplicabile.");
    }
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, flowItems, []),
    );
    if (!validation.valid) {
      throw new Error(
        `Propunerea AI produce un flow invalid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    const saved = await this.tests.saveAiFlow(
      input.projectId,
      input.testId,
      flowItems,
    );
    return {
      test: saved,
      appliedStepIds,
      aiVersion: saved.version,
    };
  }

  public async undo(input: UndoAiStepChangeInput): Promise<TestDefinition> {
    if (
      typeof input !== "object" ||
      input === null ||
      !Number.isInteger(input.aiVersion)
    ) {
      throw new Error("Cererea Undo AI nu este validă.");
    }
    return this.tests.undoAiFlow(
      input.projectId,
      input.testId,
      input.aiVersion,
    );
  }
}
