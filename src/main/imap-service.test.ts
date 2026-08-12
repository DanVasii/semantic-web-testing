import { describe, expect, it } from "vitest";

import { matchesImapFilters } from "./imap-service.js";

const message = {
  from: ["sender@example.test"],
  to: ["client@example.test"],
  subject: "Confirmare programare #42",
  text: "Bună, Ana. Îți mulțumim pentru programare.",
};

describe("matchesImapFilters", () => {
  it("applies sender, recipient, exact/partial subject and body filters", () => {
    expect(
      matchesImapFilters(message, {
        accountId: "imap-1",
        mailbox: "INBOX",
        receivedAfterTestStart: true,
        sender: "SENDER@example.test",
        recipient: "client@example.test",
        subjectContains: "PROGRAMARE",
        bodyContains: "mulțumim",
      }),
    ).toBe(true);
    expect(
      matchesImapFilters(message, {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        subjectEquals: "Confirmare programare #42",
      }),
    ).toBe(true);
  });

  it("rejects a message when any configured filter differs", () => {
    expect(
      matchesImapFilters(message, {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        recipient: "other@example.test",
      }),
    ).toBe(false);
    expect(
      matchesImapFilters(message, {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        subjectEquals: "Confirmare programare",
      }),
    ).toBe(false);
    expect(
      matchesImapFilters(message, {
        accountId: "imap-1",
        receivedAfterTestStart: true,
        bodyContains: "mesaj absent",
      }),
    ).toBe(false);
  });
});
