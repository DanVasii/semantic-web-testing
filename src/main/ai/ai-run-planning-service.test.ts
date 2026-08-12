import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AiRequestPreview,
  AiRunPlanProposal,
  CreateAiRequestPreviewInput,
} from "../../shared/ai.js";
import type { JsonValue, TestDefinition } from "../../shared/persistence.js";
import type { TestsService } from "../tests-service.js";
import {
  AiRunPlanningService,
  applyAiRunPlan,
} from "./ai-run-planning-service.js";
import { createAiRequestPreview } from "./ai-prompts.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import type { PageAiContextSource } from "./ai-step-editing-service.js";

const test: TestDefinition = {
  id: "test-calendar",
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
      id: "year",
      type: "action",
      actionType: "select_option",
      title: "Alege anul",
      humanDescription: "Alege anul 2027.",
      whyExplanation: "Configurează calendarul.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-year",
        },
      },
      inputFieldId: "calendar_year",
      valueKey: "calendar_year",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    },
    {
      id: "next-month",
      type: "action",
      actionType: "click",
      title: "Luna următoare",
      humanDescription: "Apasă luna următoare.",
      whyExplanation: "Ajunge în august.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-next-month",
        },
      },
      fallbacks: [],
      enabled: true,
    },
    {
      id: "day",
      type: "action",
      actionType: "click",
      title: "Alege 12 august",
      humanDescription: "Apasă ziua 12.",
      whyExplanation: "Selectează data înregistrată.",
      pageId: "page-calendar",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-day-2027-08-12",
        },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const proposal: AiRunPlanProposal = {
  summary: "Selectează temporar 15 septembrie 2028.",
  changes: [
    {
      stepId: "year",
      patch: { datasetValue: "2028" },
      rationale: "Schimbă anul numai pentru această rulare.",
    },
    {
      stepId: "next-month",
      patch: {
        repeatUntil: {
          target: {
            type: "css",
            operator: "equals",
            value: "#calendar-heading",
          },
          operator: "equals",
          value: "septembrie 2028",
          maxAttempts: 12,
        },
      },
      rationale: "Navighează până când markerul vizual arată perioada cerută.",
    },
    {
      stepId: "day",
      patch: {
        primaryLocator: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-day-2028-09-15",
        },
      },
      rationale: "Alege ziua cerută.",
    },
  ],
  insertions: [],
};

