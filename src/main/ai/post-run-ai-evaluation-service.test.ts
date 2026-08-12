import { describe, expect, it, vi } from "vitest";

import type { CreateAiRequestPreviewInput } from "../../shared/ai.js";
import type { AiSettingsService } from "./ai-settings-service.js";
import {
  compactPostRunEvidence,
  PostRunAiEvaluationService,
} from "./post-run-ai-evaluation-service.js";

const mysqlEvidence = {
  baselineSnapshotId: "baseline-1",
  diffs: [
    {
      id: "diff-1",
      checkStepId: "mysql-1",
      tables: [
        {
          tableName: "appointments",
          columns: ["id", "customer_id", "appointment_date"],
          identityColumns: ["id"],
          inserted: [
            {
              identity: { id: 11 },
              row: {
                id: 11,
                customer_id: 4,
                appointment_date: "2027-08-15",
              },
            },
          ],
          updated: [],
          deleted: [],
          duplicateIdentities: [],
        },
        {
          tableName: "appointment_events",
          columns: ["appointment_id", "event_type"],
          identityColumns: ["appointment_id"],
          inserted: [
            {
              identity: { appointment_id: 11 },
              row: { appointment_id: 11, event_type: "created" },
            },
          ],
          updated: [],
          deleted: [],
          duplicateIdentities: [],
        },
      ],
    },
  ],
  cleanupLogs: [],
};

describe("PostRunAiEvaluationService", () => {
  it("flattens MySQL diffs while preserving inserted row values", () => {
    const compact = compactPostRunEvidence({ mysql: mysqlEvidence });

    expect(compact.mysql).toEqual({
      baselineSnapshotId: "baseline-1",
      tables: [
        expect.objectContaining({
          diffId: "diff-1",
          tableName: "appointments",
          inserted: [
            {
              identity: { id: 11 },
              row: {
                id: 11,
                customer_id: 4,
                appointment_date: "2027-08-15",
              },
            },
          ],
        }),
        expect.objectContaining({
          tableName: "appointment_events",
          inserted: [
            {
              identity: { appointment_id: 11 },
              row: { appointment_id: 11, event_type: "created" },
            },
          ],
        }),
      ],
    });
    expect(JSON.stringify(compact)).not.toContain("adâncime maximă");
  });

  it("sends the compact evidence and the customer upsert rule to AI", async () => {
    let capturedRequest: CreateAiRequestPreviewInput | undefined;
    const generate = vi.fn((request: CreateAiRequestPreviewInput) => {
      capturedRequest = request;
      return Promise.resolve({
        output: {
          status: "passed",
          summary: "Programarea și evenimentul au fost găsite.",
          findings: [],
        },
        provider: "gemini" as const,
        model: "gemini-test",
        usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
      });
    });
    const service = new PostRunAiEvaluationService(
      { generate } as unknown as AiSettingsService,
      () => new Date("2026-07-27T10:10:00.000Z"),
    );

    await service.evaluate({
      projectId: "project-1",
      testId: "test-1",
      runId: "run-1",
      prompt: "Verifică programarea și evenimentul.",
      dataset: {
        values: {
          customer_email: "client@example.test",
          appointment_date: "2027-08-15",
        },
      },
      evidence: { mysql: mysqlEvidence },
      provider: "gemini",
      model: "gemini-test",
    });

    const serializedContext = JSON.stringify(capturedRequest?.context);
    expect(serializedContext).toContain('"tableName":"appointments"');
    expect(serializedContext).toContain(
      '"row":{"id":11,"customer_id":4,"appointment_date":"2027-08-15"}',
    );
    expect(serializedContext).toContain(
      "Nu cere obligatoriu customers.inserted",
    );
  });
});
