import { describe, expect, it } from "vitest";

import type { AnalyzedForm } from "../../shared/form-analysis.js";
import { validateDeclarativeTest } from "../../shared/test-validation.js";
import {
  buildFormTestScenario,
  normalizeFormTestProposal,
} from "./form-test-generation-service.js";
import { validateAiOutput } from "./ai-output.js";

const form: AnalyzedForm = {
  id: "form-contact",
  pageId: "page-1",
  pageVersionId: "page-version-1",
  pageTitle: "Contact",
  pageUrl: "https://example.test/contact",
  title: "Contact",
  method: "post",
  action: "https://example.test/contact",
  locator: { type: "css", operator: "equals", value: "#contact" },
  fields: [
    {
      id: "field-name",
      name: "name",
      label: "Nume",
      tag: "input",
      inputType: "text",
      semanticType: "full_name",
      required: true,
      disabled: false,
      locator: { type: "css", operator: "equals", value: "#name" },
      options: [],
    },
    {
      id: "field-email",
      name: "email",
      label: "E-mail",
      tag: "input",
      inputType: "email",
      semanticType: "email",
      required: true,
      disabled: false,
      locator: { type: "css", operator: "equals", value: "#email" },
      options: [],
    },
  ],
  submit: {
    label: "Trimite",
    locator: { type: "css", operator: "equals", value: "#submit" },
  },
};

