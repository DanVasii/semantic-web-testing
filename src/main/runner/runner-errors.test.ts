import { describe, expect, it } from "vitest";
import { RunnerError } from "../../shared/runner.js";
import { classifyRunnerError } from "./runner-errors.js";
import { StepExecutionError } from "./step-executor.js";

const NOW = () => new Date("2026-07-27T10:00:00.000Z");

describe("classifyRunnerError", () => {
  it.each([
    [
      new StepExecutionError("locator_not_found", "Element absent"),
      "locator_not_found",
    ],
    [
      new StepExecutionError("locator_ambiguous", "Mai multe elemente", 3),
      "locator_ambiguous",
    ],
    [
      new Error("Target page, context or browser has been closed"),
      "browser_disconnected",
    ],
    [
      new Error("Navigation timeout of 30000 ms exceeded"),
      "navigation_timeout",
    ],
    [new Error("MySQL connection refused"), "mysql_failed"],
    [new Error("IMAP mailbox unavailable"), "imap_failed"],
  ] as const)("clasifică eroarea drept %s", (error, code) => {
    expect(
      classifyRunnerError(error, {
        ...(code === "navigation_timeout" ? { operation: "navigate" } : {}),
        now: NOW,
      }),
    ).toMatchObject({
      code,
      occurredAt: "2026-07-27T10:00:00.000Z",
    });
  });

  it("păstrează metadatele RunnerError și redactează secretele", () => {
    expect(
      classifyRunnerError(
        new RunnerError("dataset_missing", "Lipsește dataset-ul", {
          retryable: false,
        }),
        { stepId: "step-1", operation: "dataset", now: NOW },
      ),
    ).toMatchObject({
      code: "dataset_missing",
      stepId: "step-1",
      operation: "dataset",
      retryable: false,
    });
    expect(
      classifyRunnerError(new Error("token=secret password:demo"), { now: NOW })
        .technicalDetails,
    ).not.toContain("secret");
  });
});
