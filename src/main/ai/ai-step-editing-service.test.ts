import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiRequestPreview,
  AiStepEditProposal,
  CreateAiRequestPreviewInput,
} from "../../shared/ai.js";
import type { TestDefinition } from "../../shared/persistence.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import {
  AiStepEditingService,
  type PageAiContextSource,
} from "./ai-step-editing-service.js";
import type { TestsService } from "../tests-service.js";

const test: TestDefinition = {
  id: "test-1",
  projectId: "project-1",
  name: "Programare",
  status: "valid",
  version: 4,
  testMode: "dynamic_ai",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/booking",
  normalizedStartUrl: "https://example.test/booking",
  workflowState: "ready",
  createdAt: "2026-07-25T10:00:00.000Z",
  updatedAt: "2026-07-25T10:00:00.000Z",
  flowItems: [
    {
      id: "step-1",
      type: "action",
      actionType: "click",
      title: "Luna următoare",
      humanDescription: "Apasă luna următoare.",
      whyExplanation: "Navighează în calendar.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "data_attribute",
          operator: "equals",
          value: "calendar-next",
          attribute: "data-testid",
        },
      },
      fallbacks: [],
      enabled: true,
    },
    {
      id: "step-2",
      type: "action",
      actionType: "click",
      title: "Alege ziua",
      humanDescription: "Apasă ziua.",
      whyExplanation: "Selectează data.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "data_attribute",
          operator: "equals",
          value: "calendar-day-15",
          attribute: "data-testid",
        },
      },
      fallbacks: [],
      enabled: true,
    },
    {
      id: "step-3",
      type: "action",
      actionType: "click",
      title: "Alege ora",
      humanDescription: "Apasă ora.",
      whyExplanation: "Selectează intervalul.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "text",
          operator: "equals",
          value: "10:30",
        },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const preview: AiRequestPreview = {
  task: "edit_step",
  provider: "gemini",
  model: "gemini-flash",
  systemInstruction: "JSON only",
  prompt: "Edit step",
  outputSchema: {},
  contextPreview: {
    selectedStep: { id: "step-2" },
  },
  estimatedInputTokens: 100,
  originalContextBytes: 500,
  sentContextBytes: 400,
  omittedPaths: [],
};

const proposal: AiStepEditProposal = {
  summary: "Clarifică selecția datei și pasul următor.",
  currentStepChange: {
    stepId: "step-2",
    patch: {
      title: "Alege ziua 15 din calendar",
      humanDescription: "Apasă ziua 15 din luna și anul afișate.",
    },
    rationale: "Face selecția explicită.",
  },
  downstreamChanges: [
    {
      stepId: "step-3",
      patch: { title: "Alege ora 10:30" },
      rationale: "Păstrează ora corelată cu data.",
    },
  ],
};

