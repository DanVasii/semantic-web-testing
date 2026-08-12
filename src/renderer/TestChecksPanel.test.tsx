// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import { defaultTestPostRunChecks } from "../shared/post-run-checks.js";
import { TestChecksPanel } from "./TestChecksPanel.js";

const test: TestDefinition = {
  id: "test-1",
  projectId: "project-1",
  name: "Programare",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test",
  normalizedStartUrl: "https://example.test/",
  workflowState: "ready",
  createdAt: "2026-07-26T10:00:00.000Z",
  updatedAt: "2026-07-26T10:00:00.000Z",
  flowItems: [],
  postRunChecks: defaultTestPostRunChecks(),
};

afterEach(cleanup);

describe("TestChecksPanel", () => {
  it("saves MySQL and IMAP checks with one shared AI instruction", async () => {
    const user = userEvent.setup();
    const updated = {
      ...test,
      updatedAt: "2026-07-26T10:01:00.000Z",
    };
    const saveTestPostRunChecks = vi.fn().mockResolvedValue(updated);
    const api = {
      loadMySqlSchema: vi.fn().mockResolvedValue({
        database: "semantic_fixture",
        loadedAt: test.createdAt,
        tables: [
          {
            name: "appointments",
            columns: [],
            primaryKey: ["id"],
            identityColumns: ["id"],
            identitySource: "primary_key",
          },
        ],
      }),
      listImapAccounts: vi.fn().mockResolvedValue([
        {
          id: "imap-1",
          name: "Confirmări",
          host: "imap.example.test",
          port: 993,
          secure: true,
          username: "qa@example.test",
          mailbox: "INBOX",
          passwordConfigured: true,
        },
      ]),
      saveTestPostRunChecks,
    } as unknown as SemanticAppApi;
    const onTestUpdated = vi.fn();

    render(
      <TestChecksPanel
        api={api}
        projectId={test.projectId}
        test={test}
        onTestUpdated={onTestUpdated}
      />,
    );

    await user.click(
      screen.getByRole("checkbox", {
        name: /MySQL snapshot implicit/i,
      }),
    );
    await user.click(
      await screen.findByRole("checkbox", { name: /appointments/i }),
    );
    await user.type(
      screen.getByLabelText(/Instrucțiune AI comună/i),
      "Corelează statusul din DB cu e-mailul de confirmare.",
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Ascultare e-mail/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Confirmări.*qa@example.test/i }),
    );
    await user.click(screen.getByRole("button", { name: /Salvează checks/i }));

    await waitFor(() => {
      expect(saveTestPostRunChecks).toHaveBeenCalledWith(
        test.projectId,
        test.id,
        {
          aiPrompt: "Corelează statusul din DB cu e-mailul de confirmare.",
          mysql: {
            enabled: true,
            tableNames: ["appointments"],
            identities: [{ tableName: "appointments", columns: ["id"] }],
          },
          imap: {
            enabled: true,
            accountIds: ["imap-1"],
            mailbox: "INBOX",
            sender: "",
            recipient: "",
            subjectEquals: "",
            subjectContains: "",
            bodyContains: "",
          },
        },
      );
    });
    expect(onTestUpdated).toHaveBeenCalledWith(updated);
  });
});
