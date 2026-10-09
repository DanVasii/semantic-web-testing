// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { PostRunModal } from "./PostRunModal.js";

const snapshot: RunnerSnapshot = {
  state: "waiting_for_imap_check",
  run: {
    id: "run-1",
    projectId: "project-1",
    testId: "test-1",
    testVersion: 1,
    startedAt: "2026-07-27T10:00:00.000Z",
    status: "running",
    browserType: "chromium",
    pageVersionIds: [],
  },
  currentStepIndex: 1,
  totalSteps: 1,
  message: "Se așteaptă e-mailul.",
  imap: {
    stepId: "imap-1",
    accountId: "account-1",
    status: "waiting",
    message: "Se așteaptă e-mailul.",
    startedAt: "2026-07-27T10:00:01.000Z",
  },
  canStop: true,
  canRetry: false,
};

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("PostRunModal IMAP polling", () => {
  it("polls immediately and continues every three seconds while the countdown changes", async () => {
    vi.useFakeTimers();
    const pollImapCheck = vi.fn().mockResolvedValue(snapshot);
    const api = { pollImapCheck } as unknown as SemanticAppApi;

    render(
      <PostRunModal
        api={api}
        open
        snapshot={snapshot}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_000);
    });
    expect(pollImapCheck).toHaveBeenCalledTimes(3);
  });

  it("keeps received messages visible while waiting for the next IMAP inbox", () => {
    const pollImapCheck = vi.fn().mockResolvedValue(snapshot);
    const api = { pollImapCheck } as unknown as SemanticAppApi;

    render(
      <PostRunModal
        api={api}
        open
        snapshot={{
          ...snapshot,
          imap: {
            ...snapshot.imap!,
            stepId: "imap-2",
            accountId: "account-2",
            allEvidence: {
              checks: [
                {
                  messages: [
                    {
                      accountId: "account-1",
                      accountName: "Prima căsuță",
                      mailbox: "INBOX",
                      uid: 7,
                      receivedAt: "2026-07-27T10:00:20.000Z",
                      subject: "Primul e-mail",
                      from: ["sender@example.test"],
                      to: ["first@example.test"],
                      text: "Primul mesaj a sosit.",
                    },
                  ],
                },
              ],
            },
          },
        }}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    expect(screen.getByText("Mesaje primite până acum (1)")).not.toBeNull();
    expect(screen.getByText("Primul e-mail")).not.toBeNull();
    expect(
      screen.getByText("Se așteaptă și celelalte căsuțe selectate…"),
    ).not.toBeNull();
  });
});

