import { describe, expect, it } from "vitest";

import type { Project, TestDefinition } from "./persistence.js";
import {
  getTestPrimaryAction,
  normalizeTestStartUrl,
  validateTestInput,
} from "./tests.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

const test = (
  workflowState: TestDefinition["workflowState"],
): TestDefinition => ({
  id: "test-1",
  projectId: project.id,
  name: "Cumpără produs",
  status: "draft",
  version: 1,
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/products?category=10#list",
  normalizedStartUrl: "https://example.test/products?category=10#list",
  workflowState,
  createdAt: project.createdAt,
  updatedAt: project.updatedAt,
  flowItems: [],
});

describe("test input", () => {
  it("preserves query and hash in the normalized start URL", () => {
    expect(
      normalizeTestStartUrl(" https://example.test/products?category=10#list "),
    ).toBe("https://example.test/products?category=10#list");
  });

  it("requires a valid start URL from the project origin", () => {
    expect(
      validateTestInput(
        { name: "", startUrl: "https://other.test/products" },
        project,
      ),
    ).toEqual({
      name: "Numele testului este obligatoriu.",
      startUrl: "URL-ul de start trebuie să aparțină site-ului proiectului.",
    });
    expect(
      validateTestInput(
        {
          name: "Cumpără produs",
          startUrl: "https://example.test/products?category=10#list",
          wipeBeforeRun: true,
        },
        project,
      ),
    ).toEqual({});
  });
});

describe("recording-first primary action", () => {
  it.each([
    ["not_recorded", "Înregistrează testul"],
    ["recording", "Done"],
    ["recorded", "Finalizează analiza"],
    ["analyzing_flow", "Așteaptă analiza"],
    ["flow_analyzed", "Revizuiește pașii"],
    ["ready", "Rulează testul"],
  ] satisfies Array<
    [TestDefinition["workflowState"], ReturnType<typeof getTestPrimaryAction>]
  >)("maps %s to %s", (state, action) => {
    expect(getTestPrimaryAction(test(state))).toBe(action);
  });
});
