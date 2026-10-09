import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import type { TestDefinition, TestVersion } from "../shared/persistence.js";
import {
  defaultTestPostRunChecks,
  validateTestPostRunChecks,
  type TestPostRunChecks,
} from "../shared/post-run-checks.js";
import { toDeclarativeTestDefinition } from "../shared/test-editor.js";
import type {
  DatasetPrimitive,
  DatasetValue,
  TestDataset,
  TestFlowItem,
} from "../shared/test-model.js";
import {
  flattenStageFlowItems,
  stagesForTest,
  validateTestStageDependencies,
  type TestStage,
} from "../shared/test-stages.js";
import { validateDeclarativeTest } from "../shared/test-validation.js";
import {
  hasTestInputErrors,
  normalizeTestStartUrl,
  type TestInput,
  validateTestInput,
} from "../shared/tests.js";
import {
  ProjectRepository,
  DatasetRepository,
  TestRepository,
} from "./persistence/repositories.js";

export interface TestsServiceOptions {
  createId: () => string;
  now: () => Date;
  snapshotRoot: string;
}

export interface CreateAiGeneratedVariantInput {
  name: string;
  description: string;
  flowItems: TestFlowItem[];
  datasets: Array<{
    name: string;
    values: Record<string, DatasetPrimitive>;
  }>;
  instruction: string;
  provider: string;
  model: string;
}

export interface CreateAiGeneratedFormTestInput {
  name: string;
  description: string;
  startUrl: string;
  flowItems: TestFlowItem[];
  dataset: {
    name: string;
    values: Record<string, DatasetValue>;
  };
  postRunChecks: TestPostRunChecks;
  sourceFormId: string;
  instruction: string;
  provider: string;
  model: string;
}

