import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type {
  DeclarativeTestDefinition,
  LocatorFallback,
  TestDataset,
} from "./test-model.js";
import {
  assertValidDeclarativeTest,
  parseDeclarativeTestJson,
  parseTestDatasetJson,
  TestSchemaValidationError,
  validateDeclarativeTest,
  validateTestDataset,
} from "./test-validation.js";

const dataset = {
  id: "dataset-1",
  testId: "test-1",
  name: "Client standard",
  values: {
    customer_email: {
      type: "generated",
      strategy: "unique_email",
      template: "test+{{timestamp}}@example.test",
    },
    billing_first_name: { type: "fixed", value: "Andrei" },
    reference_id: { type: "generated", strategy: "uuid" },
    appointment_date: {
      type: "generated",
      strategy: "current_date_plus_days",
      days: 2,
      format: "yyyy-MM-dd",
    },
    appointment_time: {
      type: "generated",
      strategy: "random_choice",
      choices: ["09:00", "10:30", "12:00"],
    },
    order_note: {
      type: "generated",
      strategy: "template",
      template: "Test automat {{timestamp}}",
    },
  },
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
} satisfies TestDataset;

const repeatedFallback = {
  locator: {
    type: "relative",
    anchor: {
      type: "text",
      operator: "contains_all_keywords",
      value: ["Masaj", "Premium"],
    },
    relation: "inside",
    target: {
      type: "role",
      role: "button",
      operator: "contains",
      value: "Adaugă în coș",
    },
  },
  humanDescription: "Caută butonul relativ la titlul produsului.",
  whyExplanation: "Fallback semantic dacă structura cardului se schimbă.",
} satisfies LocatorFallback;

const validTest = {
  schemaVersion: 1,
  id: "test-1",
  projectId: "project-1",
  name: "Cumpără produsul potrivit",
  description: "Selectează semantic un produs și continuă la checkout.",
  status: "valid",
  version: 1,
  wipeBeforeRun: true,
  startMode: "base_url",
  startUrl: "https://example.test/products?category=massage#premium",
  createdAt: "2026-07-24T12:00:00.000Z",
  updatedAt: "2026-07-24T12:00:00.000Z",
  flowItems: [
    {
      id: "step-1",
      type: "action",
      actionType: "navigate",
      title: "Deschide produsele",
      humanDescription: "Deschide lista produselor.",
      whyExplanation: "Acesta este URL-ul de start al scenariului.",
      url: "https://example.test/products?category=massage#premium",
      fallbacks: [],
      enabled: true,
    },
    {
      id: "step-2",
      type: "action",
      actionType: "choose_repeated_item",
      title: "Alege produsul Premium",
      humanDescription:
        "Caută produsul care conține Masaj și Premium și apasă Adaugă în coș.",
      whyExplanation:
        "Produsul este ales după titlu, independent de ordinea cardurilor.",
      target: {
        fieldId: "add_to_cart_button",
        stability: 0.92,
        primary: {
          type: "repeated_component",
          container: {
            type: "css",
            operator: "equals",
            value: ".product-card",
          },
          filters: [
            {
              field: {
                type: "css",
                operator: "equals",
                value: ".product-title",
              },
              operator: "contains_all_keywords",
              value: ["Masaj", "Premium"],
            },
          ],
          targetInsideContainer: {
            type: "role",
            role: "button",
            operator: "contains",
            value: "Adaugă în coș",
          },
        },
      },
      fallbacks: [repeatedFallback],
      waitAfter: { type: "dom_stable", timeoutMs: 5000 },
      enabled: true,
    },
    {
      id: "step-3",
      type: "action",
      actionType: "fill",
      title: "Completează emailul",
      humanDescription: "Completează emailul clientului din dataset.",
      whyExplanation: "Câmpul are un fieldId stabil.",
      target: {
        fieldId: "customer_email",
        primary: {
          type: "label",
          operator: "equals",
          value: "Email client",
        },
      },
      inputFieldId: "customer_email",
      valueKey: "customer_email",
      valueStrategy: "dataset",
      fallbacks: [],
      enabled: true,
    },
    {
      id: "check-1",
      type: "check",
      checkType: "text",
      title: "Verifică produsul din coș",
      humanDescription: "Titlul produsului trebuie să apară în coș.",
      config: {
        target: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "cart-product-title",
        },
        operator: "contains_all_keywords",
        value: ["Masaj", "Premium"],
      },
      enabled: true,
    },
    {
      id: "breakpoint-1",
      type: "breakpoint",
      title: "Verificare înainte de plată",
      instructions: "Confirmă manual totalul comenzii.",
      enabled: true,
    },
    {
      id: "manual-1",
      type: "manual_intervention",
      title: "Finalizează 3D Secure",
      instructions: "Finalizează confirmarea în browser și apasă Ctrl+Enter.",
      humanDescription: "Confirmă manual plata.",
      whyExplanation: "3D Secure necesită intervenția utilizatorului.",
      completionShortcut: "Ctrl+Enter",
      enabled: true,
    },
  ],
  datasets: [dataset],
} satisfies DeclarativeTestDefinition;

