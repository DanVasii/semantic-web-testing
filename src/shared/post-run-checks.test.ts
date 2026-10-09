import { describe, expect, it } from "vitest";

import {
  normalizeTestPostRunChecks,
  validateTestPostRunChecks,
  type TestPostRunChecks,
} from "./post-run-checks.js";

describe("post-run IMAP checks", () => {
  it("migrates the legacy shared filters to one independent check per account", () => {
    const legacy = {
      aiPrompt: "",
      mysql: { enabled: false, tableNames: [], identities: [] },
      imap: {
        enabled: true,
        accountIds: ["imap-1", "imap-2"],
        mailbox: "INBOX",
        sender: "sender@example.test",
        recipient: "",
        subjectEquals: "",
        subjectContains: "Confirmare",
        bodyContains: "",
      },
    } as unknown as TestPostRunChecks;

    expect(normalizeTestPostRunChecks(legacy).imap.inboxes).toMatchObject([
      {
        accountId: "imap-1",
        sender: "sender@example.test",
        subjectContains: "Confirmare",
      },
      {
        accountId: "imap-2",
        sender: "sender@example.test",
        subjectContains: "Confirmare",
      },
    ]);
  });

  it("preserves distinct filters for each configured inbox", () => {
    const value = normalizeTestPostRunChecks(undefined);
    value.imap.enabled = true;
    value.imap.inboxes = [
      {
        id: "confirmation",
        accountId: "imap-1",
        mailbox: "INBOX",
        sender: "confirm@example.test",
        recipient: "",
        subjectEquals: "",
        subjectContains: "Confirmare",
        bodyContains: "",
      },
      {
        id: "invoice",
        accountId: "imap-2",
        mailbox: "Billing",
        sender: "invoice@example.test",
        recipient: "",
        subjectEquals: "Factura",
        subjectContains: "",
        bodyContains: "Total",
      },
    ];

    expect(validateTestPostRunChecks(value).imap.inboxes).toEqual(
      value.imap.inboxes,
    );
  });
});