describe("form test generation", () => {
  it("validates the dedicated AI form scenario output", () => {
    const output = {
      summary: "Scenarii formular",
      scenarios: [
        {
          id: "valid",
          name: "Date valide",
          description: "Completează și trimite formularul.",
          kind: "valid",
          values: [{ fieldId: "field-name", value: "Andrei Test 81ab" }],
          omittedFieldIds: [],
          invalidFieldIds: [],
          expectedMessages: [],
        },
      ],
    };

    expect(validateAiOutput("generate_form_tests", output)).toEqual(output);
  });

  it("drops every AI-generated email and assigns IMAP only to valid scenarios", () => {
    const result = normalizeFormTestProposal(
      {
        summary: "Scenarii contact",
        scenarios: [
          {
            id: "valid",
            name: "Contact valid",
            description: "Trimite date valide.",
            kind: "valid",
            values: [
              { fieldId: "field-name", value: "Andrei Test 8f31" },
              { fieldId: "field-email", value: "inventat@ai.test" },
            ],
            omittedFieldIds: [],
            invalidFieldIds: [],
            expectedMessages: ["Mulțumim"],
          },
          {
            id: "missing-email",
            name: "E-mail lipsă",
            description: "Verifică validarea.",
            kind: "negative",
            values: [],
            omittedFieldIds: ["field-email"],
            invalidFieldIds: [],
            expectedMessages: ["E-mail obligatoriu"],
          },
        ],
      },
      form,
      true,
    );

    expect(result.scenarios[0]).toMatchObject({ expectEmail: true });
    expect(result.scenarios[0]?.values).toEqual([
      { fieldId: "field-name", value: "Andrei Test 8f31" },
    ]);
    expect(result.scenarios[1]).toMatchObject({ expectEmail: false });
  });

  it("injects the selected IMAP address and creates the automatic inbox check", () => {
    const proposal = normalizeFormTestProposal(
      {
        summary: "Scenariu valid",
        scenarios: [
          {
            id: "valid",
            name: "Contact valid",
            description: "Trimite formularul.",
            kind: "valid",
            values: [{ fieldId: "field-name", value: "Ana Test 91ab" }],
            omittedFieldIds: [],
            invalidFieldIds: [],
            expectedMessages: ["Mulțumim"],
          },
        ],
      },
      form,
      true,
    ).scenarios[0]!;

    const built = buildFormTestScenario(form, proposal, {}, "qa@example.test", {
      id: "imap-1",
      mailbox: "INBOX",
    });

    expect(built.dataset).toEqual({
      form_field_1: "Ana Test 91ab",
      form_field_2: "qa@example.test",
    });
    expect(JSON.stringify(built.dataset)).not.toContain("inventat");
    expect(built.postRunChecks.imap).toMatchObject({
      enabled: true,
      recipient: "qa@example.test",
      accountIds: ["imap-1"],
      inboxes: [
        expect.objectContaining({
          accountId: "imap-1",
          recipient: "qa@example.test",
        }),
      ],
    });
    for (const item of built.flowItems) {
      if (item.type === "action" && item.target !== undefined) {
        expect(item.target).not.toHaveProperty("fieldId");
      }
    }
    expect(
      validateDeclarativeTest({
        schemaVersion: 1,
        id: "test-1",
        projectId: "project-1",
        name: "Contact valid",
        status: "valid",
        version: 1,
        wipeBeforeRun: false,
        startMode: "base_url",
        startUrl: form.pageUrl,
        createdAt: "2026-09-03T08:00:00.000Z",
        updatedAt: "2026-09-03T08:00:00.000Z",
        flowItems: built.flowItems,
        datasets: [
          {
            id: "dataset-1",
            testId: "test-1",
            name: "Date formular",
            values: built.dataset,
            createdAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T08:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ valid: true, issues: [] });
  });

  it("always adds a result check, using visual validation when exact messages are unknown", () => {
    const proposal = normalizeFormTestProposal(
      {
        summary: "Validare required",
        scenarios: [
          {
            id: "missing-name",
            name: "Nume lipsă",
            description: "Nu completează numele obligatoriu.",
            kind: "negative",
            values: [],
            omittedFieldIds: ["field-name"],
            invalidFieldIds: [],
            expectedMessages: [],
          },
        ],
      },
      form,
      true,
    ).scenarios[0]!;

    const built = buildFormTestScenario(form, proposal, {}, "qa@example.test", {
      id: "imap-1",
      mailbox: "INBOX",
    });
    const resultCheck = built.flowItems.at(-1);

    expect(resultCheck).toMatchObject({
      type: "check",
      checkType: "adaptive",
      config: {
        expectedTexts: [],
        visualFallback: true,
        minimumConfidence: 0.6,
      },
    });
  });

  it("maps file inputs to upload actions without accepting AI-generated paths", () => {
    const formWithFile: AnalyzedForm = {
      ...form,
      fields: [
        ...form.fields,
        {
          id: "field-document",
          name: "document",
          label: "Document justificativ",
          tag: "input",
          inputType: "file",
          semanticType: "unknown",
          required: true,
          disabled: false,
          locator: { type: "css", operator: "equals", value: "#document" },
          accept: ".pdf,image/png",
          options: [],
        },
      ],
    };
    const proposal = normalizeFormTestProposal(
      {
        summary: "Scenariu cu document",
        scenarios: [
          {
            id: "valid-file",
            name: "Document valid",
            description: "Trimite formularul cu document.",
            kind: "valid",
            values: [
              {
                fieldId: "field-document",
                value: "C:\\inventat\\document.pdf",
              },
            ],
            omittedFieldIds: [],
            invalidFieldIds: ["field-document"],
            expectedMessages: [],
          },
        ],
      },
      formWithFile,
      false,
    ).scenarios[0]!;
    const built = buildFormTestScenario(
      formWithFile,
      proposal,
      {},
      "qa@example.test",
      { id: "imap-1", mailbox: "INBOX" },
      () => ({
        type: "file",
        path: "C:\\managed\\default-document.pdf",
        name: "default-document.pdf",
      }),
    );

    expect(proposal.values).not.toContainEqual(
      expect.objectContaining({ fieldId: "field-document" }),
    );
    expect(proposal.invalidFieldIds).not.toContain("field-document");
    expect(built.flowItems).toContainEqual(
      expect.objectContaining({
        type: "action",
        actionType: "upload_file",
        inputFieldId: "form_field_3",
        valueKey: "form_field_3",
      }),
    );
    expect(built.dataset).toHaveProperty("form_field_3", {
      type: "file",
      path: "C:\\managed\\default-document.pdf",
      name: "default-document.pdf",
    });
    expect(
      validateDeclarativeTest({
        schemaVersion: 1,
        id: "test-file",
        projectId: "project-1",
        name: "Upload document",
        status: "valid",
        version: 1,
        wipeBeforeRun: false,
        startMode: "base_url",
        startUrl: formWithFile.pageUrl,
        createdAt: "2026-09-03T08:00:00.000Z",
        updatedAt: "2026-09-03T08:00:00.000Z",
        flowItems: built.flowItems,
        datasets: [
          {
            id: "dataset-file",
            testId: "test-file",
            name: "Date formular",
            values: built.dataset,
            createdAt: "2026-09-03T08:00:00.000Z",
            updatedAt: "2026-09-03T08:00:00.000Z",
          },
        ],
      }),
    ).toMatchObject({ valid: true, issues: [] });
  });
});
