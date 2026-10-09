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
          cv: { type: "file", path: "C:\\managed\\cv.pdf", name: "cv.pdf" },
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
      cv: "C:\\managed\\cv.pdf",
      uuid: "generated-id",
      number: "15",
      date: "2026-07-26",
    });
  });

  it("materializes every Dataset editor generator strategy", () => {
    const values = materializeDataset(
      {
        id: "dataset-all",
        testId: "test-1",
        name: "Toate strategiile",
        createdAt: "2026-07-24T10:00:00.000Z",
        updatedAt: "2026-07-24T10:00:00.000Z",
        values: {
          timestamp: { type: "generated", strategy: "timestamp" },
          uuid: { type: "generated", strategy: "uuid" },
          random: {
            type: "generated",
            strategy: "random_number",
            min: 1,
            max: 3,
          },
          email: {
            type: "generated",
            strategy: "unique_email",
            template: "qa+{{timestamp}}-{{uuid}}@example.test",
          },
          today: {
            type: "generated",
            strategy: "current_date",
            format: "DD.MM.YYYY",
          },
          future: {
            type: "generated",
            strategy: "current_date_plus_days",
            days: 2,
          },
          past: {
            type: "generated",
            strategy: "current_date_minus_days",
            days: 2,
          },
          choice: {
            type: "generated",
            strategy: "random_choice",
            choices: ["a", "b", "c"],
          },
          template: {
            type: "generated",
            strategy: "template",
            template: "run-{{timestamp}}-{{uuid}}",
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
      timestamp: "1784887200000",
      uuid: "generated-id",
      random: "2",
      email: "qa+1784887200000-generated-id@example.test",
      today: "24.07.2026",
      future: "2026-07-26",
      past: "2026-07-22",
      choice: "b",
      template: "run-1784887200000-generated-id",
    });
  });
});
