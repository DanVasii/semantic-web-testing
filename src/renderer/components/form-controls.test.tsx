// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button, type ButtonVariant } from "./Button.js";
import { Input } from "./Input.js";
import { Select } from "./Select.js";

afterEach(cleanup);

describe("Button", () => {
  it.each([
    ["primary", "bg-brand-600"],
    ["secondary", "bg-app-surface"],
    ["danger", "bg-red-600"],
  ] satisfies [ButtonVariant, string][])(
    "renders the %s variant",
    (variant, expectedClass) => {
      render(<Button variant={variant}>Salvează</Button>);

      expect(
        screen.getByRole("button", { name: "Salvează" }).className,
      ).toContain(expectedClass);
    },
  );
});

describe("Input", () => {
  it("associates its label and error with the input", () => {
    render(
      <Input label="Nume proiect" error="Numele este obligatoriu." disabled />,
    );

    const input = screen.getByLabelText("Nume proiect");

    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toBe(
      "Numele este obligatoriu.",
    );
  });
});

describe("Select", () => {
  it("emits the selected value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();

    render(
      <Select
        label="Browser"
        defaultValue="chromium"
        onChange={onChange}
        options={[
          { value: "chromium", label: "Chromium" },
          { value: "firefox", label: "Firefox" },
        ]}
      />,
    );

    const select = screen.getByLabelText("Browser");
    await user.selectOptions(select, "firefox");

    expect((select as HTMLSelectElement).value).toBe("firefox");
    expect(onChange).toHaveBeenCalledOnce();
  });
});
