// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Dropdown } from "./Dropdown.js";
import { Modal } from "./Modal.js";
import { Tabs } from "./Tabs.js";
import { Toast, type ToastVariant } from "./Toast.js";

afterEach(cleanup);

describe("Modal", () => {
  it("supports open, close and escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const { rerender } = render(
      <Modal open={false} title="Confirmare" onClose={onClose}>
        Conținut
      </Modal>,
    );

    expect(screen.queryByRole("dialog")).toBeNull();

    rerender(
      <Modal open title="Confirmare" onClose={onClose}>
        Conținut
      </Modal>,
    );

    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("true");

    await user.click(screen.getByRole("button", { name: "Închide dialogul" }));
    expect(onClose).toHaveBeenCalledOnce();

    onClose.mockClear();
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Dropdown", () => {
  it("expands and collapses its menu", async () => {
    const user = userEvent.setup();

    render(
      <Dropdown label="Acțiuni" items={[{ id: "edit", label: "Editează" }]} />,
    );

    const trigger = screen.getByRole("button", { name: "Acțiuni" });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");

    await user.click(trigger);
    expect(screen.getByRole("menu")).not.toBeNull();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    await user.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

describe("Tabs", () => {
  it("changes the active tab", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Tabs
        label="Detalii proiect"
        onChange={onChange}
        tabs={[
          { id: "general", label: "General", content: "Conținut general" },
          { id: "runs", label: "Rulări", content: "Conținut rulări" },
        ]}
      />,
    );

    await user.click(screen.getByRole("tab", { name: "Rulări" }));

    expect(
      screen.getByRole("tab", { name: "Rulări" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(screen.getByRole("tabpanel").textContent).toBe("Conținut rulări");
    expect(onChange).toHaveBeenCalledWith("runs");
  });
});

describe("Toast", () => {
  it.each([
    ["success", "status"],
    ["warning", "alert"],
    ["error", "alert"],
  ] satisfies [ToastVariant, string][])(
    "renders the %s notification",
    (variant, role) => {
      render(
        <Toast variant={variant} title="Rezultat" message="Mesaj notificare" />,
      );

      expect(screen.getByRole(role).textContent).toContain("Rezultat");
    },
  );
});
