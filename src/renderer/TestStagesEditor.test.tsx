// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { TestPostRunChecks } from "../shared/post-run-checks.js";
import type { TestStage } from "../shared/test-stages.js";
import { TestStagesEditor } from "./TestStagesEditor.js";

const stages: TestStage[] = [
  {
    id: "stage-checkout",
    name: "Checkout",
    enabled: true,
    entry: { type: "test_start" },
    flowItems: [],
    postChecks: [
      {
        id: "mysql-order",
        type: "check",
        checkType: "mysql",
        title: "Verifică comanda",
        humanDescription: "Confirmă schimbările din DB.",
        enabled: true,
        required: true,
        config: {
          tableNames: ["orders"],
          identities: [{ tableName: "orders", columns: ["id"] }],
        },
        extractors: [],
      },
    ],
  },
];

const test: TestDefinition = {
  id: "test-1",
  projectId: "project-1",
  name: "Checkout",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/checkout",
  normalizedStartUrl: "https://example.test/checkout",
  workflowState: "ready",
  createdAt: "2026-09-17T10:00:00.000Z",
  updatedAt: "2026-09-17T10:00:00.000Z",
  flowItems: [],
  stages,
};

afterEach(cleanup);

describe("TestStagesEditor checks section", () => {
  it("saves stage checks and AI instructions from a dedicated section", async () => {
    const user = userEvent.setup();
    const saveTestStages = vi
      .fn<NonNullable<SemanticAppApi["saveTestStages"]>>()
      .mockImplementation((_projectId, _testId, nextStages) =>
        Promise.resolve({ ...test, version: 2, stages: nextStages }),
      );
    const saveTestPostRunChecks = vi
      .fn<SemanticAppApi["saveTestPostRunChecks"]>()
      .mockImplementation((_projectId, _testId, checks: TestPostRunChecks) =>
        Promise.resolve({
          ...test,
          version: 3,
          stages,
          postRunChecks: checks,
        }),
      );
    const api = {
      saveTestStages,
      saveTestPostRunChecks,
      loadMySqlSchema: vi.fn().mockResolvedValue({ tables: [] }),
      listImapAccounts: vi.fn().mockResolvedValue([]),
    } as unknown as SemanticAppApi;

    render(
      <TestStagesEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
        section="checks"
      />,
    );

    expect(screen.getByRole("heading", { name: "Checks" })).not.toBeNull();
    expect(screen.queryByText("Sesiunea de flow-uri")).toBeNull();

    const title = screen.getByLabelText("Titlu check");
    await user.clear(title);
    await user.type(title, "Verifică salvarea comenzii");
    await user.type(
      screen.getByLabelText("Instrucțiuni pentru AI la checks"),
      "Confirmă că DB conține o singură comandă nouă.",
    );
    await user.click(screen.getByRole("button", { name: "Salvează checks" }));

    await waitFor(() => {
      expect(saveTestStages).toHaveBeenCalledOnce();
      expect(saveTestPostRunChecks).toHaveBeenCalledWith(
        test.projectId,
        test.id,
        expect.objectContaining({
          aiPrompt: "Confirmă că DB conține o singură comandă nouă.",
        }),
      );
    });
    expect(saveTestStages.mock.calls[0]?.[0]).toBe(test.projectId);
    expect(saveTestStages.mock.calls[0]?.[1]).toBe(test.id);
    expect(saveTestStages.mock.calls[0]?.[2][0]?.postChecks[0]?.title).toBe(
      "Verifică salvarea comenzii",
    );
    expect(
      screen.getByText("Checks și instrucțiunile pentru AI au fost salvate."),
    ).not.toBeNull();
  });
});
