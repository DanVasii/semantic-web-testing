// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  Project,
  TestDefinition,
  TestRun,
} from "../shared/persistence.js";
import type { RunnerSnapshot } from "../shared/runner.js";
import { RunnerPanel } from "./RunnerPanel.js";

const project: Project = {
  id: "project-1",
  name: "Magazin",
  baseUrl: "https://example.test",
  normalizedBaseUrl: "https://example.test/",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};

const test: TestDefinition = {
  id: "test-1",
  projectId: project.id,
  name: "Checkout",
  status: "valid",
  version: 2,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: "https://example.test/products",
  normalizedStartUrl: "https://example.test/products",
  workflowState: "ready",
  createdAt: "2026-07-24T10:00:00.000Z",
  updatedAt: "2026-07-24T10:00:00.000Z",
  flowItems: [
    {
      id: "step-1",
      type: "action",
      actionType: "click",
      title: "Checkout",
      humanDescription: "Apasă checkout.",
      whyExplanation: "Continuă testul.",
      target: {
        primary: { type: "css", operator: "equals", value: "#checkout" },
      },
      fallbacks: [],
      enabled: true,
    },
  ],
};

const run: TestRun = {
  id: "run-1",
  projectId: test.projectId,
  testId: test.id,
  testVersion: test.version,
  startedAt: "2026-07-24T12:00:00.000Z",
  status: "running",
  browserType: "chromium",
  pageVersionIds: [],
};

const snapshot = (overrides: Partial<RunnerSnapshot> = {}): RunnerSnapshot => ({
  state: "running",
  run,
  currentStepIndex: 0,
  totalSteps: 1,
  currentStepId: "step-1",
  canStop: true,
  canRetry: false,
  ...overrides,
});

afterEach(cleanup);

