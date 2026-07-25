// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { TestDefinition } from "../shared/persistence.js";
import type { TestFlowItem } from "../shared/test-model.js";
import { TestFlowEditor } from "./TestFlowEditor.js";

const test: TestDefinition = {
  id: "test-1",
  projectId: "project-1",
  name: "Checkout",
  status: "draft",
  version: 1,
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/products",
  normalizedStartUrl: "https://example.test/products",
  workflowState: "not_recorded",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  flowItems: [],
};

const createApi = (): SemanticAppApi =>
  ({
    listTestVersions: vi.fn().mockResolvedValue([]),
    saveTestFlow: vi
      .fn()
      .mockImplementation(
        (_projectId: string, _testId: string, flowItems: TestFlowItem[]) =>
          Promise.resolve({
            ...test,
            version: 2,
            status: "valid",
            workflowState: "ready",
            flowItems,
          }),
      ),
  }) as unknown as SemanticAppApi;

afterEach(cleanup);

describe("TestFlowEditor", () => {
  it("adds, edits, duplicates, reorders, disables and saves flow items", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    const title = screen.getByLabelText("Titlu");
    await user.clear(title);
    expect(
      screen.getByText("Flow invalid — salvarea este blocată"),
    ).not.toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Salvează flow-ul testului" })
        .hasAttribute("disabled"),
    ).toBe(true);

    await user.type(title, "Deschide produsul");
    await user.selectOptions(screen.getByLabelText("Tip acțiune"), "click");
    await user.selectOptions(
      screen.getByLabelText("Locator principal strategie"),
      "relative",
    );
    expect(screen.getByText("Ancoră")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "+ Fallback" }));
    expect(screen.getByText("Fallback-uri (1/3)")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Duplică" }));
    expect(screen.getAllByRole("button", { name: "Duplică" })).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Mută pasul 2 în sus" }),
    );
    await user.click(screen.getAllByLabelText("Activ")[0]!);
    await user.click(screen.getByRole("button", { name: "Undo" }));

    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );
    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalledWith(
        test.projectId,
        test.id,
        expect.arrayContaining([
          expect.objectContaining({ title: "Deschide produsul" }),
        ]),
      );
    });
  });

  it("supports repeated locators, keyword operators and technical preview", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(
      screen.getByLabelText("Locator principal strategie"),
      "repeated_component",
    );
    expect(screen.getByText("Container repetitiv")).not.toBeNull();
    const operator = screen.getAllByLabelText("Operator")[0]!;
    await user.selectOptions(operator, "contains_all_keywords");
    expect(screen.getByText("Cuvinte-cheie")).not.toBeNull();
    await user.click(
      screen.getByText("Preview tehnic și descriere procedurală"),
    );
    expect(
      screen.getAllByText(/Apasă elementul selectat/).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(/repeated_component/)).not.toBeNull();
  });

  it("configures dataset keys for input actions", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(screen.getByLabelText("Tip acțiune"), "fill");
    await user.type(
      screen.getByLabelText("ID semantic câmp"),
      "customer_email",
    );
    expect(screen.getByLabelText("Cheie dataset").getAttribute("value")).toBe(
      "customer_email",
    );
    await user.clear(screen.getByLabelText("Cheie dataset"));
    await user.type(screen.getByLabelText("Cheie dataset"), "contact_email");
    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );

    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalledOnce();
    });
    const savedItem = vi.mocked(api.saveTestFlow).mock.calls[0]?.[2][0];
    expect(savedItem).toMatchObject({
      actionType: "fill",
      inputFieldId: "customer_email",
      valueKey: "contact_email",
      valueStrategy: "dataset",
      target: { fieldId: "customer_email" },
    });
  });

  it("adds, reorders and disables breakpoints as flow items", async () => {
    const user = userEvent.setup();
    const api = createApi();
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.selectOptions(
      screen.getByLabelText("Tip pas nou"),
      "breakpoint",
    );
    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(screen.getByLabelText("Tip pas nou"), "action");
    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.click(
      screen.getByRole("button", { name: "Mută pasul 1 în jos" }),
    );
    await user.click(screen.getAllByLabelText("Activ")[1]!);
    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );

    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalledWith(test.projectId, test.id, [
        expect.objectContaining({ type: "action" }),
        expect.objectContaining({ type: "breakpoint", enabled: false }),
      ]);
    });
  });
});
