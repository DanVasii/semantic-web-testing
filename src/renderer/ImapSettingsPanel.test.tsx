// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import { ImapSettingsPanel } from "./ImapSettingsPanel.js";

afterEach(cleanup);

describe("ImapSettingsPanel", () => {
  it("tests unsaved credentials directly from the form", async () => {
    const user = userEvent.setup();
    const testImapConnection = vi.fn().mockResolvedValue({
      success: true,
      message: "Conexiune validă.",
      latencyMs: 8,
    });
    const api = {
      listImapAccounts: vi.fn().mockResolvedValue([]),
      testImapConnection,
    } as unknown as SemanticAppApi;

    render(<ImapSettingsPanel api={api} />);
    await user.type(screen.getByLabelText("Host"), "imap.example.test");
    await user.type(screen.getByLabelText("Utilizator"), "user@example.test");
    await user.type(screen.getByLabelText(/^Parolă/), "app-password");
    await user.click(
      screen.getByRole("button", { name: "Testează conexiunea" }),
    );

    await waitFor(() => {
      expect(testImapConnection).toHaveBeenCalledWith({
        name: "Cont principal",
        host: "imap.example.test",
        port: 993,
        secure: true,
        username: "user@example.test",
        password: "app-password",
        mailbox: "INBOX",
      });
    });
  });

  it("edits a global account, tests it and loads selectable mailboxes", async () => {
    const user = userEvent.setup();
    const account = {
      id: "imap-1",
      name: "Confirmări",
      host: "imap.example.test",
      port: 993,
      secure: true,
      username: "qa@example.test",
      mailbox: "INBOX",
      passwordConfigured: true,
    };
    const saveImapAccount = vi.fn().mockResolvedValue(account);
    const api = {
      listImapAccounts: vi.fn().mockResolvedValue([account]),
      saveImapAccount,
      testImapConnection: vi.fn().mockResolvedValue({
        success: true,
        message: "Conexiune validă.",
        latencyMs: 12,
      }),
      listImapMailboxes: vi.fn().mockResolvedValue([
        {
          path: "INBOX",
          name: "INBOX",
          specialUse: "\\Inbox",
          subscribed: true,
        },
        {
          path: "Archive",
          name: "Archive",
          subscribed: true,
        },
      ]),
      deleteImapAccount: vi.fn().mockResolvedValue(true),
    } as unknown as SemanticAppApi;

    render(<ImapSettingsPanel api={api} />);
    await user.click(await screen.findByRole("button", { name: "Confirmări" }));
    await user.click(
      screen.getByRole("button", { name: "Testează conexiunea" }),
    );
    expect(await screen.findByText(/Conexiune validă.*12 ms/i)).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Încarcă mailbox-uri" }),
    );
    expect(
      await screen.findByRole("option", { name: "Archive" }),
    ).not.toBeNull();

    await user.clear(screen.getByLabelText("Nume"));
    await user.type(screen.getByLabelText("Nume"), "QA global");
    await user.click(screen.getByRole("button", { name: "Salvează contul" }));
    await waitFor(() => {
      expect(saveImapAccount).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "imap-1",
          name: "QA global",
          username: "qa@example.test",
        }),
      );
    });
  });

  it("starts and stops a diagnostic listener and displays received messages", async () => {
    const user = userEvent.setup();
    const pollImapDiagnostic = vi.fn().mockResolvedValue({
      checkedAt: "2026-07-27T10:00:05.000Z",
      messages: [
        {
          uid: 42,
          mailbox: "INBOX",
          receivedAt: "2026-07-27T10:00:03.000Z",
          subject: "Am primit rezervarea ta",
          from: ["fixture@example.test"],
          to: ["client@example.test"],
          textPreview: "Bună, Ana! Am primit rezervarea ta.",
        },
      ],
    });
    const api = {
      listImapAccounts: vi.fn().mockResolvedValue([]),
      pollImapDiagnostic,
    } as unknown as SemanticAppApi;

    render(<ImapSettingsPanel api={api} />);
    await user.type(screen.getByLabelText("Host"), "imap.example.test");
    await user.type(screen.getByLabelText("Utilizator"), "client@example.test");
    await user.type(screen.getByLabelText(/^Parolă/), "app-password");
    await user.click(
      screen.getByRole("button", { name: "Pornește ascultarea" }),
    );

    expect(await screen.findByText("Am primit rezervarea ta")).not.toBeNull();
    expect(screen.getByText(/fixture@example.test/)).not.toBeNull();
    expect(pollImapDiagnostic).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "imap.example.test",
        username: "client@example.test",
        password: "app-password",
        mailbox: "INBOX",
      }),
      expect.any(String),
    );

    await user.click(
      screen.getByRole("button", { name: "Oprește ascultarea" }),
    );
    expect(
      screen.getByRole("button", { name: "Pornește ascultarea" }),
    ).not.toBeNull();
  });
});
