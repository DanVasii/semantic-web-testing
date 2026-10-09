import type { Locator, Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import type { ActionStep } from "../../shared/test-model.js";
import { inspectMissingInput, readManualInputValue } from "./missing-data.js";

const step: ActionStep = {
  id: "fill-contact",
  type: "action",
  actionType: "fill",
  title: "Completează contactul",
  humanDescription: "Completează câmpul.",
  whyExplanation: "Date necesare.",
  inputFieldId: "customer_contact",
  valueKey: "customer_contact",
  valueStrategy: "dataset",
  target: {
    fieldId: "customer_contact",
    primary: {
      type: "css",
      operator: "equals",
      value: "#contact",
    },
  },
  fallbacks: [],
  enabled: true,
};

const harness = (
  tagName: string,
  type: string | null,
  options: { checked?: boolean; value?: string } = {},
) => {
  const locator = {
    count: vi.fn().mockResolvedValue(1),
    evaluate: vi.fn().mockResolvedValue({ tagName, type }),
    isChecked: vi.fn().mockResolvedValue(options.checked ?? false),
    inputValue: vi.fn().mockResolvedValue(options.value ?? "manual"),
  } as unknown as Locator;
  const page = {
    locator: vi.fn().mockReturnValue(locator),
  } as unknown as Page;
  return { locator, page };
};

describe("missing input runtime", () => {
  it.each([
    ["input", "text", "text"],
    ["input", "password", "password"],
    ["input", "checkbox", "checkbox"],
    ["select", null, "select"],
    ["input", "radio", "radio"],
    ["input", "file", "file"],
  ] as const)("detects %s/%s as %s", async (tagName, type, expected) => {
    const { page } = harness(tagName, type);
    await expect(inspectMissingInput(page, step)).resolves.toMatchObject({
      fieldId: "customer_contact",
      valueKey: "customer_contact",
      inputKind: expected,
      locator: step.target?.primary,
    });
  });

  it("reads text, password and select values", async () => {
    for (const inputKind of ["text", "password", "select"] as const) {
      const { page } = harness(
        inputKind === "select" ? "select" : "input",
        inputKind,
        { value: "secret-value" },
      );
      await expect(
        readManualInputValue(page, {
          fieldId: "field",
          valueKey: "field",
          inputKind,
          locator: step.target!.primary,
        }),
      ).resolves.toBe("secret-value");
    }
  });

  it("reads checkbox state and the selected radio value", async () => {
    const checkbox = harness("input", "checkbox", { checked: true });
    await expect(
      readManualInputValue(checkbox.page, {
        fieldId: "newsletter",
        valueKey: "newsletter",
        inputKind: "checkbox",
        locator: step.target!.primary,
      }),
    ).resolves.toBe(true);

    const radio = harness("input", "radio", {
      checked: true,
      value: "premium",
    });
    await expect(
      readManualInputValue(radio.page, {
        fieldId: "plan",
        valueKey: "plan",
        inputKind: "radio",
        locator: step.target!.primary,
      }),
    ).resolves.toBe("premium");
  });

  it("keeps waiting when the radio option is not selected", async () => {
    const { page } = harness("input", "radio", { checked: false });
    await expect(
      readManualInputValue(page, {
        fieldId: "plan",
        valueKey: "plan",
        inputKind: "radio",
        locator: step.target!.primary,
      }),
    ).rejects.toThrow("Selectează o opțiune radio");
  });

  it("accepts a file selected manually and rejects an empty file input", async () => {
    const selectedLocator = {
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue("document.pdf"),
    } as unknown as Locator;
    const emptyLocator = {
      count: vi.fn().mockResolvedValue(1),
      evaluate: vi.fn().mockResolvedValue(""),
    } as unknown as Locator;
    const details = {
      fieldId: "document",
      valueKey: "document",
      inputKind: "file" as const,
      locator: step.target!.primary,
    };

    await expect(
      readManualInputValue(
        {
          locator: vi.fn().mockReturnValue(selectedLocator),
        } as unknown as Page,
        details,
      ),
    ).resolves.toBe("document.pdf");
    await expect(
      readManualInputValue(
        { locator: vi.fn().mockReturnValue(emptyLocator) } as unknown as Page,
        details,
      ),
    ).rejects.toThrow("Selectează un fișier");
  });
});