describe("RunnerPanel", () => {
  it("asks for the browser configuration before opening the run dialog", async () => {
    const user = userEvent.setup();
    const getBrowserStatus = vi.fn().mockResolvedValue({ state: "idle" });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      getBrowserStatus,
      onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
      detectBrowsers: vi.fn().mockResolvedValue([
        {
          installationId: "system:chrome",
          id: "chrome",
          displayName: "Google Chrome",
          engine: "chromium",
          source: "system",
          installed: true,
          supported: true,
          executablePath: "C:\\Browsers\\chrome.exe",
        },
      ]),
      launchBrowser: vi.fn().mockResolvedValue({
        id: "session-1",
        projectId: project.id,
        browser: "chrome",
        engine: "chromium",
        sessionMode: "temporary",
        startedAt: "2026-07-24T12:00:00.000Z",
      }),
      openProjectUrl: vi.fn().mockResolvedValue({
        state: "opened",
        tab: {
          id: "tab-1",
          projectId: project.id,
          url: project.normalizedBaseUrl,
        },
      }),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );

    expect(
      await screen.findByRole("dialog", {
        name: "Pornește browserul pentru test",
      }),
    ).not.toBeNull();
    expect(screen.queryByText("Configurează rularea")).toBeNull();
    expect(await screen.findByLabelText("Browser disponibil")).not.toBeNull();

    await user.click(
      screen.getByRole("button", { name: "Pornește și deschide" }),
    );

    expect(api.launchBrowser).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: project.id,
        browser: "chrome",
        sessionMode: "temporary",
      }),
    );
    expect(
      await screen.findByRole("dialog", { name: "Configurează rularea" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("dialog", {
        name: "Pornește browserul pentru test",
      }),
    ).toBeNull();
  });

  it("opens run configuration directly when this project's browser is running", async () => {
    const user = userEvent.setup();
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      getBrowserStatus: vi.fn().mockResolvedValue({
        state: "running",
        projectId: project.id,
        browser: "chrome",
      }),
      onBrowserStatusChange: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );

    expect(
      await screen.findByRole("dialog", { name: "Configurează rularea" }),
    ).not.toBeNull();
    expect(screen.queryByText("Pornește browserul pentru test")).toBeNull();
    expect(
      screen.queryByRole("combobox", {
        name: "Provider AI pentru această rulare",
      }),
    ).toBeNull();
  });

  it("selects the AI provider and model per run for adaptive visual checks", async () => {
    const user = userEvent.setup();
    const startRun = vi.fn().mockResolvedValue(snapshot());
    const adaptiveTest: TestDefinition = {
      ...test,
      flowItems: [
        ...test.flowItems,
        {
          id: "check-adaptive-validation",
          type: "check",
          checkType: "adaptive",
          title: "Confirmă validarea formularului",
          humanDescription: "Confirmă vizual mesajul de validare.",
          config: {
            strategy: "auto",
            expectedTexts: [],
            matchMode: "any",
            visualPrompt: "Confirmă mesajul de validare pentru prenume.",
            visualFallback: true,
            minimumConfidence: 0.6,
          },
          enabled: true,
        },
      ],
    };
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      getAiSettings: vi.fn().mockResolvedValue({
        provider: "lm_studio",
        ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
        lmStudio: {
          baseUrl: "http://127.0.0.1:1234",
          model: "local-default",
        },
        gemini: { model: "gemini-default", apiKeyConfigured: true },
      }),
      listAiModels: vi.fn((provider: string) =>
        Promise.resolve(
          provider === "gemini"
            ? [{ id: "gemini-flash", displayName: "Gemini Flash" }]
            : [{ id: "local-default", displayName: "Local Default" }],
        ),
      ),
      startRun,
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={adaptiveTest} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    const providerSelect = await screen.findByRole<HTMLSelectElement>(
      "combobox",
      { name: "Provider AI pentru această rulare" },
    );
    await waitFor(() => {
      expect(providerSelect.value).toBe("lm_studio");
    });

    await user.selectOptions(providerSelect, "gemini");
    const modelSelect = await screen.findByRole<HTMLSelectElement>("combobox", {
      name: "Model AI pentru această rulare",
    });
    await waitFor(() => {
      expect(modelSelect.value).toBe("gemini-flash");
    });
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        aiProvider: "gemini",
        aiModel: "gemini-flash",
      }),
    );
  });

  it("starts, stops and retries the current step from live state updates", async () => {
    const user = userEvent.setup();
    let listener: ((next: RunnerSnapshot) => void) | undefined;
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn(
        (callback: (next: RunnerSnapshot) => void) => {
          listener = callback;
          return vi.fn();
        },
      ),
      startRun: vi.fn().mockResolvedValue(snapshot()),
      stopRun: vi.fn().mockResolvedValue(
        snapshot({
          state: "stopped",
          run: { ...run, status: "stopped" },
          canStop: false,
        }),
      ),
      retryRunStep: vi.fn().mockResolvedValue(snapshot()),
      skipRunStep: vi.fn().mockResolvedValue(
        snapshot({
          state: "paused_on_error",
          run: { ...run, status: "failed" },
          canStop: true,
          canRetry: true,
        }),
      ),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));
    expect(api.startRun).toHaveBeenCalledWith({
      projectId: test.projectId,
      testId: test.id,
      mode: "automatic",
      waitBeforeStart: false,
    });
    expect(screen.getByText("Execuție curentă")).not.toBeNull();
    expect(screen.getByText("În curs")).not.toBeNull();
    await user.click(
      await screen.findByRole("button", { name: "Oprește testul" }),
    );
    expect(api.stopRun).toHaveBeenCalledWith(run.id);

    act(() => {
      listener?.(
        snapshot({
          state: "paused_on_error",
          run: { ...run, status: "failed" },
          error: {
            code: "locator_ambiguous",
            message: "Locator ambiguu.",
            count: 2,
            stepId: "step-1",
            operation: "click",
            technicalDetails: "StepExecutionError: Locator ambiguu.",
            occurredAt: "2026-07-24T12:01:00.000Z",
            retryable: true,
            visualCheckDebug: {
              dataUrls: ["data:image/jpeg;base64,anBlZw=="],
              mimeType: "image/jpeg",
              byteLength: 4,
              prompt: "Confirmă mesajul Telefon invalid.",
            },
          },
          canStop: true,
          canRetry: true,
        }),
      );
    });
    expect(screen.getByText("Locator ambiguu. (2 rezultate)")).not.toBeNull();
    expect(screen.getByText("Rularea este oprită la eroare")).not.toBeNull();
    expect(screen.getByText("Poate fi reîncercată")).not.toBeNull();
    expect(screen.getByText("Detalii tehnice")).not.toBeNull();
    expect(
      screen.getAllByText("Vezi capturile trimise către AI (1)").length,
    ).toBeGreaterThan(0);
    expect(
      screen
        .getAllByRole("img", { name: "Captura 1 trimisă către AI" })[0]
        ?.getAttribute("src"),
    ).toBe("data:image/jpeg;base64,anBlZw==");
    expect(
      screen.getByText(/Browserul rămâne deschis pentru verificare/),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Sari peste pas" }));
    expect(api.skipRunStep).toHaveBeenCalledWith(run.id);
    await user.click(
      screen.getByRole("button", { name: "Reîncearcă pasul curent" }),
    );
    expect(api.retryRunStep).toHaveBeenCalledWith(run.id);

    act(() => {
      listener?.(
        snapshot({
          state: "paused_on_error",
          run: { ...run, status: "failed" },
          error: {
            code: "step_failed",
            message: "AI a detectat o eroare vizibilă în pagină.",
            severity: "warning",
            retryable: true,
          },
          canStop: true,
          canRetry: true,
        }),
      );
    });
    expect(screen.getByText(/Warning vizual/)).not.toBeNull();
    expect(screen.getByText("Rularea așteaptă decizia ta")).not.toBeNull();
    await user.click(
      screen.getByRole("button", { name: "Continuă cu următorul pas" }),
    );
    expect(api.skipRunStep).toHaveBeenCalledTimes(2);
  });

  it("lets the user clear the browser session for only the selected run", async () => {
    const user = userEvent.setup();
    const startRun = vi.fn().mockResolvedValue(snapshot());
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      startRun,
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    await user.click(
      screen.getByRole("checkbox", {
        name: /Curăță sesiunea înainte de rulare/,
      }),
    );
    expect(screen.getByText("Curățare sesiune: activată")).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({ clearSessionBeforeRun: true }),
    );
  });

  it("selects the recorder dataset and its matching global IMAP account automatically", async () => {
    const user = userEvent.setup();
    const startRun = vi.fn().mockResolvedValue(snapshot());
    const imapTest: TestDefinition = {
      ...test,
      postRunChecks: {
        aiPrompt: "",
        mysql: {
          enabled: false,
          tableNames: [],
          identities: [],
        },
        imap: {
          inboxes: [],
          enabled: true,
          accountIds: [],
          mailbox: "INBOX",
          sender: "",
          recipient: "",
          subjectEquals: "",
          subjectContains: "Confirmare",
          bodyContains: "",
        },
      },
    };
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([
        {
          id: "dataset-manual",
          testId: test.id,
          name: "Client manual",
          values: {},
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T10:00:00.000Z",
        },
        {
          id: "dataset-recorder",
          testId: test.id,
          name: "Înregistrare recorder",
          values: {
            customer_email: {
              type: "fixed",
              value: "ana@example.test",
            },
          },
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T10:00:00.000Z",
        },
      ]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      listImapAccounts: vi.fn().mockResolvedValue([
        {
          id: "imap-ana",
          name: "Ana",
          host: "imap.example.test",
          port: 993,
          secure: true,
          username: "ana@example.test",
          mailbox: "INBOX",
          passwordConfigured: true,
        },
      ]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      startRun,
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={imapTest} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    const datasetSelect = screen.getByRole<HTMLSelectElement>("combobox", {
      name: "Dataset",
    });
    await waitFor(() => {
      expect(datasetSelect.value).toBe("dataset-recorder");
      expect(
        screen.getByRole<HTMLInputElement>("checkbox", { name: /Ana/i })
          .checked,
      ).toBe(true);
    });
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));

    expect(startRun).toHaveBeenCalledWith({
      projectId: project.id,
      testId: test.id,
      datasetId: "dataset-recorder",
      mode: "automatic",
      waitBeforeStart: false,
      postRun: {
        mysql: false,
        imap: true,
        imapAccountIds: ["imap-ana"],
        ai: false,
        provider: "none",
        model: "",
      },
    });
  });

  it("uses staged MySQL checks in the run configuration", async () => {
    const user = userEvent.setup();
    const startRun = vi.fn().mockResolvedValue(snapshot());
    const stagedMysqlTest: TestDefinition = {
      ...test,
      postRunChecks: {
        aiPrompt: "",
        mysql: { enabled: false, tableNames: [], identities: [] },
        imap: {
          inboxes: [],
          enabled: false,
          accountIds: [],
          mailbox: "INBOX",
          sender: "",
          recipient: "",
          subjectEquals: "",
          subjectContains: "",
          bodyContains: "",
        },
      },
      stages: [
        {
          id: "stage-main",
          name: "Flow principal",
          enabled: true,
          entry: { type: "test_start" },
          flowItems: test.flowItems,
          postChecks: [
            {
              id: "mysql-orders",
              type: "check",
              checkType: "mysql",
              title: "Verifică comenzile",
              humanDescription: "Compară comenzile cu baseline-ul.",
              config: {
                tableNames: ["orders"],
                identities: [{ tableName: "orders", columns: ["id"] }],
              },
              enabled: true,
              required: true,
            },
          ],
        },
      ],
    };
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      startRun,
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={stagedMysqlTest} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    const mysql = screen.getByRole<HTMLInputElement>("checkbox", {
      name: "MySQL snapshot",
    });
    expect(mysql.disabled).toBe(false);
    expect(mysql.checked).toBe(true);

    await user.click(mysql);
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));

    expect(startRun).toHaveBeenCalledWith(
      expect.objectContaining({
        postRun: {
          mysql: false,
          imap: false,
          imapAccountIds: [],
          ai: false,
          provider: "none",
          model: "",
        },
      }),
    );
  });

  it("previews and explicitly sends a temporary AI plan before running", async () => {
    const user = userEvent.setup();
    const dynamicTest: TestDefinition = {
      ...test,
      testMode: "dynamic_ai",
    };
    const proposal = {
      summary: "Selectează temporar 15 septembrie.",
      changes: [
        {
          stepId: "step-1",
          patch: {
            primaryLocator: {
              type: "data_attribute" as const,
              attribute: "data-testid",
              operator: "equals" as const,
              value: "calendar-day-2027-09-15",
            },
          },
          rationale: "Alege data cerută.",
        },
      ],
      insertions: [
        {
          anchorStepId: "step-1",
          position: "before" as const,
          action: {
            actionType: "click" as const,
            title: "Navighează dinamic la septembrie",
            humanDescription: "Apasă Next până la luna cerută.",
            whyExplanation: "Folosește markerul vizual.",
            primaryLocator: {
              type: "data_attribute" as const,
              attribute: "data-testid",
              operator: "equals" as const,
              value: "calendar-next-month",
            },
            repeatUntil: {
              target: {
                type: "css" as const,
                operator: "equals" as const,
                value: "#calendar-heading",
              },
              operator: "equals" as const,
              value: "septembrie 2027",
              maxAttempts: 24,
            },
          },
          rationale: "Pasul lipsește din flow.",
        },
      ],
    };
    const previewAiRunPlan = vi.fn().mockResolvedValue({
      request: {
        task: "adapt_run",
        provider: "gemini",
        model: "gemini-flash",
        systemInstruction: "JSON only",
        prompt: "Adapt run",
        outputSchema: {},
        contextPreview: {},
        estimatedInputTokens: 140,
        originalContextBytes: 700,
        sentContextBytes: 500,
        omittedPaths: [],
      },
      stepIds: ["step-1"],
      pageIds: [],
    });
    const generateAiRunPlan = vi.fn().mockResolvedValue({
      provider: "gemini",
      model: "gemini-flash",
      proposal,
      usage: { inputTokens: 150, outputTokens: 50, totalTokens: 200 },
    });
    const runtimeFlowItems: TestDefinition["flowItems"] = [
      {
        id: "ai-run-insert-1",
        type: "action",
        actionType: "click",
        title: "Navighează dinamic la septembrie",
        humanDescription: "Apasă Next până la luna cerută.",
        whyExplanation: "Folosește markerul vizual.",
        target: {
          primary: {
            type: "data_attribute",
            attribute: "data-testid",
            operator: "equals",
            value: "calendar-next-month",
          },
        },
        repeatUntil: {
          target: {
            type: "css",
            operator: "equals",
            value: "#calendar-heading",
          },
          operator: "equals",
          value: "septembrie 2027",
          maxAttempts: 24,
        },
        fallbacks: [],
        enabled: true,
      },
      ...dynamicTest.flowItems,
    ];
    const startRun = vi.fn().mockResolvedValue(
      snapshot({
        currentStepId: "ai-run-insert-1",
        totalSteps: 2,
        flowItems: runtimeFlowItems,
      }),
    );
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      getAiSettings: vi.fn().mockResolvedValue({
        provider: "gemini",
        ollama: { baseUrl: "http://127.0.0.1:11434", model: "" },
        lmStudio: { baseUrl: "http://127.0.0.1:1234", model: "" },
        gemini: { model: "gemini-flash", apiKeyConfigured: true },
      }),
      listAiModels: vi
        .fn()
        .mockResolvedValue([
          { id: "gemini-flash", displayName: "Gemini Flash" },
        ]),
      previewAiRunPlan,
      generateAiRunPlan,
      startRun,
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={dynamicTest} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    await user.type(
      screen.getByRole("textbox", {
        name: "Ce trebuie schimbat la rularea aceasta?",
      }),
      "Selectează 15 septembrie 2027.",
    );
    await user.click(screen.getByRole("button", { name: "1. Preview AI" }));
    expect(previewAiRunPlan).toHaveBeenCalled();
    expect(generateAiRunPlan).not.toHaveBeenCalled();
    expect(await screen.findByText(/140 tokeni estimați/)).not.toBeNull();

    await user.click(screen.getByRole("button", { name: "2. Trimite la AI" }));
    expect(await screen.findByText(/200 tokeni/)).not.toBeNull();
    expect(screen.getByText(/1 pași adăugați temporar/)).not.toBeNull();
    expect(
      screen.getByText("Pas nou: Navighează dinamic la septembrie"),
    ).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));
    expect(screen.getByText("2 pași")).not.toBeNull();

    expect(startRun).toHaveBeenCalledWith({
      projectId: project.id,
      testId: test.id,
      mode: "automatic",
      waitBeforeStart: false,
      aiPlan: {
        baseVersion: test.version,
        instruction: "Selectează 15 septembrie 2027.",
        proposal,
      },
      aiProvider: "gemini",
      aiModel: "gemini-flash",
    });
  });

  it("shows persisted run history and step logs", async () => {
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(
        snapshot({
          state: "completed",
          run: { ...run, status: "passed" },
          currentStepIndex: 1,
          canStop: false,
        }),
      ),
      listTestRuns: vi.fn().mockResolvedValue([{ ...run, status: "passed" }]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([
        {
          id: "result-1",
          runId: run.id,
          stepId: "step-1",
          status: "passed",
          logs: [{ level: "info", message: "Click executat." }],
        },
      ]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await waitFor(() => {
      expect(screen.getByText(/v2 · passed/)).not.toBeNull();
    });
    expect(screen.getByText("Execuție curentă")).not.toBeNull();
    expect(screen.getByText("Acțiune · Click")).not.toBeNull();
    expect(screen.getByText("Finalizat")).not.toBeNull();
    expect(screen.getByText("• Click executat.")).not.toBeNull();
    expect(screen.getByText("Rezultate și logs (1)")).not.toBeNull();
  });

  it("shows only the current step and a compact preview of the next one", async () => {
    const baseStep = test.flowItems[0]!;
    const flowItems: TestDefinition["flowItems"] = [
      { ...structuredClone(baseStep), id: "step-1", title: "Pas anterior" },
      { ...structuredClone(baseStep), id: "step-2", title: "Pas activ" },
      { ...structuredClone(baseStep), id: "step-3", title: "Pas următor" },
      { ...structuredClone(baseStep), id: "step-4", title: "Pas ulterior" },
    ];
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(
        snapshot({
          currentStepIndex: 1,
          currentStepId: "step-2",
          totalSteps: flowItems.length,
          flowItems,
        }),
      ),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
    } as unknown as SemanticAppApi;

    render(
      <RunnerPanel api={api} project={project} test={{ ...test, flowItems }} />,
    );

    expect(
      await screen.findByRole("article", { name: "Pasul curent" }),
    ).not.toBeNull();
    expect(
      screen.getByRole("article", { name: "Pasul următor" }),
    ).not.toBeNull();
    expect(screen.getByText("Pas activ")).not.toBeNull();
    expect(screen.getByText("Pas următor")).not.toBeNull();
    expect(screen.queryByText("Pas anterior")).toBeNull();
    expect(screen.queryByText("Pas ulterior")).toBeNull();
  });

  it("shows the current fallback and supports Run and Skip decisions", async () => {
    const user = userEvent.setup();
    const fallbackSnapshot = snapshot({
      state: "waiting_for_fallback_decision",
      error: {
        code: "locator_not_found",
        message: "Locatorul principal nu a găsit elementul.",
        count: 0,
      },
      fallback: {
        index: 0,
        total: 2,
        humanDescription: "Buton alternativ",
        whyExplanation: "Selector semantic secundar.",
        locator: {
          type: "css",
          operator: "equals",
          value: "#fallback",
        },
      },
      canStop: true,
    });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(fallbackSnapshot),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      runCurrentFallback: vi.fn().mockResolvedValue(fallbackSnapshot),
      skipCurrentFallback: vi.fn().mockResolvedValue(
        snapshot({
          ...fallbackSnapshot,
          fallback: {
            ...fallbackSnapshot.fallback!,
            index: 1,
          },
        }),
      ),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    expect(await screen.findByText("Fallback 1 din 2")).not.toBeNull();
    expect(screen.getByText("Buton alternativ")).not.toBeNull();
    expect(screen.getByText(/#fallback/)).not.toBeNull();
    await user.click(screen.getByRole("button", { name: "Rulează fallback" }));
    expect(api.runCurrentFallback).toHaveBeenCalledWith(run.id);
    await user.click(
      screen.getByRole("button", { name: "Sari peste fallback" }),
    );
    expect(api.skipCurrentFallback).toHaveBeenCalledWith(run.id);
  });

  it("configures run mode, wait-before-start and the Continue shortcut", async () => {
    const user = userEvent.setup();
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      startRun: vi.fn().mockResolvedValue(snapshot()),
      configureRunnerShortcut: vi.fn().mockResolvedValue("Alt+Enter"),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.selectOptions(
      await screen.findByLabelText("Mod de rulare"),
      "step_by_step",
    );
    await user.click(screen.getByLabelText("Așteaptă înainte de primul pas"));
    const shortcutInput = screen.getByLabelText("Shortcut Continue");
    await user.clear(shortcutInput);
    await user.type(shortcutInput, "alt+enter");
    await user.click(screen.getByRole("button", { name: "Salvează" }));
    expect(api.configureRunnerShortcut).toHaveBeenCalledWith(
      project.id,
      "alt+enter",
    );

    await user.click(screen.getByRole("button", { name: "Rulează testul" }));
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));
    expect(api.startRun).toHaveBeenCalledWith({
      projectId: project.id,
      testId: test.id,
      mode: "step_by_step",
      waitBeforeStart: true,
    });
  });

  it("continues a breakpoint with the button or Ctrl+Enter", async () => {
    const user = userEvent.setup();
    const waiting = snapshot({
      state: "waiting_at_breakpoint",
      pause: {
        kind: "breakpoint",
        title: "Verifică pagina",
        instructions: "Confirmă vizual rezultatul.",
        previousStepId: "step-previous",
        nextStepId: "step-next",
      },
    });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(waiting),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      continueRun: vi.fn().mockResolvedValue(waiting),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    expect(await screen.findByText("Verifică pagina")).not.toBeNull();
    expect(screen.getByText("step-previous")).not.toBeNull();
    expect(screen.getByText("step-next")).not.toBeNull();
    await user.keyboard("{Control>}{Enter}{/Control}");
    expect(api.continueRun).toHaveBeenCalledWith(run.id);
    await user.click(
      screen.getByRole("button", { name: "Continuă (Ctrl+Enter)" }),
    );
    expect(api.continueRun).toHaveBeenCalledTimes(2);
  });

  it("selects a dataset or no dataset and shows the missing-data prompt", async () => {
    const user = userEvent.setup();
    let statusListener: ((next: RunnerSnapshot) => void) | undefined;
    const waiting = snapshot({
      state: "waiting_for_missing_data",
      error: {
        code: "missing_data",
        message: "Valoarea lipsește.",
        stepId: "step-1",
      },
      missingData: {
        fieldId: "customer_password",
        valueKey: "customer_password",
        inputKind: "password",
        locator: {
          type: "css",
          operator: "equals",
          value: "#password",
        },
      },
      canStop: true,
      canRetry: false,
    });
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue({
        state: "idle",
        currentStepIndex: -1,
        totalSteps: 0,
        canStop: false,
        canRetry: false,
      }),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([
        {
          id: "dataset-1",
          testId: test.id,
          name: "Client standard",
          values: {},
          createdAt: "2026-07-24T10:00:00.000Z",
          updatedAt: "2026-07-24T10:00:00.000Z",
        },
      ]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn(
        (callback: (next: RunnerSnapshot) => void) => {
          statusListener = callback;
          return vi.fn();
        },
      ),
      startRun: vi.fn().mockResolvedValue(snapshot()),
      continueRun: vi.fn().mockResolvedValue(waiting),
    } as unknown as SemanticAppApi;
    render(<RunnerPanel api={api} project={project} test={test} />);

    await user.click(
      await screen.findByRole("button", { name: "Rulează testul" }),
    );
    const datasetSelect = screen.getByLabelText("Dataset");
    expect(screen.getByRole("option", { name: "Fără dataset" })).not.toBeNull();
    await user.selectOptions(datasetSelect, "dataset-1");
    await user.click(screen.getByRole("button", { name: "Pornește rularea" }));
    expect(api.startRun).toHaveBeenCalledWith({
      projectId: project.id,
      testId: test.id,
      datasetId: "dataset-1",
      mode: "automatic",
      waitBeforeStart: false,
    });

    act(() => {
      statusListener?.(waiting);
    });
    expect(screen.getByText("customer_password")).not.toBeNull();
    expect(screen.getByText("password")).not.toBeNull();
    expect(screen.getByText(/#password/)).not.toBeNull();
    expect(screen.getByText(/salvată local în clar/)).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Continuă (Ctrl+Enter)" }),
    ).not.toBeNull();
  });

  it("offers selective wipe only from the post-run dialog", async () => {
    const user = userEvent.setup();
    const completed: RunnerSnapshot = {
      state: "completed",
      run: {
        id: "run-1",
        projectId: project.id,
        testId: test.id,
        testVersion: test.version,
        startedAt: "2026-07-25T10:00:00.000Z",
        endedAt: "2026-07-25T10:00:02.000Z",
        status: "passed",
        browserType: "chromium",
        pageVersionIds: [],
      },
      currentStepIndex: 1,
      totalSteps: 1,
      canStop: false,
      canRetry: false,
    };
    const afterWipe: RunnerSnapshot = {
      ...completed,
      cleanup: {
        origin: "https://example.test",
        status: "completed",
        entries: [
          {
            resource: "cookies",
            status: "cleared",
            message: "Cookie-urile origin-ului au fost șterse.",
            count: 2,
          },
        ],
      },
    };
    const api = {
      getRunnerStatus: vi.fn().mockResolvedValue(completed),
      listTestRuns: vi.fn().mockResolvedValue([]),
      listDatasets: vi.fn().mockResolvedValue([]),
      listRunStepResults: vi.fn().mockResolvedValue([]),
      onRunnerStatusChange: vi.fn().mockReturnValue(vi.fn()),
      manualWipeRunData: vi.fn().mockResolvedValue(afterWipe),
    } as unknown as SemanticAppApi;
    render(
      <RunnerPanel
        api={api}
        project={project}
        test={{ ...test, wipeBeforeRun: true }}
      />,
    );

    await user.click(
      await screen.findByRole("button", { name: "Verificări post-run" }),
    );
    expect(
      screen.getByRole("dialog", { name: "Verificări post-run" }),
    ).not.toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /Wipe înainte de test/ }),
    ).toBeNull();
    await user.click(screen.getByRole("checkbox", { name: "Cookies" }));
    await user.click(
      screen.getByRole("button", { name: "Wipe date selectate" }),
    );
    expect(api.manualWipeRunData).toHaveBeenCalledWith("run-1", ["cookies"]);
    expect(await screen.findByText("Wipe finalizat")).not.toBeNull();
  });
});
