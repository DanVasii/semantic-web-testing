import { describe, expect, it } from "vitest";

import { AI_OUTPUT_SCHEMAS, validateAiOutput } from "./ai-output.js";

describe("create_step AI output", () => {
  it("publishes a strict schema and accepts one declarative text check", () => {
    expect(AI_OUTPUT_SCHEMAS.create_step).toMatchObject({
      type: "object",
      required: ["summary", "step"],
    });

    const output = {
      summary: "Așteaptă mesajul de succes.",
      step: {
        id: "step-check-success",
        type: "check",
        checkType: "text",
        title: "Confirmă salvarea",
        humanDescription: "Așteaptă mesajul de salvare.",
        config: {
          target: {
            type: "data_attribute",
            attribute: "data-testid",
            operator: "equals",
            value: "save-success",
          },
          operator: "contains",
          value: "Salvat",
          caseSensitive: false,
        },
        timeoutMs: 10_000,
        enabled: true,
      },
    };

    expect(validateAiOutput("create_step", output)).toEqual(output);
  });

  it("accepts a visual fallback check for a vague expected result", () => {
    const output = {
      summary: "Verifică vizual finalizarea formularului.",
      step: {
        id: "step-check-visual",
        type: "check",
        checkType: "visual",
        title: "Confirmă rezultatul",
        humanDescription: "Pagina trebuie să arate rezultatul corect.",
        config: {
          prompt:
            "Confirmă că formularul pare trimis cu succes și nu sunt afișate erori.",
          minimumConfidence: 0.6,
        },
        timeoutMs: 5_000,
        enabled: true,
      },
    };

    expect(validateAiOutput("create_step", output)).toEqual(output);
  });

  it("accepts a structured adaptive check", () => {
    const output = {
      summary: "Verifică validarea telefonului.",
      step: {
        id: "step-check-phone",
        type: "check",
        checkType: "adaptive",
        title: "Telefon invalid",
        humanDescription: "Trebuie să apară mesajul Telefon invalid.",
        config: {
          strategy: "auto",
          expectedTexts: ["Telefon invalid"],
          matchMode: "any",
          visualPrompt: "Confirmă vizual eroarea de telefon.",
          visualFallback: true,
          minimumConfidence: 0.6,
        },
        timeoutMs: 5_000,
        enabled: true,
      },
    };

    expect(validateAiOutput("create_step", output)).toEqual(output);
  });
});
