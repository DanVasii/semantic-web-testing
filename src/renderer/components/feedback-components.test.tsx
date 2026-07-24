// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RUNNER_STATES } from "../../shared/runner.js";
import { ConfirmDialog } from "./ConfirmDialog.js";
import { StatusBadge } from "./StatusBadge.js";

afterEach(cleanup);

describe("StatusBadge", () => {
  it.each(RUNNER_STATES)("renders the %s runner state", (status) => {
    render(<StatusBadge status={status} />);

    expect(
      screen
        .getByRole("status")
        .getAttribute("aria-label")
        ?.startsWith("Status runner:"),
    ).toBe(true);
  });
});

describe("ConfirmDialog", () => {
  it("emits confirm and cancel actions", async () => {
    const user = userEvent.setup();
    const onConfirm = vi.fn();
    const onCancel = vi.fn();

    render(
      <ConfirmDialog
        open
        title="Șterge rularea?"
        message="Acțiunea nu poate fi anulată."
        confirmLabel="Șterge"
        confirmVariant="danger"
        onConfirm={onConfirm}
        onCancel={onCancel}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Șterge" }));
    expect(onConfirm).toHaveBeenCalledOnce();

    await user.click(screen.getByRole("button", { name: "Anulează" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
