import { describe, expect, it } from "vitest";

import { EXTERNAL_AI_TEST_PROMPT } from "./external-ai-prompt.js";

describe("EXTERNAL_AI_TEST_PROMPT", () => {
  it("documents the strict portable test envelope and human fields", () => {
    expect(EXTERNAL_AI_TEST_PROMPT).toContain('"schemaVersion": 1');
    expect(EXTERNAL_AI_TEST_PROMPT).toContain('"kind": "semantic-test"');
    expect(EXTERNAL_AI_TEST_PROMPT).toContain("humanDescription");
    expect(EXTERNAL_AI_TEST_PROMPT).toContain("Răspunde exclusiv");
    expect(EXTERNAL_AI_TEST_PROMPT).toContain("data-testid");
  });
});
