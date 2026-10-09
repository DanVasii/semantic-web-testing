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
        {
          id: "imap-2",
          name: "Facturi",
          host: "imap.example.test",
          port: 993,
          secure: true,
          username: "billing@example.test",
          mailbox: "Billing",
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
      screen.getByRole("button", { name: /Adaugă check e-mail/i }),
    );
    expect(screen.queryByLabelText(/Destinatar exact/i)).toBeNull();
    await user.type(
      screen.getByLabelText(/Expeditor exact/i),
      "confirm@example.test",
    );
    await user.click(
      screen.getByRole("button", { name: /Adaugă check e-mail/i }),
    );
    await user.selectOptions(
      screen.getByLabelText(/Inbox \/ cont IMAP/i),
      "imap-2",
    );
    await user.type(
      screen.getByLabelText(/Expeditor exact/i),
      "invoice@example.test",
    );
    await user.click(screen.getByRole("button", { name: /Salvează checks/i }));

    await waitFor(() => {
      expect(saveTestPostRunChecks).toHaveBeenCalled();
      const saved: unknown = saveTestPostRunChecks.mock.calls[0]?.[2];
      expect(saved).toMatchObject({
        aiPrompt: "Corelează statusul din DB cu e-mailul de confirmare.",
        mysql: {
          enabled: true,
          tableNames: ["appointments"],
          identities: [{ tableName: "appointments", columns: ["id"] }],
        },
        imap: {
          enabled: true,
          accountIds: ["imap-1", "imap-2"],
          inboxes: [
            {
              accountId: "imap-1",
              mailbox: "INBOX",
              sender: "confirm@example.test",
            },
            {
              accountId: "imap-2",
              mailbox: "Billing",
              sender: "invoice@example.test",
            },
          ],
        },
      });
    });
    expect(onTestUpdated).toHaveBeenCalledWith(updated);
  });

  it("filters MySQL tables and preserves selections outside the active search", async () => {
    const user = userEvent.setup();
    const api = {
      loadMySqlSchema: vi.fn().mockResolvedValue({
        database: "shop",
        loadedAt: test.createdAt,
        tables: [
          {
            name: "appointments",
            columns: [],
            primaryKey: ["id"],
            identityColumns: ["id"],
            identitySource: "primary_key",
          },
          {
            name: "wp_wc_orders",
            columns: [],
            primaryKey: ["id"],
            identityColumns: ["id"],
            identitySource: "primary_key",
          },
          {
            name: "wp_wc_orders_meta",
            columns: [],
            primaryKey: ["id"],
            identityColumns: ["id"],
            identitySource: "primary_key",
          },
        ],
      }),
      listImapAccounts: vi.fn().mockResolvedValue([]),
    } as unknown as SemanticAppApi;

    render(
      <TestChecksPanel
        api={api}
        projectId={test.projectId}
        test={test}
        onTestUpdated={vi.fn()}
      />,
    );

    await user.click(
      await screen.findByRole("checkbox", { name: /appointments/i }),
    );
    await user.type(screen.getByLabelText(/Caută tabel MySQL/i), "WC_ORDERS");

    expect(
      screen.queryByRole("checkbox", { name: /appointments/i }),
    ).toBeNull();
    expect(screen.getByText("2 din 3 tabele")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Selectează rezultatele" }),
    );
    await user.click(
      screen.getByRole("button", { name: /Șterge căutarea tabelelor/i }),
    );

    expect(
      screen.getByRole("checkbox", { name: /appointments/i }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("checkbox", {
        name: /^wp_wc_ordersIdentitate/i,
      }),
    ).toHaveProperty("checked", true);
    expect(
      screen.getByRole("checkbox", { name: /wp_wc_orders_meta/i }),
    ).toHaveProperty("checked", true);
  });
});