export class TestsService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly testRepository: TestRepository,
    private readonly datasetRepository: DatasetRepository,
    private readonly options: TestsServiceOptions,
  ) {}

  public list(projectId: string): TestDefinition[] {
    this.requireProject(projectId);
    return this.testRepository.listByProject(projectId);
  }

  public get(projectId: string, testId: string): TestDefinition {
    this.requireProject(projectId);
    const test = this.testRepository.findById(testId);

    if (test === undefined || test.projectId !== projectId) {
      throw new Error("Testul nu mai există.");
    }

    return test;
  }

  public create(projectId: string, input: TestInput): TestDefinition {
    const project = this.requireProject(projectId);
    const errors = validateTestInput(input, project);

    if (hasTestInputErrors(errors)) {
      throw new Error("Datele testului nu sunt valide.");
    }

    const now = this.options.now().toISOString();
    const description = input.description?.trim();
    const startUrl = input.startUrl.trim();
    const testId = this.options.createId();
    const test: TestDefinition = {
      id: testId,
      projectId,
      name: input.name.trim(),
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      status: "draft",
      version: 1,
      testMode: input.testMode ?? "recorded",
      wipeBeforeRun: input.wipeBeforeRun ?? false,
      startMode: "base_url",
      startUrl,
      normalizedStartUrl: normalizeTestStartUrl(startUrl),
      workflowState: "not_recorded",
      createdAt: now,
      updatedAt: now,
      flowItems: [],
      stages: [
        {
          id: `stage-${testId}-1`,
          name: "Flow principal",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: [],
          postChecks: [],
        },
      ],
      postRunChecks: defaultTestPostRunChecks(),
    };
    return this.testRepository.create(test);
  }

  public createAiGeneratedVariant(
    projectId: string,
    sourceTestId: string,
    input: CreateAiGeneratedVariantInput,
  ): { test: TestDefinition; datasets: TestDataset[] } {
    this.requireProject(projectId);
    const source = this.get(projectId, sourceTestId);
    const timestamp = this.options.now().toISOString();
    const testId = this.options.createId();
    const description = input.description.trim();
    const test: TestDefinition = {
      ...structuredClone(source),
      id: testId,
      name: input.name.trim(),
      ...(description.length === 0 ? {} : { description }),
      status: input.flowItems.length === 0 ? "draft" : "valid",
      version: 1,
      workflowState: input.flowItems.length === 0 ? "not_recorded" : "ready",
      createdAt: timestamp,
      updatedAt: timestamp,
      flowItems: structuredClone(input.flowItems),
      stages: [
        {
          id: `stage-${testId}-1`,
          name: "Flow generat AI",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: structuredClone(input.flowItems),
          postChecks: [],
        },
      ],
      aiGeneration: {
        sourceType: "test",
        sourceTestId,
        instruction: input.instruction.trim(),
        provider: input.provider,
        model: input.model,
        generatedAt: timestamp,
      },
    };
    if (description.length === 0) delete test.description;
    delete test.invalidation;
    const datasets = input.datasets.map<TestDataset>((dataset) => ({
      id: this.options.createId(),
      testId,
      name: dataset.name.trim(),
      values: structuredClone(dataset.values),
      createdAt: timestamp,
      updatedAt: timestamp,
    }));
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, test.flowItems, datasets),
    );
    if (!validation.valid) {
      throw new Error(
        `Varianta AI nu este validă: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    const created = this.testRepository.create(test);
    const createdDatasets = datasets.map((dataset) =>
      this.datasetRepository.create(dataset),
    );
    return { test: created, datasets: createdDatasets };
  }

  public createAiGeneratedFormTest(
    projectId: string,
    input: CreateAiGeneratedFormTestInput,
  ): { test: TestDefinition; dataset: TestDataset } {
    const project = this.requireProject(projectId);
    const name = input.name.trim();
    const startUrl = input.startUrl.trim();
    const errors = validateTestInput(
      {
        name,
        description: input.description,
        startUrl,
        testMode: "recorded",
        wipeBeforeRun: false,
      },
      project,
    );
    if (hasTestInputErrors(errors)) {
      throw new Error("Testul generat din formular nu are metadate valide.");
    }
    const timestamp = this.options.now().toISOString();
    const testId = this.options.createId();
    const dataset: TestDataset = {
      id: this.options.createId(),
      testId,
      name: input.dataset.name.trim(),
      values: structuredClone(input.dataset.values),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const test: TestDefinition = {
      id: testId,
      projectId,
      name,
      ...(input.description.trim().length === 0
        ? {}
        : { description: input.description.trim() }),
      status: "valid",
      version: 1,
      testMode: "recorded",
      wipeBeforeRun: false,
      startMode: "base_url",
      startUrl,
      normalizedStartUrl: normalizeTestStartUrl(startUrl),
      workflowState: "ready",
      createdAt: timestamp,
      updatedAt: timestamp,
      flowItems: structuredClone(input.flowItems),
      stages: [
        {
          id: `stage-${testId}-1`,
          name: "Flow generat AI",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: structuredClone(input.flowItems),
          postChecks: [],
        },
      ],
      postRunChecks: validateTestPostRunChecks(input.postRunChecks),
      aiGeneration: {
        sourceType: "form",
        sourceFormId: input.sourceFormId,
        instruction: input.instruction.trim(),
        provider: input.provider,
        model: input.model,
        generatedAt: timestamp,
      },
    };
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(test, test.flowItems, [dataset]),
    );
    if (!validation.valid) {
      throw new Error(
        `Testul generat din formular nu este valid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    const created = this.testRepository.create(test);
    this.datasetRepository.create(dataset);
    return { test: created, dataset };
  }

  public update(
    projectId: string,
    testId: string,
    input: TestInput,
  ): TestDefinition {
    const project = this.requireProject(projectId);
    const existing = this.get(projectId, testId);
    const errors = validateTestInput(input, project);

    if (hasTestInputErrors(errors)) {
      throw new Error("Datele testului nu sunt valide.");
    }

    const normalizedStartUrl = normalizeTestStartUrl(input.startUrl);
    const startUrlChanged = normalizedStartUrl !== existing.normalizedStartUrl;
    const description = input.description?.trim();
    const updated: TestDefinition = {
      ...existing,
      name: input.name.trim(),
      ...(description === undefined || description.length === 0
        ? {}
        : { description }),
      status: startUrlChanged ? "draft" : existing.status,
      version: existing.version + 1,
      testMode: input.testMode ?? existing.testMode,
      wipeBeforeRun: input.wipeBeforeRun ?? existing.wipeBeforeRun,
      startUrl: input.startUrl.trim(),
      normalizedStartUrl,
      workflowState: startUrlChanged ? "not_recorded" : existing.workflowState,
      updatedAt: this.options.now().toISOString(),
      flowItems: startUrlChanged ? [] : existing.flowItems,
      ...(startUrlChanged
        ? {
            stages: [
              {
                id: `stage-${existing.id}-1`,
                name: "Flow principal",
                enabled: true,
                entry: { type: "test_start" } as const,
                flowItems: [],
                postChecks: [],
              },
            ],
          }
        : {}),
    };
    if (description === undefined || description.length === 0) {
      delete updated.description;
    }

    return this.testRepository.update(updated);
  }

  public delete(projectId: string, testId: string): boolean {
    this.get(projectId, testId);
    return this.testRepository.delete(testId);
  }

  public revalidate(projectId: string, testId: string): TestDefinition {
    const existing = this.get(projectId, testId);
    if (existing.status !== "invalidated") {
      throw new Error("Doar un test invalidat poate fi revalidat.");
    }
    const updated: TestDefinition = {
      ...existing,
      status: "valid",
      workflowState: "ready",
      updatedAt: this.options.now().toISOString(),
    };
    delete updated.invalidation;
    return this.testRepository.update(updated);
  }

  public savePostRunChecks(
    projectId: string,
    testId: string,
    input: TestPostRunChecks,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      updatedAt: this.options.now().toISOString(),
      postRunChecks: validateTestPostRunChecks(input),
    };
    return this.testRepository.update(updated);
  }

  public async saveFlow(
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
  ): Promise<TestDefinition> {
    return this.saveVersionedFlow(projectId, testId, flowItems, "manual");
  }

  public async saveStages(
    projectId: string,
    testId: string,
    stages: TestStage[],
  ): Promise<TestDefinition> {
    const existing = this.get(projectId, testId);
    if (stages.length === 0) {
      throw new Error("Testul trebuie să conțină cel puțin o etapă.");
    }
    const datasets = this.datasetRepository.listByTest(testId);
    const datasetKeys = new Set(
      datasets.flatMap((dataset) => Object.keys(dataset.values)),
    );
    const issues = validateTestStageDependencies(stages, datasetKeys);
    if (issues.length > 0) {
      throw new Error(
        `Etapele testului nu sunt valide: ${issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    const now = this.options.now().toISOString();
    const enabledItems = stages
      .filter((stage) => stage.enabled)
      .flatMap((stage) => [...stage.flowItems, ...stage.postChecks]);
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      status: enabledItems.length === 0 ? "draft" : "valid",
      workflowState: enabledItems.length === 0 ? "not_recorded" : "ready",
      updatedAt: now,
      stages: structuredClone(stages),
      flowItems: flattenStageFlowItems(stages),
    };
    return this.persistFlowVersion(existing, updated, "manual");
  }

  public async saveAiFlow(
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
  ): Promise<TestDefinition> {
    return this.saveVersionedFlow(projectId, testId, flowItems, "ai");
  }

  public async importFlow(
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
  ): Promise<TestDefinition> {
    return this.saveVersionedFlow(projectId, testId, flowItems, "import");
  }

  public async undoAiFlow(
    projectId: string,
    testId: string,
    aiVersion: number,
  ): Promise<TestDefinition> {
    const existing = this.get(projectId, testId);
    if (existing.version !== aiVersion) {
      throw new Error(
        "Undo AI nu poate fi aplicat deoarece testul are modificări mai noi.",
      );
    }
    const versions = this.testRepository.listVersions(testId);
    const aiSnapshot = versions.find(
      (version) => version.versionNumber === aiVersion,
    );
    if (aiSnapshot?.source !== "ai") {
      throw new Error("Versiunea indicată nu este o modificare AI.");
    }
    const previous = versions
      .filter((version) => version.versionNumber < aiVersion)
      .sort((left, right) => right.versionNumber - left.versionNumber)[0];
    if (previous === undefined) {
      throw new Error("Nu există o versiune anterioară pentru Undo AI.");
    }
    let snapshot: unknown;
    try {
      snapshot = JSON.parse(
        await readFile(
          this.resolveSnapshotPath(previous.snapshotFilePath),
          "utf8",
        ),
      );
    } catch {
      throw new Error("Versiunea anterioară nu a putut fi citită.");
    }
    const validation = validateDeclarativeTest(snapshot);
    if (!validation.valid) {
      throw new Error("Versiunea anterioară nu mai este validă.");
    }
    const restored = validation.data.flowItems;
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      status: restored.length === 0 ? "draft" : "valid",
      workflowState: restored.length === 0 ? "not_recorded" : "ready",
      updatedAt: this.options.now().toISOString(),
      flowItems: restored,
    };
    return this.persistFlowVersion(existing, updated, "manual");
  }

  private async saveVersionedFlow(
    projectId: string,
    testId: string,
    flowItems: TestFlowItem[],
    source: TestVersion["source"],
  ): Promise<TestDefinition> {
    const existing = this.get(projectId, testId);
    const now = this.options.now().toISOString();
    const currentStages = stagesForTest(existing);
    const updatedStages = currentStages.map((stage, index) =>
      index === 0 ? { ...stage, flowItems: structuredClone(flowItems) } : stage,
    );
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      status: flowItems.length === 0 ? "draft" : "valid",
      workflowState: flowItems.length === 0 ? "not_recorded" : "ready",
      updatedAt: now,
      flowItems,
      ...(existing.stages === undefined ? {} : { stages: updatedStages }),
    };
    return this.persistFlowVersion(existing, updated, source);
  }

  private stagesWithRecordingFlow(
    test: TestDefinition,
    flowItems: TestFlowItem[],
    stageId?: string,
  ): TestStage[] | undefined {
    if (test.stages === undefined) return undefined;
    const targetIndex =
      stageId === undefined
        ? 0
        : test.stages.findIndex((stage) => stage.id === stageId);
    if (targetIndex < 0) {
      throw new Error("Etapa selectată pentru recorder nu există.");
    }
    return stagesForTest(test).map((stage, index) =>
      index === targetIndex
        ? { ...stage, flowItems: structuredClone(flowItems) }
        : structuredClone(stage),
    );
  }

  private recordingFlow(
    test: TestDefinition,
    stageId?: string,
  ): TestFlowItem[] {
    if (test.stages === undefined) return test.flowItems;
    const stage =
      stageId === undefined
        ? test.stages[0]
        : test.stages.find((candidate) => candidate.id === stageId);
    if (stage === undefined) {
      throw new Error("Etapa selectată pentru recorder nu există.");
    }
    return stage.flowItems;
  }

  public beginRecording(
    projectId: string,
    testId: string,
    stageId?: string,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    if (
      ![
        "not_recorded",
        "recording",
        "recorded",
        "flow_analyzed",
        "ready",
      ].includes(existing.workflowState)
    ) {
      throw new Error("Testul nu poate porni recorderul în starea curentă.");
    }
    const stages = this.stagesWithRecordingFlow(existing, [], stageId);
    const flowItems = stages === undefined ? [] : flattenStageFlowItems(stages);
    return this.testRepository.update({
      ...existing,
      status: "draft",
      workflowState: "recording",
      updatedAt: this.options.now().toISOString(),
      flowItems,
      ...(stages === undefined ? {} : { stages }),
    });
  }

  public continueRecording(
    projectId: string,
    testId: string,
    stageId?: string,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    if (
      !["recorded", "flow_analyzed", "ready"].includes(
        existing.workflowState,
      ) ||
      this.recordingFlow(existing, stageId).length === 0
    ) {
      throw new Error(
        "Înregistrarea poate continua numai pentru un flow existent.",
      );
    }
    return this.testRepository.update({
      ...existing,
      status: "draft",
      workflowState: "recording",
      updatedAt: this.options.now().toISOString(),
    });
  }

  public appendRecordedStep(
    projectId: string,
    testId: string,
    step: TestFlowItem,
    stageId?: string,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    if (existing.workflowState !== "recording") {
      throw new Error("Recorderul testului nu este activ.");
    }
    const firstStageFlow = [...this.recordingFlow(existing, stageId), step];
    const stages = this.stagesWithRecordingFlow(
      existing,
      firstStageFlow,
      stageId,
    );
    const flowItems =
      stages === undefined ? firstStageFlow : flattenStageFlowItems(stages);
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(
        {
          ...existing,
          flowItems,
          ...(stages === undefined ? {} : { stages }),
        },
        flowItems,
        this.datasetRepository.listByTest(testId),
      ),
    );
    if (!validation.valid) {
      throw new Error(
        `Pasul recorder nu este valid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    return this.testRepository.update({
      ...existing,
      flowItems,
      ...(stages === undefined ? {} : { stages }),
      updatedAt: this.options.now().toISOString(),
    });
  }

  public replaceLastRecordedStep(
    projectId: string,
    testId: string,
    step: TestFlowItem,
    stageId?: string,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    const currentFirstStageFlow = this.recordingFlow(existing, stageId);
    if (
      existing.workflowState !== "recording" ||
      currentFirstStageFlow.length === 0
    ) {
      throw new Error("Recorderul nu are un pas care poate fi actualizat.");
    }
    const firstStageFlow = [...currentFirstStageFlow.slice(0, -1), step];
    const stages = this.stagesWithRecordingFlow(
      existing,
      firstStageFlow,
      stageId,
    );
    const flowItems =
      stages === undefined ? firstStageFlow : flattenStageFlowItems(stages);
    const validation = validateDeclarativeTest(
      toDeclarativeTestDefinition(
        {
          ...existing,
          flowItems,
          ...(stages === undefined ? {} : { stages }),
        },
        flowItems,
        this.datasetRepository.listByTest(testId),
      ),
    );
    if (!validation.valid) {
      throw new Error(
        `Pasul recorder comasat nu este valid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }
    return this.testRepository.update({
      ...existing,
      flowItems,
      ...(stages === undefined ? {} : { stages }),
      updatedAt: this.options.now().toISOString(),
    });
  }

  public async completeRecording(
    projectId: string,
    testId: string,
    stageId?: string,
  ): Promise<TestDefinition> {
    const existing = this.get(projectId, testId);
    if (existing.workflowState !== "recording") {
      throw new Error("Recorderul testului nu este activ.");
    }
    if (this.recordingFlow(existing, stageId).length === 0) {
      throw new Error("Înregistrarea nu conține niciun pas.");
    }
    const updated: TestDefinition = {
      ...existing,
      version: existing.version + 1,
      status: "draft",
      workflowState: "flow_analyzed",
      updatedAt: this.options.now().toISOString(),
    };
    return this.persistFlowVersion(existing, updated, "recorder");
  }

  public markRecordingIncomplete(
    projectId: string,
    testId: string,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    if (existing.workflowState !== "recording") return existing;
    return this.testRepository.update({
      ...existing,
      workflowState:
        existing.flowItems.length === 0 ? "not_recorded" : "recorded",
      updatedAt: this.options.now().toISOString(),
    });
  }

  public cancelRecording(
    projectId: string,
    testId: string,
    originalTest: TestDefinition,
  ): TestDefinition {
    const existing = this.get(projectId, testId);
    if (originalTest.projectId !== projectId || originalTest.id !== testId) {
      throw new Error("Testul original nu aparține înregistrării curente.");
    }
    if (existing.workflowState !== "recording") return existing;
    return this.testRepository.update({
      ...originalTest,
      flowItems: structuredClone(originalTest.flowItems),
      ...(originalTest.stages === undefined
        ? {}
        : { stages: structuredClone(originalTest.stages) }),
      updatedAt: this.options.now().toISOString(),
    });
  }

  private async persistFlowVersion(
    existing: TestDefinition,
    updated: TestDefinition,
    source: TestVersion["source"],
  ): Promise<TestDefinition> {
    const { id: testId, projectId } = updated;
    const snapshot = toDeclarativeTestDefinition(
      updated,
      updated.flowItems,
      this.datasetRepository.listByTest(testId),
    );
    const validation = validateDeclarativeTest(snapshot);
    if (!validation.valid) {
      throw new Error(
        `Flow-ul testului nu este valid: ${validation.issues[0]?.message ?? "eroare necunoscută"}`,
      );
    }

    const snapshotPath = join(
      "projects",
      projectId,
      "tests",
      testId,
      `v${updated.version}`,
      "test.json",
    );
    const absolutePath = this.resolveSnapshotPath(snapshotPath);
    const temporaryDirectory = `${dirname(absolutePath)}.tmp-${this.options.createId()}`;
    await mkdir(temporaryDirectory, { recursive: true });
    await writeFile(
      join(temporaryDirectory, "test.json"),
      `${JSON.stringify(validation.data, null, 2)}\n`,
      "utf8",
    );

    try {
      await mkdir(dirname(dirname(absolutePath)), { recursive: true });
      await rename(temporaryDirectory, dirname(absolutePath));
      this.testRepository.update(updated);
      this.testRepository.createVersion({
        id: this.options.createId(),
        testId,
        versionNumber: updated.version,
        source,
        createdAt: updated.updatedAt,
        snapshotFilePath: snapshotPath.replaceAll("\\", "/"),
      });
      return updated;
    } catch (error) {
      this.testRepository.update(existing);
      await rm(dirname(absolutePath), { force: true, recursive: true });
      await rm(temporaryDirectory, { force: true, recursive: true });
      throw error;
    }
  }

  public listVersions(projectId: string, testId: string): TestVersion[] {
    this.get(projectId, testId);
    return this.testRepository.listVersions(testId);
  }

  private resolveSnapshotPath(portablePath: string): string {
    const root = resolve(this.options.snapshotRoot);
    const target = resolve(root, portablePath);
    const pathFromRoot = relative(root, target);
    if (
      pathFromRoot.startsWith("..") ||
      pathFromRoot.length === 0 ||
      /^[A-Za-z]:/.test(pathFromRoot)
    ) {
      throw new Error("Calea snapshot-ului nu este sigură.");
    }
    return target;
  }

  private requireProject(projectId: string) {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) {
      throw new Error("Proiectul nu mai există.");
    }
    return project;
  }
}
