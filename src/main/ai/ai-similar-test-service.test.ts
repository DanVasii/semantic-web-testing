import { describe, expect, it } from "vitest";

import type { AiSimilarTestProposal } from "../../shared/ai.js";
import type {
  JsonValue,
  TestDataset,
  TestDefinition,
} from "../../shared/persistence.js";
import {
  createAiSimilarTestOutputSchema,
  validateAiSimilarTestProposal,
} from "./ai-output.js";
import {
  applyAiSimilarTestProposal,
  buildAiSimilarTestPromptContext,
  normalizeAiSimilarTestAdaptiveChecks,
  resolveAiSimilarTestStepReferences,
} from "./ai-similar-test-service.js";

const source: TestDefinition = {
  id: "test-source",
  projectId: "project-1",
  name: "Formular valid",
  description: "Trimite formularul.",
  status: "valid",
  version: 4,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/form",
  normalizedStartUrl: "https://example.test/form",
  workflowState: "ready",
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  flowItems: [
    {
      id: "submit",
      type: "action",
      actionType: "click",
      title: "Trimite formularul",
      humanDescription: "Apasă Submit.",
      whyExplanation: "Finalizează formularul.",
      pageId: "page-form",
      target: {
        primary: {
          type: "role",
          role: "button",
          operator: "equals",
          value: "Submit",
        },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const datasets: TestDataset[] = [
  {
    id: "dataset-internal-id",
    testId: source.id,
    name: "Date formular",
    values: {
      email: "test@example.com",
      document: {
        type: "file",
        name: "document.pdf",
        path: "C:/private/document.pdf",
      },
    },
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
  },
];

const pageAnalyses: JsonValue[] = [
  {
    pageId: "page-form",
    pageVersionId: "private-version-id",
    versionNumber: 7,
    title: "Formular",
    normalizedUrl: "https://example.test/form",
    semanticAnalysis: {
      schemaVersion: 1,
      generatedAt: "2026-08-29T10:00:00.000Z",
      url: "https://example.test/form",
      elements: [
        {
          path: "html/body/button",
          fieldId: "submit-button",
          role: "button",
          accessibleName: "Submit",
          tag: "button",
          primaryLocator: {
            strategy: {
              type: "role",
              operator: "equals",
              value: "Submit",
              role: "button",
            },
            unique: true,
            stability: 0.9,
            reason: "Buton semantic stabil",
          },
          fallbackLocators: [
            {
              strategy: {
                type: "css",
                operator: "equals",
                value: "#submit",
              },
              unique: true,
              stability: 0.7,
              reason: "Fallback",
            },
          ],
          locatorStability: 0.9,
        },
      ],
      repeatedComponents: [],
      calendarCandidates: [],
      slotLists: [],
    },
    calendarRuntimeHints: [],
  },
];

describe("AiSimilarTestService proposal", () => {
  it("repairs redundant local-model changes when a check is replaced", () => {
    const sourceWithCheck: TestDefinition = {
      ...source,
      flowItems: [
        {
          id: "check-email",
          type: "check",
          checkType: "js_eval",
          title: "Verifică email invalid",
          humanDescription: "Verifică eroarea de email.",
          config: {
            jsSnippet: "document.body.innerText.includes('email invalid')",
            expectedResult: true,
          },
          timeoutMs: 5_000,
          enabled: true,
        },
      ],
    };
    const rawProposal = {
      summary: "Înlocuiește verificarea de email.",
      name: "Formular cu telefon invalid",
      description: "Validează mesajul pentru telefon.",
      datasets: [],
      changes: [
        {
          stepId: "check-email",
          patch: { title: "Verifică telefon invalid" },
          rationale: "Actualizează verificarea.",
        },
        {
          stepId: "check-email",
          patch: {
            primaryLocator: {
              type: "css",
              operator: "equals",
              value: "",
            },
          },
          rationale: "Păstrează structura.",
        },
      ],
      insertions: [
        {
          anchorStepId: "check-email",
          position: "after",
          step: {
            id: "ai-phone-check",
            type: "check",
            checkType: "js_eval",
            title: "Verifică telefon invalid",
            humanDescription: "Verifică mesajul Telefon invalid.",
            config: {
              jsSnippet:
                "document.body.innerText.toLowerCase().includes('telefon invalid')",
              expectedResult: { type: "boolean", value: true },
            },
            timeoutMs: 5_000,
            enabled: true,
          },
          rationale: "Înlocuiește verificarea veche.",
        },
      ],
      removals: [
        {
          stepId: "check-email",
          rationale: "Elimină verificarea veche.",
        },
      ],
    };

    const validated = validateAiSimilarTestProposal(rawProposal);
    expect(validated.changes).toEqual([]);

    const normalized = normalizeAiSimilarTestAdaptiveChecks(
      sourceWithCheck,
      validated,
      "Trebuie să apară eroarea Telefon invalid.",
    );
    const candidate = applyAiSimilarTestProposal(sourceWithCheck, normalized);

    expect(candidate.flowItems).toHaveLength(1);
    expect(candidate.flowItems[0]).toMatchObject({
      id: "ai-phone-check",
      type: "check",
      checkType: "adaptive",
      config: {
        strategy: "auto",
        expectedTexts: ["Telefon invalid"],
        visualFallback: true,
      },
    });
  });

  it("restricts every existing-step reference in the provider schema", () => {
    const schema = createAiSimilarTestOutputSchema(["fill-email", "submit"]);

    expect(schema).toMatchObject({
      properties: {
        changes: {
          items: {
            properties: {
              stepId: { enum: ["fill-email", "submit"] },
            },
          },
        },
        insertions: {
          items: {
            properties: {
              anchorStepId: { enum: ["fill-email", "submit"] },
            },
          },
        },
        removals: {
          items: {
            properties: {
              stepId: { enum: ["fill-email", "submit"] },
            },
          },
        },
      },
    });
  });

  it("builds an economic context with aliases and no page analysis or internal metadata", () => {
    const result = buildAiSimilarTestPromptContext({
      test: source,
      datasets,
      instruction: "Creează un caz cu email invalid.",
      mode: "economic",
      pageAnalyses: structuredClone(pageAnalyses),
    });
    const serialized = JSON.stringify(result.context);

    expect(result.references).toEqual([{ ref: "s1", stepId: "submit" }]);
    expect(result.context).toMatchObject({
      sourceTest: { flowItems: [{ ref: "s1", type: "action" }] },
      datasets: [
        {
          name: "Date formular",
          values: {
            document: { type: "file", name: "document.pdf" },
          },
        },
      ],
      pageAnalyses: [],
    });
    expect(serialized).not.toContain("dataset-internal-id");
    expect(serialized).not.toContain("C:/private/document.pdf");
    expect(serialized).not.toContain('"id":"submit"');
    expect(serialized).not.toContain("Finalizează formularul");
  });

  it("keeps useful semantic locators in balanced mode without verbose analysis metadata", () => {
    const result = buildAiSimilarTestPromptContext({
      test: source,
      datasets,
      instruction: "Apasă butonul Submit.",
      mode: "balanced",
      pageAnalyses: structuredClone(pageAnalyses),
    });
    const serialized = JSON.stringify(result.context);

    expect(result.context).toMatchObject({
      pageAnalyses: [
        {
          pageId: "page-form",
          elements: [
            {
              fieldId: "submit-button",
              accessibleName: "Submit",
              primaryLocator: { type: "role", value: "Submit" },
            },
          ],
        },
      ],
    });
    expect(serialized).not.toContain("private-version-id");
    expect(serialized).not.toContain("fallbackLocators");
    expect(serialized).not.toContain("Buton semantic stabil");
    expect(serialized).not.toContain("html/body/button");
  });

  it("keeps the original verbose details only in full mode", () => {
    const balanced = buildAiSimilarTestPromptContext({
      test: source,
      datasets,
      instruction: "Creează o variantă.",
      mode: "balanced",
      pageAnalyses: structuredClone(pageAnalyses),
    });
    const full = buildAiSimilarTestPromptContext({
      test: source,
      datasets,
      instruction: "Creează o variantă.",
      mode: "full",
      pageAnalyses: structuredClone(pageAnalyses),
    });
    const balancedJson = JSON.stringify(balanced.context);
    const fullJson = JSON.stringify(full.context);

    expect(fullJson).toContain("Finalizează formularul");
    expect(fullJson).toContain("fallbackLocators");
    expect(fullJson).toContain("dataset-internal-id");
    expect(fullJson.length).toBeGreaterThan(balancedJson.length);
  });

  it("restores real step IDs in all proposal reference fields", () => {
    const proposal: AiSimilarTestProposal = {
      summary: "Schimbă pasul.",
      name: "Variantă",
      description: "",
      datasets: [],
      changes: [
        {
          stepId: "s1",
          patch: { title: "Trimite varianta" },
          rationale: "Scenariu nou.",
        },
      ],
      insertions: [
        {
          anchorStepId: "s1",
          position: "after",
          rationale: "Verifică rezultatul.",
          step: {
            id: "ai-check-result",
            type: "check",
            checkType: "url",
            title: "URL rezultat",
            humanDescription: "Verifică URL-ul.",
            config: { operator: "contains", value: "/success" },
            enabled: true,
          },
        },
      ],
      removals: [{ stepId: "s1", rationale: "Exemplu de mapare." }],
    };

    const resolved = resolveAiSimilarTestStepReferences(proposal, [
      { ref: "s1", stepId: "submit" },
    ]);

    expect(resolved.changes[0]?.stepId).toBe("submit");
    expect(resolved.insertions[0]?.anchorStepId).toBe("submit");
    expect(resolved.removals[0]?.stepId).toBe("submit");
    expect(proposal.changes[0]?.stepId).toBe("s1");
  });

  it("reports the exact invalid step reference returned by a provider", () => {
    const proposal: AiSimilarTestProposal = {
      summary: "Schimbă datasetul.",
      name: "Formular invalid",
      description: "",
      datasets: [
        {
          name: "Email invalid",
          values: [{ key: "email", value: "invalid-email" }],
        },
      ],
      changes: [
        {
          stepId: "dataset-id-not-step-id",
          patch: { title: "Dataset modificat" },
          rationale: "Modelul a confundat datasetul cu un pas.",
        },
      ],
      insertions: [],
      removals: [],
    };

    expect(() => applyAiSimilarTestProposal(source, proposal)).toThrow(
      "changes[0].stepId „dataset-id-not-step-id” nu este ID-ul unui pas existent.",
    );
  });

  it("builds a semantic diff while preserving the source test", () => {
    const proposal: AiSimilarTestProposal = {
      summary: "Creează scenariul de email invalid.",
      name: "Formular · email invalid",
      description: "Verifică eroarea de validare.",
      datasets: [
        {
          name: "Email invalid",
          values: [{ key: "email", value: "invalid-email" }],
        },
      ],
      changes: [
        {
          stepId: "submit",
          patch: { title: "Trimite formularul invalid" },
          rationale: "Clarifică scenariul.",
        },
      ],
      insertions: [
        {
          anchorStepId: "submit",
          position: "after",
          rationale: "Verifică eroarea cerută.",
          step: {
            id: "ai-check-invalid-email",
            type: "check",
            checkType: "js_eval",
            title: "Apare eroarea de email",
            humanDescription: "Mesajul Email invalid este vizibil.",
            config: {
              jsSnippet: "document.body.innerText.includes('Email invalid')",
              expectedResult: true,
            },
            timeoutMs: 5_000,
            enabled: true,
          },
        },
      ],
      removals: [],
    };

    const candidate = applyAiSimilarTestProposal(source, proposal);

    expect(candidate.flowItems).toHaveLength(2);
    expect(candidate.flowItems[0]).toMatchObject({
      id: "submit",
      title: "Trimite formularul invalid",
    });
    expect(candidate.flowItems[1]).toMatchObject({
      id: "ai-check-invalid-email",
      type: "check",
    });
    expect(candidate.diffs.map(({ kind }) => kind)).toEqual([
      "metadata",
      "metadata",
      "dataset_added",
      "step_modified",
      "step_added",
    ]);
    expect(source.flowItems).toHaveLength(1);
    expect(source.flowItems[0]).toMatchObject({ title: "Trimite formularul" });
  });

  it("removes visual-only confidence from a js_eval patch", () => {
    const sourceWithCheck: TestDefinition = {
      ...source,
      flowItems: [
        {
          id: "check-email",
          type: "check",
          checkType: "js_eval",
          title: "Verifică eroarea",
          humanDescription: "Verifică mesajul de eroare.",
          config: {
            jsSnippet: "document.body.innerText.includes('invalid')",
            expectedResult: true,
          },
          enabled: true,
        },
      ],
    };
    const proposal = {
      summary: "Păstrează verificarea.",
      name: sourceWithCheck.name,
      description: sourceWithCheck.description ?? "",
      datasets: [],
      changes: [
        {
          stepId: "check-email",
          patch: {
            checkConfig: {
              jsSnippet: "document.body.innerText.includes('invalid')",
              expectedResult: {},
              minimumConfidence: 0.6,
            },
          },
          rationale: "Modelul a amestecat configurațiile.",
        },
      ],
      insertions: [],
      removals: [],
    } as unknown as AiSimilarTestProposal;

    const candidate = applyAiSimilarTestProposal(sourceWithCheck, proposal);

    expect(candidate.flowItems[0]).toMatchObject({
      checkType: "js_eval",
      config: {
        jsSnippet: "document.body.innerText.includes('invalid')",
        expectedResult: true,
      },
    });
    expect(JSON.stringify(candidate.flowItems[0])).not.toContain(
      "minimumConfidence",
    );
  });

  it("converts a whole-page js_eval change to an adaptive check with explicit text", () => {
    const sourceWithCheck: TestDefinition = {
      ...source,
      flowItems: [
        {
          id: "check-email",
          type: "check",
          checkType: "js_eval",
          title: "Verifică mesajul pentru email invalid",
          humanDescription: "Verifică eroarea pentru email.",
          config: {
            jsSnippet: "document.body.innerText.includes('invalid')",
            expectedResult: true,
          },
          enabled: true,
        },
      ],
    };
    const proposal = {
      summary: "Verifică telefonul invalid.",
      name: sourceWithCheck.name,
      description: sourceWithCheck.description ?? "",
      datasets: [],
      changes: [
        {
          stepId: "check-email",
          patch: {
            title: "Verifică mesajul pentru telefon invalid",
            humanDescription:
              "Verifică dacă apare o eroare pentru numărul de telefon invalid.",
            checkConfig: {
              jsSnippet:
                "(() => { const text = document.body.innerText.toLowerCase(); return text.includes('telefon') || text.includes('eroare'); })()",
              expectedResult: { type: "boolean", value: true },
            },
          },
          rationale: "Validează telefonul.",
        },
      ],
      insertions: [],
      removals: [],
    } as unknown as AiSimilarTestProposal;

    const normalized = normalizeAiSimilarTestAdaptiveChecks(
      sourceWithCheck,
      proposal,
      "Dacă introduc un telefon invalid să apară eroarea Telefon invalid.",
    );

    expect(normalized.changes[0]?.patch).toMatchObject({
      title: "Verifică mesajul pentru telefon invalid",
      checkType: "adaptive",
      checkConfig: {
        strategy: "auto",
        expectedTexts: ["Telefon invalid"],
        visualPrompt:
          "Verifică dacă apare o eroare pentru numărul de telefon invalid.",
        visualFallback: true,
        minimumConfidence: 0.6,
      },
    });
    const candidate = applyAiSimilarTestProposal(sourceWithCheck, normalized);
    expect(candidate.flowItems[0]).toMatchObject({
      checkType: "adaptive",
      config: {
        strategy: "auto",
        expectedTexts: ["Telefon invalid"],
        visualPrompt:
          "Verifică dacă apare o eroare pentru numărul de telefon invalid.",
        visualFallback: true,
        minimumConfidence: 0.6,
      },
    });
  });
});
