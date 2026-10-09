import { describe, expect, it } from "vitest";

import type { AiSettingsSummary } from "../../shared/ai.js";
import { createAiRequestPreview } from "./ai-prompts.js";

const settings: AiSettingsSummary = {
  provider: "gemini",
  ollama: { baseUrl: "", model: "" },
  lmStudio: { baseUrl: "", model: "" },
  gemini: { model: "gemini-flash", apiKeyConfigured: true },
  openai: { model: "", apiKeyConfigured: false },
};

describe("Google Pay AI prompt", () => {
  it("keeps every scenario code without the generic context limit", () => {
    const scenarioCodes = Array.from(
      { length: 150 },
      (_, index) => `special_scenario_${index}`,
    );

    const preview = createAiRequestPreview(settings, {
      task: "select_google_pay_card",
      context: {
        userDescription: "Testează scenariul special 149.",
        scenarioCodes,
      },
    });

    expect(preview.contextPreview).toEqual({
      userDescription: "Testează scenariul special 149.",
      scenarioCodes,
    });
    expect(preview.omittedPaths).toEqual([]);
  });
});
