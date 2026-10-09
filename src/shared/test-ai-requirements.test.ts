import { describe, expect, it } from "vitest";

import type { TestDefinition } from "./persistence.js";
import { testFlowRequiresAi } from "./test-ai-requirements.js";

const testWithCheck = (
  check: TestDefinition["flowItems"][number],
): TestDefinition => ({
  id: "test-1",
  projectId: "project-1",
  name: "Formular",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/form",
  normalizedStartUrl: "https://example.test/form",
  workflowState: "ready",
  createdAt: "2026-09-03T10:00:00.000Z",
  updatedAt: "2026-09-03T10:00:00.000Z",
  flowItems: [check],
});

describe("testFlowRequiresAi", () => {
  it("detects visual and adaptive visual checks", () => {
    expect(
      testFlowRequiresAi(
        testWithCheck({
          id: "visual",
          type: "check",
          checkType: "visual",
          title: "Confirmă vizual",
          humanDescription: "Confirmă mesajul.",
          config: { prompt: "Confirmă mesajul." },
          enabled: true,
        }),
      ),
    ).toBe(true);
    expect(
      testFlowRequiresAi(
        testWithCheck({
          id: "adaptive",
          type: "check",
          checkType: "adaptive",
          title: "Confirmă adaptiv",
          humanDescription: "Confirmă mesajul.",
          config: {
            strategy: "auto",
            expectedTexts: [],
            matchMode: "any",
            visualFallback: false,
          },
          enabled: true,
        }),
      ),
    ).toBe(true);
  });

  it("detects visual fallback even when the primary strategy is DOM", () => {
    expect(
      testFlowRequiresAi(
        testWithCheck({
          id: "adaptive-dom",
          type: "check",
          checkType: "adaptive",
          title: "Confirmă în DOM",
          humanDescription: "Caută mesajul și folosește fallback vizual.",
          config: {
            strategy: "dom",
            expectedTexts: ["Telefon invalid"],
            matchMode: "any",
            visualFallback: true,
          },
          enabled: true,
        }),
      ),
    ).toBe(true);
  });

  it("does not require AI for a strict DOM check without fallback", () => {
    expect(
      testFlowRequiresAi(
        testWithCheck({
          id: "adaptive-dom-only",
          type: "check",
          checkType: "adaptive",
          title: "Confirmă în DOM",
          humanDescription: "Caută mesajul numai în DOM.",
          config: {
            strategy: "dom",
            expectedTexts: ["Telefon invalid"],
            matchMode: "any",
            visualFallback: false,
          },
          enabled: true,
        }),
      ),
    ).toBe(false);
  });

  it("requires AI when a Google Pay card scenario is configured", () => {
    expect(
      testFlowRequiresAi(
        testWithCheck({
          id: "google-pay",
          type: "action",
          actionType: "click",
          title: "Apasă Google Pay",
          humanDescription: "Deschide payment sheet-ul.",
          whyExplanation: "Testează plata.",
          target: {
            primary: {
              type: "role",
              role: "button",
              operator: "equals",
              value: "Google Pay",
            },
          },
          googlePayCardDescription:
            "Alege cardul Visa pentru scenariul Incorrect CVC.",
          fallbacks: [],
          enabled: true,
        }),
      ),
    ).toBe(true);
  });
});
