import { describe, expect, it } from "vitest";

import type { TestStage } from "./test-stages.js";
import { validateTestStageDependencies } from "./test-stages.js";

const mysqlCheck = (name: string) => ({
  id: `check-${name}`,
  type: "check" as const,
  checkType: "mysql" as const,
  title: "DB",
  humanDescription: "DB",
  enabled: true,
  required: true,
  config: {
    tableNames: ["orders"],
    identities: [{ tableName: "orders", columns: ["id"] }],
  },
  extractors: [
    {
      id: `extract-${name}`,
      source: "mysql" as const,
      tableName: "orders",
      rowSource: "inserted" as const,
      filters: [],
      column: "id",
      cardinality: "exactly_one" as const,
      output: {
        name,
        type: "number" as const,
        required: true,
        overwritePolicy: "deny" as const,
      },
    },
  ],
});

describe("multi-flow dependency validation", () => {
  it("allows a previous stage output in a later URL template", () => {
    const stages: TestStage[] = [
      {
        id: "create",
        name: "Create",
        enabled: true,
        entry: { type: "test_start" },
        flowItems: [],
        postChecks: [mysqlCheck("orderId")],
      },
      {
        id: "details",
        name: "Details",
        enabled: true,
        entry: {
          type: "url_template",
          template: "{{baseUrl}}/order/{{orderId}}",
        },
        flowItems: [],
        postChecks: [],
      },
    ];
    expect(validateTestStageDependencies(stages)).toEqual([]);
  });

  it("rejects a variable consumed before its producer", () => {
    const stages: TestStage[] = [
      {
        id: "details",
        name: "Details",
        enabled: true,
        entry: {
          type: "url_template",
          template: "{{baseUrl}}/order/{{orderId}}",
        },
        flowItems: [],
        postChecks: [],
      },
      {
        id: "create",
        name: "Create",
        enabled: true,
        entry: { type: "continue_current_page" },
        flowItems: [],
        postChecks: [mysqlCheck("orderId")],
      },
    ];
    expect(validateTestStageDependencies(stages)[0]).toMatchObject({
      code: "variable_used_before_produced",
    });
  });
});
