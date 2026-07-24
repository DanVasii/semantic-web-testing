// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BasicAuthChallenge } from "../shared/browser-manager.js";
import { BasicAuthDialog } from "./BasicAuthDialog.js";

const challenge: BasicAuthChallenge = {
  projectId: "project-1",
  url: "https://secure.example.test/account",
  origin: "https://secure.example.test",
  invalidCredentials: false,
};

afterEach(cleanup);

describe("BasicAuthDialog", () => {
  it("collects credentials without persisting or displaying the password", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn().mockResolvedValue(undefined);
    render(
      <BasicAuthDialog
        challenge={challenge}
        isSubmitting={false}
        open
        onCancel={vi.fn()}
        onSubmit={onSubmit}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: "Autentifică și continuă" }),
    );
    expect(screen.getByText("Username-ul este obligatoriu.")).not.toBeNull();

    await user.type(screen.getByLabelText("Username"), "tester");
    await user.type(screen.getByLabelText("Parolă"), "secret");
    expect(screen.queryByText("secret")).toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Autentifică și continuă" }),
    );

    expect(onSubmit).toHaveBeenCalledWith({
      username: "tester",
      password: "secret",
    });
    expect(screen.getByText(/șterse complet la închidere/i)).not.toBeNull();
  });

  it("shows invalid credentials and supports cancellation", async () => {
    const user = userEvent.setup();
    const onCancel = vi.fn();
    render(
      <BasicAuthDialog
        challenge={{ ...challenge, invalidCredentials: true }}
        isSubmitting={false}
        open
        onCancel={onCancel}
        onSubmit={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Username-ul sau parola sunt invalide."),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Anulează" }));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
