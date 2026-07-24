import { describe, expect, it } from "vitest";

import { materializeDataset } from "./dataset-values.js";

describe("dataset materializer", () => {
  it("loads fixed and generated dataset values once per run", () => {
    const values = materializeDataset(
      {
        id: "dataset-1",
        testId: "test-1",
        name: "Date",
        createdAt: "2026-07-24T10:00:00.000Z",
        updatedAt: "2026-07-24T10:00:00.000Z",
        values: {
          name: { type: "fixed", value: "Ana" },
          uuid: { type: "generated", strategy: "uuid" },
          number: {
            type: "generated",
            strategy: "random_number",
            min: 10,
            max: 20,
          },
          date: {
            type: "generated",
            strategy: "current_date_plus_days",
            days: 2,
          },
        },
      },
      {
        createId: () => "generated-id",
        now: () => new Date("2026-07-24T10:00:00.000Z"),
        random: () => 0.5,
      },
    );

    expect(values).toEqual({
      name: "Ana",
      uuid: "generated-id",
      number: "15",
      date: "2026-07-26",
    });
  });
});
