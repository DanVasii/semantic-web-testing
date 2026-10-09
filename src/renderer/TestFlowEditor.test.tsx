// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
  testMode: "recorded",
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
    loadMySqlSchema: vi.fn(),
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
  it("configures an AI-selected Google Pay TEST card on a recorded click", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const recordedTest: TestDefinition = {
      ...test,
      workflowState: "flow_analyzed",
      flowItems: [
        {
          id: "google-pay",
          type: "action",
          actionType: "click",
          title: "Apasă Google Pay",
          humanDescription: "Deschide Google Pay.",
          whyExplanation: "Testează plata.",
          target: {
            primary: {
              type: "role",
              role: "button",
              operator: "equals",
              value: "Google Pay",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    };
    render(
      <TestFlowEditor
        api={api}
        projectId={recordedTest.projectId}
        test={recordedTest}
        onTestSaved={vi.fn()}
      />,
    );

    await user.type(
      screen.getByLabelText("Card Google Pay TEST dorit"),
      "Alege cardul Visa pentru scenariul Incorrect CVC.",
    );
    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );

    await waitFor(() => expect(api.saveTestFlow).toHaveBeenCalledOnce());
    expect(vi.mocked(api.saveTestFlow).mock.calls[0]?.[2][0]).toMatchObject({
      googlePayCardDescription:
        "Alege cardul Visa pentru scenariul Incorrect CVC.",
    });
  });

  it("copies a console diagnostic for a primary locator", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const recordedTest: TestDefinition = {
      ...test,
      workflowState: "flow_analyzed",
      flowItems: [
        {
          id: "copy-locator",
          type: "action",
          actionType: "click",
          title: "Continuă",
          humanDescription: "Apasă Continuă.",
          whyExplanation: "Continuă scenariul.",
          target: {
            primary: {
              type: "role",
              role: "button",
              operator: "equals",
              value: "Continuă",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    };
    render(
      <TestFlowEditor
        api={createApi()}
        projectId={recordedTest.projectId}
        test={recordedTest}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Copiază JS" }));

    expect(writeText).toHaveBeenCalledWith(
      expect.stringContaining('"role": "button"'),
    );
    expect(await screen.findByText("Copiat")).not.toBeNull();
  });

  it("keeps MySQL snapshot configuration outside flow steps", async () => {
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

    await user.selectOptions(screen.getByLabelText(/Tip pas nou/i), "check");
    await user.click(screen.getByRole("button", { name: /Adaugă pas/i }));
    const checkType = screen.getByLabelText(/Tip verificare/i);
    expect(checkType.querySelector('option[value="mysql"]')).toBeNull();
    expect(api.loadMySqlSchema).not.toHaveBeenCalled();
  });

  it("edits a text check condition and its wait timeout", async () => {
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

    await user.selectOptions(screen.getByLabelText("Tip pas nou"), "check");
    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(screen.getByLabelText("Tip verificare"), "text");
    await user.clear(screen.getByLabelText("Valoare așteptată"));
    await user.type(screen.getByLabelText("Valoare așteptată"), "Salvat");
    await user.clear(screen.getByLabelText("Timeout verificare (ms)"));
    await user.type(screen.getByLabelText("Timeout verificare (ms)"), "10000");
    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );

    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalled();
    });
    const savedItems = vi.mocked(api.saveTestFlow).mock.calls[0]?.[2];
    expect(savedItems?.[0]).toMatchObject({
      type: "check",
      checkType: "text",
      timeoutMs: 10_000,
      config: { operator: "contains", value: "Salvat" },
    });
  });

  it("allows an unchanged recorded flow to be explicitly approved", async () => {
    const user = userEvent.setup();
    const api = createApi();
    const recordedTest: TestDefinition = {
      ...test,
      workflowState: "flow_analyzed",
      flowItems: [
        {
          id: "recorded-step-1",
          type: "action",
          actionType: "click",
          title: "Continuă spre checkout",
          humanDescription: "Apasă butonul Continuă.",
          whyExplanation: "Butonul continuă scenariul înregistrat.",
          target: {
            primary: {
              type: "role",
              role: "button",
              operator: "equals",
              value: "Continuă",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    };
    render(
      <TestFlowEditor
        api={api}
        projectId={recordedTest.projectId}
        test={recordedTest}
        onTestSaved={vi.fn()}
      />,
    );

    expect(
      screen.getByText(/Nu trebuie să modifici un pas dacă este deja corect/),
    ).not.toBeNull();
    const approve = screen.getByRole("button", {
      name: "Salvează flow-ul testului",
    });
    expect(approve.hasAttribute("disabled")).toBe(false);
    expect(approve.textContent).toBe("Aprobă și pregătește testul");

    await user.click(approve);
    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalledWith(
        recordedTest.projectId,
        recordedTest.id,
        recordedTest.flowItems,
      );
    });
  });

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
    expect(
      screen.getByRole("region", { name: "Conținutul pasului" }),
    ).not.toBeNull();
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
    await user.click(screen.getByRole("button", { name: "Acțiuni pas" }));
    await user.click(screen.getByRole("menuitem", { name: "Duplică pasul" }));
    expect(
      screen
        .getByRole("navigation", { name: "Pașii testului" })
        .querySelectorAll("li"),
    ).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: "Acțiuni pas" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Mută pasul în sus" }),
    );
    await user.click(screen.getByLabelText("Activ"));
    await user.click(screen.getByRole("button", { name: "Istoric" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Anulează ultima modificare" }),
    );

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

  it("edits one reveal candidate and one fallback at a time", async () => {
    const user = userEvent.setup();
    const action = {
      id: "step-with-alternatives",
      type: "action" as const,
      actionType: "click" as const,
      title: "Deschide meniul",
      humanDescription: "Deschide meniul ascuns.",
      whyExplanation: "Continuă navigarea.",
      target: {
        primary: {
          type: "css" as const,
          operator: "equals" as const,
          value: "#menu",
        },
      },
      revealBefore: [
        {
          action: "hover" as const,
          target: {
            primary: {
              type: "css" as const,
              operator: "equals" as const,
              value: "#header-1",
            },
          },
          fallbacks: [],
        },
        {
          action: "hover" as const,
          target: {
            primary: {
              type: "css" as const,
              operator: "equals" as const,
              value: "#header-2",
            },
          },
          fallbacks: [],
        },
      ],
      fallbacks: [
        {
          locator: {
            type: "text" as const,
            operator: "equals" as const,
            value: "Meniu",
          },
          humanDescription: "Text meniu",
          whyExplanation: "Alternativă semantică.",
        },
        {
          locator: {
            type: "role" as const,
            role: "button",
            operator: "equals" as const,
            value: "Meniu",
          },
          humanDescription: "Buton meniu",
          whyExplanation: "Alternativă ARIA.",
        },
      ],
      enabled: true,
    };

    render(
      <TestFlowEditor
        api={createApi()}
        projectId={test.projectId}
        test={{ ...test, flowItems: [action] }}
        onTestSaved={vi.fn()}
      />,
    );

    expect(screen.getAllByLabelText(/Locator hover \d strategie/)).toHaveLength(
      1,
    );
    expect(
      screen.getAllByLabelText(/Locator fallback \d strategie/),
    ).toHaveLength(1);
    await user.click(screen.getByRole("tab", { name: "Hover 2" }));
    expect(screen.getByLabelText("Locator hover 2 strategie")).not.toBeNull();
    await user.click(screen.getByRole("tab", { name: /2\. Buton meniu/ }));
    expect(
      screen.getByLabelText("Locator fallback 2 strategie"),
    ).not.toBeNull();
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

  it("edits and saves templated URLs for navigation actions", async () => {
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
    await user.selectOptions(screen.getByLabelText("Tip acțiune"), "navigate");

    const url = screen.getByLabelText("URL sau template");
    expect(url.getAttribute("value")).toBe("{{baseUrl}}");
    expect(screen.queryByLabelText("Locator principal strategie")).toBeNull();
    expect(screen.queryByText(/Fallback-uri/)).toBeNull();

    fireEvent.change(url, { target: { value: "{{payment_url}}" } });
    await user.click(
      screen.getByRole("button", { name: "Salvează flow-ul testului" }),
    );

    await waitFor(() => {
      expect(api.saveTestFlow).toHaveBeenCalledOnce();
    });
    expect(vi.mocked(api.saveTestFlow).mock.calls[0]?.[2][0]).toMatchObject({
      actionType: "navigate",
      url: "{{payment_url}}",
    });
  });

  it("inserts available variables at the URL cursor or appends them", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.listDatasets = vi.fn().mockResolvedValue([
      {
        id: "dataset-1",
        testId: test.id,
        name: "Date comandă",
        values: { order_id: { type: "fixed", value: "123" } },
        createdAt: test.createdAt,
        updatedAt: test.updatedAt,
      },
    ]);
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(screen.getByLabelText("Tip acțiune"), "navigate");
    const urlElement = screen.getByLabelText("URL sau template");
    if (!(urlElement instanceof HTMLInputElement)) {
      throw new Error("URL editor is not an input.");
    }
    const url = urlElement;
    await user.clear(url);
    await user.type(url, "https://example.test//details");
    url.selectionStart = 21;
    url.selectionEnd = 21;
    await user.click(
      await screen.findByRole("button", { name: "{{order_id}}" }),
    );
    expect(url.value).toBe("https://example.test/{{order_id}}/details");

    fireEvent.blur(url);
    await user.click(screen.getByRole("button", { name: "{{runId}}" }));
    expect(url.value).toBe(
      "https://example.test/{{order_id}}/details{{runId}}",
    );
  });

  it("replays prior steps before opening the visual region selector", async () => {
    const user = userEvent.setup();
    const api = createApi();
    api.captureVisualStepContext = vi.fn().mockResolvedValue({
      imageBase64: Buffer.from("visual-context").toString("base64"),
      mimeType: "image/jpeg",
      viewportWidth: 1280,
      viewportHeight: 720,
      capturedAt: "2026-07-24T12:00:00.000Z",
    });
    render(
      <TestFlowEditor
        api={api}
        projectId={test.projectId}
        test={test}
        onTestSaved={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "+ Adaugă pas" }));
    await user.selectOptions(screen.getByLabelText("Tip acțiune"), "visual_ai");
    await user.type(
      screen.getByLabelText("Ce trebuie să facă AI-ul"),
      "Selectează prima zi disponibilă.",
    );
    await user.click(
      screen.getByRole("button", { name: "Capturează zona vizuală" }),
    );

    expect(api.captureVisualStepContext).toHaveBeenCalledWith(
      test.projectId,
      test.id,
      expect.any(String),
      expect.arrayContaining([
        expect.objectContaining({
          actionType: "visual_ai",
          visualInstruction: "Selectează prima zi disponibilă.",
        }),
      ]),
    );
    expect(
      await screen.findByRole("dialog", {
        name: "Selectează zona văzută de AI",
      }),
    ).not.toBeNull();
  });

  it("shows AI editing only for tests explicitly marked dynamic", () => {
    const recorded = {
      ...test,
      flowItems: [
        {
          id: "step-1",
          type: "action" as const,
          actionType: "click" as const,
          title: "Alege ziua",
          humanDescription: "Apasă ziua.",
          whyExplanation: "Selectează data.",
          target: {
            primary: {
              type: "text" as const,
              operator: "equals" as const,
              value: "15",
            },
          },
          fallbacks: [],
          enabled: true,
        },
      ],
    };
    const { unmount } = render(
      <TestFlowEditor
        api={createApi()}
        projectId={recorded.projectId}
        test={recorded}
        onTestSaved={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Editează cu AI" })).toBeNull();
    unmount();

    render(
      <TestFlowEditor
        api={createApi()}
        projectId={recorded.projectId}
        test={{ ...recorded, testMode: "dynamic_ai" }}
        onTestSaved={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Editează cu AI" }),
    ).not.toBeNull();
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
    await user.click(screen.getByRole("button", { name: /1\. Breakpoint/ }));
    await user.click(screen.getByRole("button", { name: "Acțiuni pas" }));
    await user.click(
      screen.getByRole("menuitem", { name: "Mută pasul în jos" }),
    );
    await user.click(screen.getByLabelText("Activ"));
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