describe("PostRunModal check summary", () => {
  const completedSnapshot: RunnerSnapshot = {
    ...snapshot,
    state: "completed",
    run: {
      ...snapshot.run!,
      status: "passed",
      endedAt: "2026-07-27T10:01:00.000Z",
    },
    imap: {
      ...snapshot.imap!,
      status: "matched",
      message: "Mesaj găsit.",
      matchedAt: "2026-07-27T10:00:30.000Z",
    },
    checkItems: [
      {
        id: "check-message",
        type: "check",
        checkType: "text",
        title: "Mesajul de succes este afișat",
        humanDescription: "Verifică textul de confirmare din pagină.",
        config: {
          target: { type: "css", operator: "equals", value: "#success" },
          operator: "contains",
          value: "Salvat",
        },
        enabled: true,
      },
      {
        id: "post-run:mysql:test-1",
        type: "check",
        checkType: "mysql",
        title: "MySQL snapshot post-run",
        humanDescription: "Compară datele salvate în baza de date.",
        config: { tableNames: ["orders"], identities: [] },
        enabled: true,
      },
      {
        id: "post-run:imap:test-1:inbox-1",
        type: "check",
        checkType: "imap",
        title: "E-mailul de confirmare a fost primit",
        humanDescription: "Așteaptă mesajul care corespunde filtrelor IMAP.",
        config: {
          accountId: "account-1",
          receivedAfterTestStart: true,
        },
        enabled: true,
      },
    ],
  };

  it("shows navigation warnings in the final modal without marking the run failed", () => {
    const api = {} as SemanticAppApi;
    render(
      <PostRunModal
        api={api}
        open
        snapshot={{
          ...completedSnapshot,
          run: {
            ...completedSnapshot.run!,
            status: "passed_with_warnings",
            warnings: [
              {
                code: "navigation_destination_mismatch",
                stepId: "click-checkout",
                message:
                  "Click-ul nu a navigat la ruta așteptată https://example.test/order-received/**.",
              },
            ],
          },
        }}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    expect(screen.getByText("Test finalizat cu avertismente")).not.toBeNull();
    expect(
      screen.getByText(/Click-ul nu a navigat la ruta așteptată/u),
    ).not.toBeNull();
  });
  const passedResults = completedSnapshot.checkItems!.map((check, index) => ({
    id: `result-${index}`,
    runId: "run-1",
    stepId: check.id,
    status: "passed" as const,
    logs: [],
  }));

  it("lists every passed flow, MySQL and IMAP check after post-run completes", () => {
    render(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={completedSnapshot}
        stepResults={passedResults}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Toate verificările au trecut cu succes"),
    ).not.toBeNull();
    expect(screen.getByText("Mesajul de succes este afișat")).not.toBeNull();
    expect(screen.getByText("MySQL snapshot post-run")).not.toBeNull();
    expect(
      screen.getByText("E-mailul de confirmare a fost primit"),
    ).not.toBeNull();
    expect(
      screen.getByText("Verifică textul de confirmare din pagină."),
    ).not.toBeNull();
  });

  it("shows the exact screenshots sent to AI under a passed adaptive check", async () => {
    const user = userEvent.setup();
    const image = "data:image/jpeg;base64,anBlZw==";
    const adaptiveCheck = {
      id: "check-adaptive",
      type: "check" as const,
      checkType: "adaptive" as const,
      title: "Confirmă validarea formularului",
      humanDescription: "Confirmă vizual mesajul pentru telefon.",
      config: {
        strategy: "visual" as const,
        expectedTexts: [],
        matchMode: "any" as const,
        visualFallback: true,
      },
      enabled: true,
    };

    render(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={{ ...completedSnapshot, checkItems: [adaptiveCheck] }}
        stepResults={[
          {
            id: "result-adaptive",
            runId: "run-1",
            stepId: adaptiveCheck.id,
            status: "passed",
            logs: [
              {
                level: "info",
                message: "Verificare vizuală reușită.",
                visualCheckDebug: {
                  dataUrls: [image],
                  mimeType: "image/jpeg",
                  byteLength: 4,
                  prompt: "Confirmă mesajul Telefon invalid.",
                },
              },
            ],
          },
        ]}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    const summary = screen.getByText("Vezi capturile trimise către AI (1)");
    const details = summary.closest("details");
    expect(details?.open).toBe(false);
    await user.click(summary);
    expect(details?.open).toBe(true);
    expect(
      screen
        .getByRole("img", { name: "Captura 1 trimisă către AI" })
        .getAttribute("src"),
    ).toBe(image);
    expect(
      screen.getByText("Prompt: Confirmă mesajul Telefon invalid."),
    ).not.toBeNull();
  });

  it("does not claim success while a check is skipped or still pending", () => {
    const { rerender } = render(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={completedSnapshot}
        stepResults={[
          ...passedResults.slice(0, 2),
          { ...passedResults[2]!, status: "skipped" },
        ]}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Toate verificările au trecut cu succes"),
    ).toBeNull();

    rerender(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={{ ...completedSnapshot, state: "waiting_for_imap_check" }}
        stepResults={passedResults}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Toate verificările au trecut cu succes"),
    ).toBeNull();
  });

  it("does not render a summary when the test has no checks", () => {
    render(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={{ ...completedSnapshot, checkItems: [] }}
        stepResults={[]}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );
    expect(
      screen.queryByText("Toate verificările au trecut cu succes"),
    ).toBeNull();
  });

  it("renders sanitized HTML e-mail content in an isolated preview", () => {
    render(
      <PostRunModal
        api={{} as SemanticAppApi}
        open
        snapshot={{
          ...completedSnapshot,
          imap: {
            ...completedSnapshot.imap!,
            allEvidence: {
              checks: [
                {
                  messages: [
                    {
                      accountId: "account-1",
                      accountName: "Confirmări",
                      mailbox: "INBOX",
                      uid: 9,
                      receivedAt: "2026-07-27T10:00:30.000Z",
                      subject: "Confirmarea comenzii",
                      from: ["shop@example.test"],
                      to: ["client@example.test"],
                      text: "Comanda a fost confirmată.",
                      html: `<style>.title { color: green; background: url(https://tracker.example/pixel) }</style><h1 class="title" onclick="alert('x')">Comandă confirmată</h1><img src="https://tracker.example/open"><script>alert('x')</script>`,
                    },
                  ],
                },
              ],
            },
          },
        }}
        stepResults={passedResults}
        onClose={vi.fn()}
        onSnapshot={vi.fn()}
      />,
    );

    const preview = screen.getByTitle(
      "Previzualizare e-mail: Confirmarea comenzii",
    );
    const document = preview.getAttribute("srcdoc") ?? "";
    expect(preview.getAttribute("sandbox")).toBe("");
    expect(preview.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(document).toContain("Comandă confirmată");
    expect(document).toContain("Content-Security-Policy");
    expect(document).not.toContain("onclick");
    expect(document).not.toContain("<script");
    expect(document).not.toContain("tracker.example");
    expect(screen.getByText("Vezi varianta text")).not.toBeNull();
  });
});
