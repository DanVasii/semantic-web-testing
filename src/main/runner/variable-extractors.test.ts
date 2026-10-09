import { describe, expect, it } from "vitest";

import type { ImapMatchedMessage } from "../../shared/imap.js";
import type { MySqlRunDiff } from "../../shared/mysql.js";
import type {
  ImapVariableExtractor,
  MysqlVariableExtractor,
} from "../../shared/test-stages.js";
import { extractImapVariables } from "./imap-variable-extractor.js";
import { extractMysqlVariables } from "./mysql-variable-extractor.js";
import { SessionVariableContext } from "./session-variable-context.js";

const clock = () => new Date("2026-09-17T10:00:00.000Z");

const diff: MySqlRunDiff = {
  id: "diff-1",
  runId: "run-1",
  checkStepId: "db-check",
  baselineSnapshotId: "before",
  currentSnapshotId: "after",
  createdAt: clock().toISOString(),
  tables: [
    {
      tableName: "orders",
      columns: ["id", "customer_email"],
      identityColumns: ["id"],
      inserted: [
        {
          identity: { id: 17 },
          row: { id: 17, customer_email: "buyer@example.test" },
        },
      ],
      deleted: [],
      updated: [],
      duplicateIdentities: [],
    },
  ],
};

describe("runtime variable extractors", () => {
  it("extracts a DB column from exactly one filtered inserted row", () => {
    const variables = new SessionVariableContext(clock);
    variables.seed("customerEmail", "buyer@example.test", "string", "dataset");
    const extractor: MysqlVariableExtractor = {
      id: "order-id",
      source: "mysql",
      tableName: "orders",
      rowSource: "inserted",
      filters: [
        {
          column: "customer_email",
          operator: "equals",
          valueTemplate: "{{customerEmail}}",
        },
      ],
      column: "id",
      cardinality: "exactly_one",
      output: {
        name: "orderId",
        type: "number",
        required: true,
        overwritePolicy: "deny",
      },
    };
    const publications = extractMysqlVariables(
      [extractor],
      diff,
      variables,
      "stage-1",
      "db-check",
    );
    expect(publications[0]).toMatchObject({ value: 17, source: "mysql" });
  });

  it("extracts a payment link by anchor text", () => {
    const message: ImapMatchedMessage = {
      accountId: "mail",
      accountName: "Shop",
      mailbox: "INBOX",
      uid: 10,
      receivedAt: clock().toISOString(),
      subject: "Plătește comanda",
      from: ["shop@example.test"],
      to: ["buyer@example.test"],
      text: "Plătește acum",
      html: '<a href="https://shop.test/pay/token-1"><strong>Plătește</strong> acum</a>',
    };
    const extractor: ImapVariableExtractor = {
      id: "payment-link",
      source: "imap",
      field: "link_by_text",
      selector: {
        operator: "equals",
        value: "Plătește acum",
        caseSensitive: false,
      },
      cardinality: "exactly_one",
      output: {
        name: "paymentLink",
        type: "url",
        required: true,
        overwritePolicy: "deny",
      },
    };
    expect(
      extractImapVariables([extractor], [message], "stage-1", "mail-check")[0],
    ).toMatchObject({
      value: "https://shop.test/pay/token-1",
      source: "imap",
    });
  });
});