describe("AiRunPlanningService", () => {
  let aiSettings: {
    preview: ReturnType<typeof vi.fn>;
    generate: ReturnType<typeof vi.fn>;
  };
  let tests: { get: ReturnType<typeof vi.fn> };
  let pageContext: { getAiSemanticContext: ReturnType<typeof vi.fn> };
  let service: AiRunPlanningService;

  beforeEach(() => {
    const preview: AiRequestPreview = {
      task: "adapt_run",
      provider: "gemini",
      model: "gemini-flash",
      systemInstruction: "JSON only",
      prompt: "Adapt run",
      outputSchema: {
        type: "object",
        properties: {
          changes: {
            type: "array",
            items: {
              type: "object",
              properties: {
                stepId: { type: "string" },
              },
            },
          },
          insertions: {
            type: "array",
            items: {
              type: "object",
              properties: {
                anchorStepId: { type: "string" },
              },
            },
          },
        },
      },
      contextPreview: JSON.parse(
        JSON.stringify({
          recordedFlow: test.flowItems,
          semanticInteractionMap: [
            {
              pageId: "page-calendar",
              controlsAndMarkers: [
                {
                  fieldId: "calendar_heading",
                  role: "heading",
                  accessibleName: "iulie 2026",
                  primaryLocator: {
                    strategy: {
                      type: "css",
                      operator: "equals",
                      value: "#calendar-heading",
                    },
                  },
                },
                {
                  fieldId: "next_month_button",
                  role: "button",
                  accessibleName: "Luna următoare",
                  primaryLocator: {
                    strategy: {
                      type: "data_attribute",
                      operator: "equals",
                      attribute: "data-testid",
                      value: "calendar-next-month",
                    },
                  },
                },
              ],
            },
          ],
        }),
      ) as JsonValue,
      estimatedInputTokens: 220,
      originalContextBytes: 1_000,
      sentContextBytes: 800,
      omittedPaths: [],
    };
    aiSettings = {
      preview: vi.fn().mockReturnValue(preview),
      generate: vi.fn().mockResolvedValue({
        provider: "gemini",
        model: "gemini-flash",
        output: proposal,
        usage: { inputTokens: 240, outputTokens: 80, totalTokens: 320 },
      }),
    };
    tests = { get: vi.fn().mockReturnValue(test) };
    pageContext = {
      getAiSemanticContext: vi.fn().mockResolvedValue([
        {
          pageId: "page-calendar",
          semanticAnalysis: {
            calendarCandidates: [
              {
                semanticName: "Calendar programare",
                locator: {
                  strategy: {
                    type: "data_attribute",
                    operator: "equals",
                    attribute: "data-testid",
                    value: "fixture-custom-calendar",
                  },
                },
              },
            ],
            elements: [
              {
                fieldId: "calendar_heading",
                role: "heading",
                accessibleName: "iulie 2026",
                primaryLocator: {
                  strategy: {
                    type: "css",
                    operator: "equals",
                    value: "#calendar-heading",
                  },
                },
              },
              {
                fieldId: "next_month_button",
                role: "button",
                accessibleName: "Luna următoare",
                primaryLocator: {
                  strategy: {
                    type: "data_attribute",
                    operator: "equals",
                    attribute: "data-testid",
                    value: "calendar-next-month",
                  },
                },
              },
            ],
          },
        },
      ]),
    };
    service = new AiRunPlanningService(
      aiSettings as unknown as AiSettingsService,
      tests as unknown as TestsService,
      pageContext as unknown as PageAiContextSource,
    );
  });

  it("previews the complete recorded flow without sending until generate", async () => {
    const result = await service.preview({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 15 septembrie 2028.",
      provider: "gemini",
      model: "gemini-flash",
    });

    expect(result.stepIds).toEqual(["year", "next-month", "day"]);
    expect(result.pageIds).toEqual(["page-calendar"]);
    expect(aiSettings.generate).not.toHaveBeenCalled();
    const input = aiSettings.preview.mock.calls[0]?.[0] as unknown as
      CreateAiRequestPreviewInput | undefined;
    expect(input?.task).toBe("adapt_run");
    expect(JSON.stringify(input?.context)).toContain("repeatUntil");
    expect(JSON.stringify(input?.context)).toContain("calendar-day-2027-08-12");
    expect(JSON.stringify(input?.context)).toContain(
      "recordingStateIsNotRuntimeState",
    );
    expect(JSON.stringify(input?.context)).toContain("calendar-heading");
    expect(JSON.stringify(input?.context)).toContain("calendar-next-month");
    expect(JSON.stringify(result.request.outputSchema)).toContain(
      '"enum":["year","next-month","day"]',
    );
  });

  it("returns token usage and a validated temporary plan", async () => {
    const result = await service.generate({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 15 septembrie 2028.",
    });

    expect(result.proposal).toEqual(proposal);
    expect(result.usage.totalTokens).toBe(320);
    const generateInput = aiSettings.generate.mock.calls[0]?.[0] as
      CreateAiRequestPreviewInput | undefined;
    expect(JSON.stringify(generateInput?.outputSchema)).toContain(
      '"enum":["year","next-month","day"]',
    );
  });

  it("completes an empty Gemini plan locally from the calendar analysis", async () => {
    aiSettings.generate.mockResolvedValueOnce({
      provider: "gemini",
      model: "gemini-flash",
      output: {
        summary: "Nu sunt necesare schimbări.",
        changes: [],
        insertions: [],
      },
      usage: { inputTokens: 200, outputTokens: 20, totalTokens: 220 },
    });

    const result = await service.generate({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 15 septembrie 2028.",
    });

    const navigation = result.proposal.changes.find(
      ({ stepId }) => stepId === "next-month",
    );
    const day = result.proposal.changes.find(({ stepId }) => stepId === "day");
    expect(navigation?.patch.repeatUntil?.value).toBe("septembrie 2028");
    expect(day?.patch.primaryLocator?.value).toBe("calendar-day-2028-09-15");
    expect(result.usage.totalTokens).toBe(220);
  });

  it("replaces a fixed AI repeat with runtime visual navigation", async () => {
    aiSettings.generate.mockResolvedValueOnce({
      provider: "gemini",
      model: "gemini-flash",
      output: {
        summary: "Apasă Next o dată.",
        changes: [
          {
            stepId: "next-month",
            patch: { repeat: 1 },
            rationale: "Gemini a calculat relativ la înregistrare.",
          },
        ],
        insertions: [],
      },
      usage: { inputTokens: 210, outputTokens: 30, totalTokens: 240 },
    });

    const result = await service.generate({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 15 septembrie 2028.",
    });
    const navigation = result.proposal.changes.find(
      ({ stepId }) => stepId === "next-month",
    );

    expect(navigation?.patch.repeat).toBeUndefined();
    expect(navigation?.patch.repeatUntil?.value).toBe("septembrie 2028");
  });

  it("keeps an inserted calendar action but reanchors an invented AI step ID", async () => {
    const testWithoutRecordedYear: TestDefinition = {
      ...test,
      flowItems: test.flowItems.filter(({ id }) => id !== "year"),
    };
    tests.get.mockReturnValue(testWithoutRecordedYear);
    aiSettings.generate.mockResolvedValueOnce({
      provider: "gemini",
      model: "gemini-flash",
      output: {
        summary: "Selectează 20 septembrie 2026.",
        changes: [
          {
            stepId: "calendar_select_step_id",
            patch: {
              primaryLocator: {
                type: "data_attribute",
                attribute: "data-testid",
                operator: "equals",
                value: "fixture-custom-calendar",
              },
              datasetValue: "2026-09-20",
            },
            rationale: "Actualizează data.",
          },
        ],
        insertions: [
          {
            anchorStepId: "calendar_select_step_id",
            position: "before",
            action: {
              actionType: "select_option",
              title: "Selectează anul 2026",
              humanDescription: "Selectează anul din controlul calendarului.",
              whyExplanation: "Configurează anul înainte de navigare.",
              primaryLocator: {
                type: "data_attribute",
                attribute: "data-testid",
                operator: "equals",
                value: "calendar-year",
              },
              datasetValue: "2026",
            },
            rationale: "Adaugă selectarea anului.",
          },
        ],
      },
      usage: { inputTokens: 220, outputTokens: 80, totalTokens: 300 },
    });

    const result = await service.generate({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 20 septembrie 2026.",
    });

    expect(
      result.proposal.changes.some(
        ({ stepId }) => stepId === "calendar_select_step_id",
      ),
    ).toBe(false);
    expect(result.proposal.insertions).toHaveLength(1);
    expect(result.proposal.insertions[0]).toMatchObject({
      anchorStepId: "day",
      action: {
        actionType: "select_option",
        datasetValue: "2026",
      },
    });
    expect(() =>
      applyAiRunPlan(testWithoutRecordedYear, result.proposal),
    ).not.toThrow();
  });

  it("drops a malformed calendar_select insertion and keeps the exact day patch", async () => {
    aiSettings.generate.mockResolvedValueOnce({
      provider: "gemini",
      model: "gemini-flash",
      output: {
        summary: "Selectează 22 octombrie 2026.",
        changes: [
          {
            stepId: "next-month",
            patch: {
              repeatUntil: {
                target: {
                  type: "css",
                  operator: "equals",
                  value: "#calendar-heading",
                },
                operator: "equals",
                value: "octombrie 2026",
                maxAttempts: 5,
              },
            },
            rationale: "Navighează la octombrie.",
          },
        ],
        insertions: [
          {
            anchorStepId: "next-month",
            position: "after",
            action: {
              actionType: "calendar_select",
              title: "Selectează ziua de 22",
              humanDescription: "Selectează data din calendar.",
              whyExplanation: "Alege ziua cerută.",
              primaryLocator: {
                type: "data_attribute",
                attribute: "data-testid",
                operator: "equals",
                value: "fixture-custom-calendar",
              },
              datasetValue: "22",
            },
            rationale: "Adaugă selectarea zilei.",
          },
        ],
      },
      usage: { inputTokens: 230, outputTokens: 90, totalTokens: 320 },
    });

    const result = await service.generate({
      projectId: "project-1",
      testId: test.id,
      instruction: "Selectează 22 octombrie 2026.",
    });
    const day = result.proposal.changes.find(({ stepId }) => stepId === "day");

    expect(result.proposal.insertions).toEqual([]);
    expect(day?.patch.primaryLocator?.value).toBe("calendar-day-2026-10-22");
    expect(() => applyAiRunPlan(test, result.proposal)).not.toThrow();
  });

  it("moves conditional navigation off an incompatible scroll step using real custom-calendar hints", async () => {
    const customSiteTest: TestDefinition = {
      ...test,
      id: "custom-site-test",
      flowItems: [
        {
          id: "scroll-anchor",
          type: "action",
          actionType: "scroll",
          title: "Derulează pagina",
          humanDescription: "Afișează calendarul.",
          whyExplanation: "Calendar custom.",
          pageId: "custom-page",
          scrollX: 0,
          scrollY: 200,
          fallbacks: [],
          enabled: true,
        },
        {
          id: "continue",
          type: "action",
          actionType: "click",
          title: "Continuă",
          humanDescription: "Continuă rezervarea.",
          whyExplanation: "Finalizează selecția.",
          pageId: "custom-page",
          target: {
            primary: {
              type: "css",
              operator: "equals",
              value: "#at-btn-next",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    };
    tests.get.mockReturnValue(customSiteTest);
    aiSettings.preview.mockImplementation((input) =>
      createAiRequestPreview(
        {
          provider: "gemini",
          ollama: { baseUrl: "", model: "" },
          gemini: { model: "gemini-flash", apiKeyConfigured: true },
        },
        input as CreateAiRequestPreviewInput,
      ),
    );
    pageContext.getAiSemanticContext.mockResolvedValue([
      {
        pageId: "verbose-page-before-calendar",
        semanticAnalysis: {
          elements: Array.from({ length: 30 }, (_, index) => ({
            fieldId: `email_field_${index}`,
            role: "textbox",
            accessibleName: `Email ${index}`,
            description: "x".repeat(1_000),
          })),
          calendarCandidates: [],
        },
      },
      {
        pageId: "custom-page",
        semanticAnalysis: {
          elements: [],
          calendarCandidates: [],
        },
        calendarRuntimeHints: {
          periodMarkers: [
            {
              kind: "calendar_period_marker",
              text: "‹ Iulie 2026 ›",
              primaryLocator: {
                strategy: {
                  type: "css",
                  operator: "equals",
                  value: ".cal-header",
                },
              },
            },
          ],
          navigationControls: [
            {
              kind: "calendar_next_month",
              text: "›",
              primaryLocator: {
                strategy: {
                  type: "css",
                  operator: "equals",
                  value: "#at-next-month",
                },
              },
            },
          ],
          dateCellTemplates: [
            {
              kind: "calendar_date_cell_template",
              text: "29",
              primaryLocator: {
                strategy: {
                  type: "data_attribute",
                  attribute: "data-date",
                  operator: "equals",
                  value: "2026-07-29",
                },
              },
            },
          ],
        },
      },
    ]);
    aiSettings.generate.mockResolvedValueOnce({
      provider: "gemini",
      model: "gemini-flash",
      output: {
        summary: "Selectează 17 august.",
        changes: [
          {
            stepId: "scroll-anchor",
            patch: {
              repeatUntil: {
                target: {
                  type: "css",
                  operator: "equals",
                  value: ".calendar-header",
                },
                operator: "contains",
                value: "August 2026",
                maxAttempts: 12,
              },
            },
            rationale: "Navighează până în august.",
          },
        ],
        insertions: [
          {
            anchorStepId: "scroll-anchor",
            position: "after",
            action: {
              actionType: "click",
              title: "Selectează ziua 17",
              humanDescription: "Selectează 17 august.",
              whyExplanation: "Data cerută.",
              primaryLocator: {
                type: "css",
                operator: "equals",
                value: "#calendar-day-2026-08-17",
              },
            },
            rationale: "Inserează ziua.",
          },
        ],
      },
      usage: { inputTokens: 200, outputTokens: 70, totalTokens: 270 },
    });

    const result = await service.generate({
      projectId: "project-1",
      testId: customSiteTest.id,
      instruction: "Selectează 17 august.",
    });
    const navigation = result.proposal.insertions.find(
      (insertion) => insertion.action.repeatUntil !== undefined,
    );
    const day = result.proposal.insertions.find(
      (insertion) => insertion.action.primaryLocator.attribute === "data-date",
    );
    const generatedContext = JSON.stringify(
      (
        aiSettings.generate.mock.calls.at(-1)?.[0] as
          CreateAiRequestPreviewInput | undefined
      )?.context,
    );

    expect(result.proposal.changes).toEqual([]);
    expect(generatedContext).toContain(".cal-header");
    expect(generatedContext).toContain("#at-next-month");
    expect(generatedContext).toContain("2026-07-29");
    expect(generatedContext).not.toContain(
      '"kind":"[omis: limita de context]"',
    );
    expect(navigation).toMatchObject({
      anchorStepId: "scroll-anchor",
      position: "after",
      action: {
        primaryLocator: { value: "#at-next-month" },
        repeatUntil: {
          target: { value: ".cal-header" },
          operator: "contains",
          value: "august 2026",
        },
      },
    });
    expect(day).toMatchObject({
      anchorStepId: "scroll-anchor",
      action: {
        primaryLocator: {
          type: "data_attribute",
          attribute: "data-date",
          value: "2026-08-17",
        },
      },
    });
    expect(() => applyAiRunPlan(customSiteTest, result.proposal)).not.toThrow();
  });
});

describe("applyAiRunPlan", () => {
  it("changes a cloned flow and dataset values without mutating the test", () => {
    const applied = applyAiRunPlan(test, proposal);
    const nextMonth = applied.test.flowItems[1];
    const day = applied.test.flowItems[2];

    expect(nextMonth).toMatchObject({
      id: "next-month",
      repeatUntil: {
        value: "septembrie 2028",
        maxAttempts: 12,
      },
    });
    expect(day).toMatchObject({
      id: "day",
      target: {
        primary: {
          value: "calendar-day-2028-09-15",
        },
      },
    });
    expect(applied.datasetOverrides).toEqual({ calendar_year: "2028" });
    expect(test.flowItems[1]).not.toHaveProperty("repeat");
    expect(
      test.flowItems[2]?.type === "action"
        ? test.flowItems[2].target?.primary
        : undefined,
    ).toMatchObject({ value: "calendar-day-2027-08-12" });
  });

  it("rejects repetition on an input action", () => {
    expect(() =>
      applyAiRunPlan(test, {
        summary: "Invalid",
        changes: [
          {
            stepId: "year",
            patch: { repeat: 2 },
            rationale: "Nu este permis.",
          },
        ],
        insertions: [],
      }),
    ).toThrow("nu poate fi repetat");
  });

  it("adds a declarative step temporarily at an approved anchor", () => {
    const applied = applyAiRunPlan(test, {
      summary: "Adaugă navigarea lipsă.",
      changes: [],
      insertions: [
        {
          anchorStepId: "day",
          position: "before",
          action: {
            actionType: "click",
            title: "Navighează la septembrie",
            humanDescription:
              "Apasă luna următoare până când apare septembrie 2028.",
            whyExplanation:
              "Folosește markerul vizual în locul unui număr fix de clickuri.",
            primaryLocator: {
              type: "data_attribute",
              attribute: "data-testid",
              operator: "equals",
              value: "calendar-next-month",
            },
            repeatUntil: {
              target: {
                type: "css",
                operator: "equals",
                value: "#calendar-heading",
              },
              operator: "equals",
              value: "septembrie 2028",
              maxAttempts: 24,
            },
          },
          rationale: "Flow-ul nu conține navigarea necesară.",
        },
      ],
    });

    expect(applied.test.flowItems.map(({ id }) => id)).toEqual([
      "year",
      "next-month",
      "ai-run-insert-1",
      "day",
    ]);
    expect(applied.test.flowItems[2]).toMatchObject({
      type: "action",
      repeatUntil: { value: "septembrie 2028" },
      pageId: "page-calendar",
    });
    expect(test.flowItems).toHaveLength(3);
  });
});