describe("AiStepEditingService", () => {
  let aiSettings: {
    preview: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
  };
  let tests: {
    get: ReturnType<typeof vi.fn>;
    saveAiFlow: ReturnType<typeof vi.fn>;
    undoAiFlow: ReturnType<typeof vi.fn>;
  };
  let pageContext: {
    getAiSemanticContext: ReturnType<typeof vi.fn>;
  };
  let service: AiStepEditingService;

  beforeEach(() => {
    aiSettings = {
      preview: vi.fn().mockReturnValue(preview),
      generate: vi.fn().mockResolvedValue({
        provider: "gemini",
        model: "gemini-flash",
        output: proposal,
        usage: { inputTokens: 120, outputTokens: 60, totalTokens: 180 },
      }),
    };
    tests = {
      get: vi.fn().mockReturnValue(test),
      saveAiFlow: vi
        .fn()
        .mockImplementation(
          (
            _projectId: string,
            _testId: string,
            flowItems: TestDefinition["flowItems"],
          ) => Promise.resolve({ ...test, version: 5, flowItems }),
        ),
      undoAiFlow: vi
        .fn()
        .mockResolvedValue({ ...test, version: 6, flowItems: test.flowItems }),
    };
    pageContext = {
      getAiSemanticContext: vi.fn().mockResolvedValue([
        {
          pageId: "page-calendar",
          versionNumber: 2,
          semanticAnalysis: { interactiveElements: [] },
        },
      ]),
    };
    service = new AiStepEditingService(
      aiSettings as unknown as AiSettingsService,
      tests as unknown as TestsService,
      pageContext as unknown as PageAiContextSource,
    );
  });

  it("previews only the selected step, nearby steps and linked page analysis", async () => {
    const result = await service.preview({
      projectId: "project-1",
      testId: "test-1",
      selectedStepId: "step-2",
      instruction: "Clarifică selecția zilei.",
      provider: "gemini",
      model: "gemini-flash",
    });

    expect(result.context).toEqual({
      selectedStepId: "step-2",
      previousStepIds: ["step-1"],
      nextStepIds: ["step-3"],
      pageIds: ["page-calendar"],
    });
    expect(pageContext.getAiSemanticContext).toHaveBeenCalledWith("project-1", [
      "page-calendar",
    ]);
    const previewInput = aiSettings.preview.mock.calls[0]?.[0] as unknown as
      CreateAiRequestPreviewInput | undefined;
    expect(previewInput?.task).toBe("edit_step");
    expect(previewInput?.provider).toBe("gemini");
    expect(previewInput?.model).toBe("gemini-flash");
    const serializedContext = JSON.stringify(previewInput?.context);
    expect(serializedContext).toContain("Clarifică selecția zilei.");
    expect(serializedContext).toContain('"id":"step-1"');
    expect(serializedContext).toContain('"id":"step-2"');
    expect(serializedContext).toContain('"id":"step-3"');
  });

  it("does not expose AI editing for recorded-only tests", async () => {
    tests.get.mockReturnValue({ ...test, testMode: "recorded" });

    await expect(
      service.preview({
        projectId: "project-1",
        testId: "test-1",
        selectedStepId: "step-2",
        instruction: "Schimbă pasul.",
      }),
    ).rejects.toThrow("marcate dinamice");
    expect(aiSettings.preview).not.toHaveBeenCalled();
  });

  it("returns a validated proposal, exact token usage and field diffs", async () => {
    const result = await service.generate({
      projectId: "project-1",
      testId: "test-1",
      selectedStepId: "step-2",
      instruction: "Clarifică selecția zilei.",
    });

    expect(result.proposal).toEqual(proposal);
    expect(result.usage.totalTokens).toBe(180);
    expect(result.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stepId: "step-2",
          field: "title",
          before: "Alege ziua",
          after: "Alege ziua 15 din calendar",
        }),
        expect.objectContaining({
          stepId: "step-3",
          field: "title",
          after: "Alege ora 10:30",
        }),
      ]),
    );
  });

  it("applies the current step and only individually approved downstream changes", async () => {
    const applied = await service.apply({
      projectId: "project-1",
      testId: "test-1",
      baseVersion: 4,
      selectedStepId: "step-2",
      proposal,
      approvedDownstreamStepIds: ["step-3"],
    });

    expect(applied).toMatchObject({
      aiVersion: 5,
      appliedStepIds: ["step-2", "step-3"],
    });
    const savedFlow = tests.saveAiFlow.mock.calls[0]?.[2] as
      TestDefinition["flowItems"] | undefined;
    expect(savedFlow?.[0]?.title).toBe("Luna următoare");
    expect(savedFlow?.[1]?.title).toBe("Alege ziua 15 din calendar");
    expect(savedFlow?.[2]?.title).toBe("Alege ora 10:30");
  });

  it("rejects upstream or stale proposals before creating a version", async () => {
    await expect(
      service.apply({
        projectId: "project-1",
        testId: "test-1",
        baseVersion: 3,
        selectedStepId: "step-2",
        proposal,
        approvedDownstreamStepIds: [],
      }),
    ).rejects.toThrow("modificat");

    await expect(
      service.apply({
        projectId: "project-1",
        testId: "test-1",
        baseVersion: 4,
        selectedStepId: "step-2",
        proposal: {
          ...proposal,
          downstreamChanges: [
            {
              stepId: "step-1",
              patch: { title: "Schimbare upstream" },
              rationale: "Nu este permis.",
            },
          ],
        },
        approvedDownstreamStepIds: [],
      }),
    ).rejects.toThrow("downstream");
    expect(tests.saveAiFlow).not.toHaveBeenCalled();
  });

  it("delegates Undo to the versioned test service", async () => {
    const restored = await service.undo({
      projectId: "project-1",
      testId: "test-1",
      aiVersion: 5,
    });

    expect(restored.version).toBe(6);
    expect(tests.undoAiFlow).toHaveBeenCalledWith("project-1", "test-1", 5);
  });
});