const issueCodes = (value: unknown) => {
  const result = validateDeclarativeTest(value);
  return result.valid ? [] : result.issues.map(({ code }) => code);
};

describe("test JSON schemas", () => {
  it("ships strict draft 2020-12 schemas for tests and datasets", () => {
    const testSchema = JSON.parse(
      readFileSync(
        new URL("../../schemas/test.schema.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;
    const datasetSchema = JSON.parse(
      readFileSync(
        new URL("../../schemas/dataset.schema.json", import.meta.url),
        "utf8",
      ),
    ) as Record<string, unknown>;

    expect(testSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(testSchema.additionalProperties).toBe(false);
    expect(datasetSchema.$schema).toBe(
      "https://json-schema.org/draft/2020-12/schema",
    );
    expect(datasetSchema.additionalProperties).toBe(false);
  });
});

describe("valid runtime test schema", () => {
  it("accepts a visual check with prompt and confidence threshold", () => {
    const result = validateDeclarativeTest({
      ...validTest,
      flowItems: [
        {
          id: "check-visual",
          type: "check",
          checkType: "visual",
          title: "Confirmă vizual",
          humanDescription: "Pagina afișează rezultatul așteptat.",
          config: {
            prompt: "Confirmă că pagina afișează o comandă finalizată.",
            minimumConfidence: 0.65,
          },
          timeoutMs: 5_000,
          enabled: true,
        },
      ],
    });

    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it("accepts an adaptive DOM check with visual fallback", () => {
    const result = validateDeclarativeTest({
      ...validTest,
      flowItems: [
        {
          id: "check-adaptive",
          type: "check",
          checkType: "adaptive",
          title: "Confirmă telefonul invalid",
          humanDescription: "Trebuie să apară Telefon invalid.",
          config: {
            strategy: "auto",
            expectedTexts: ["Telefon invalid"],
            matchMode: "any",
            caseSensitive: false,
            ignoreDiacritics: true,
            visualPrompt: "Confirmă vizual avertizarea.",
            visualFallback: true,
            minimumConfidence: 0.6,
          },
          timeoutMs: 5_000,
          enabled: true,
        },
      ],
    });

    expect(result).toMatchObject({ valid: true, issues: [] });
  });

  it("accepts all MVP flow item and locator variants", () => {
    expect(validateDeclarativeTest(validTest)).toEqual({
      valid: true,
      data: validTest,
      issues: [],
    });
    expect(assertValidDeclarativeTest(validTest)).toBe(validTest);
  });

  it("accepts an HTTP origin as recorded frame context", () => {
    const framed: DeclarativeTestDefinition = structuredClone(validTest);
    const fill = framed.flowItems.find((item) => item.id === "step-3");
    if (fill?.type !== "action" || fill.target === undefined) {
      throw new Error("Pasul fill fixture lipsește.");
    }
    fill.target.frame = { origin: "https://js.stripe.com" };

    expect(validateDeclarativeTest(framed).valid).toBe(true);
  });

  it("accepts fixed, generated and primitive dataset values", () => {
    expect(validateTestDataset(dataset).valid).toBe(true);
    expect(
      validateTestDataset({
        ...dataset,
        values: {
          text_value: "text",
          number_value: 42,
          boolean_value: true,
          null_value: null,
          timestamp_value: { type: "generated", strategy: "timestamp" },
          random_value: {
            type: "generated",
            strategy: "random_number",
            min: 1,
            max: 10,
          },
          current_date: {
            type: "generated",
            strategy: "current_date",
          },
          previous_date: {
            type: "generated",
            strategy: "current_date_minus_days",
            days: 1,
          },
        },
      }).valid,
    ).toBe(true);
  });

  it("parses valid test and dataset JSON", () => {
    expect(parseDeclarativeTestJson(JSON.stringify(validTest)).valid).toBe(
      true,
    );
    expect(parseTestDatasetJson(JSON.stringify(dataset)).valid).toBe(true);
  });
});

describe("invalid runtime test schema", () => {
  it("rejects invalid JSON and duplicate flow IDs", () => {
    expect(parseDeclarativeTestJson("{invalid").issues[0]?.code).toBe(
      "invalid_json",
    );
    expect(
      issueCodes({
        ...validTest,
        flowItems: [
          validTest.flowItems[0],
          { ...validTest.flowItems[0], title: "Duplicat" },
        ],
      }),
    ).toContain("duplicate_id");
  });

  it("rejects unknown, dangerous and executable properties", () => {
    expect(issueCodes({ ...validTest, unexpected: true })).toContain(
      "unknown_property",
    );

    const dangerous = JSON.parse(
      `{"schemaVersion":1,"__proto__":{"polluted":true}}`,
    ) as unknown;
    expect(issueCodes(dangerous)).toContain("unsafe_property");

    expect(
      issueCodes({
        ...validTest,
        flowItems: [
          {
            ...validTest.flowItems[0],
            script: "await page.click('#buy')",
          },
        ],
      }),
    ).toContain("forbidden_code_field");
    expect(() =>
      assertValidDeclarativeTest({
        ...validTest,
        evaluate: "() => document.cookie",
      }),
    ).toThrow(TestSchemaValidationError);
  });

  it("rejects invalid locators, action requirements and unsafe URLs", () => {
    const invalid = {
      ...validTest,
      startUrl: "javascript:alert(1)",
      flowItems: [
        {
          ...validTest.flowItems[2],
          target: {
            primary: {
              type: "data_attribute",
              operator: "equals",
              value: "email",
              attribute: "onclick",
            },
          },
          valueKey: undefined,
          fallbacks: [
            repeatedFallback,
            repeatedFallback,
            repeatedFallback,
            repeatedFallback,
          ],
        },
      ],
    };

    const result = validateDeclarativeTest(invalid);
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "$.startUrl",
          "$.flowItems[0].target.primary.attribute",
          "$.flowItems[0].fallbacks",
          "$.flowItems[0].valueKey",
        ]),
      );
    }
  });

  it("accepts complete URL variables and URL templates on actions", () => {
    const templated = {
      ...validTest,
      flowItems: [
        {
          ...structuredClone(validTest.flowItems[0]),
          url: "{{payment_url}}",
        },
        {
          ...structuredClone(validTest.flowItems[0]),
          id: "step-template-url",
          url: "{{baseUrl}}/orders/{{order_id}}",
        },
      ],
    };

    const result = validateDeclarativeTest(templated);
    expect(result.valid, JSON.stringify(result)).toBe(true);
  });

  it("requires a bounded region and instruction for visual AI actions", () => {
    const visualAction = {
      id: "visual-calendar",
      type: "action" as const,
      actionType: "visual_ai" as const,
      title: "Alege data",
      humanDescription: "Alege vizual o dată disponibilă.",
      whyExplanation: "Calendarul se schimbă în funcție de luna curentă.",
      visualInstruction:
        "Navighează în calendar și selectează prima dată disponibilă.",
      visualRegion: {
        x: 0.1,
        y: 0.2,
        width: 0.7,
        height: 0.6,
        viewportWidth: 1280,
        viewportHeight: 720,
        referenceImageBase64: "aW1hZ2U=",
      },
      fallbacks: [],
      enabled: true,
    };

    expect(
      validateDeclarativeTest({ ...validTest, flowItems: [visualAction] })
        .valid,
    ).toBe(true);
    const { visualRegion: _visualRegion, ...visualActionWithoutRegion } =
      visualAction;
    expect(_visualRegion).toBeDefined();
    expect(
      validateDeclarativeTest({
        ...validTest,
        flowItems: [visualActionWithoutRegion],
      }).valid,
    ).toBe(true);
    const invalid = validateDeclarativeTest({
      ...validTest,
      flowItems: [
        {
          ...visualAction,
          visualInstruction: "",
          visualRegion: { ...visualAction.visualRegion, width: 1.2 },
        },
      ],
    });
    expect(invalid.valid).toBe(false);
    if (!invalid.valid) {
      expect(invalid.issues.map(({ path }) => path)).toEqual(
        expect.arrayContaining([
          "$.flowItems[0].visualInstruction",
          "$.flowItems[0].visualRegion.width",
        ]),
      );
    }
  });

  it("rejects mismatched datasets and unsupported generated strategies", () => {
    const result = validateDeclarativeTest({
      ...validTest,
      datasets: [
        {
          ...dataset,
          testId: "another-test",
          values: {
            InvalidField: {
              type: "generated",
              strategy: "javascript",
              code: "return Date.now()",
            },
          },
        },
      ],
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid_value",
          "invalid_format",
          "forbidden_code_field",
        ]),
      );
    }
  });

  it("rejects direct functions and incompatible check configs", () => {
    const result = validateDeclarativeTest({
      ...validTest,
      flowItems: [
        {
          id: "check-unsafe",
          type: "check",
          checkType: "imap",
          title: "Email",
          humanDescription: "Așteaptă emailul.",
          config: {
            accountId: "account-1",
            receivedAfterTestStart: false,
            rawSql: "DELETE FROM users",
          },
          enabled: true,
        },
      ],
      runtimeFunction: () => true,
    });

    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.issues.map(({ code }) => code)).toEqual(
        expect.arrayContaining([
          "invalid_type",
          "unknown_property",
          "invalid_value",
        ]),
      );
    }
  });
});
