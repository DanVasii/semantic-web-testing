import type { JsonValue, TestDefinition } from "../../shared/persistence.js";
import type {
  AnalyzedForm,
  AnalyzedFormField,
  CreateGeneratedFormTestsInput,
  CreateGeneratedFormTestsResult,
  FormDataDefaults,
  FormTestGenerationResult,
  FormTestScenarioProposal,
  GenerateFormTestsInput,
} from "../../shared/form-analysis.js";
import { defaultTestPostRunChecks } from "../../shared/post-run-checks.js";
import type {
  ActionStep,
  CheckStep,
  DatasetPrimitive,
  DatasetValue,
  FileDatasetValue,
  TestFlowItem,
} from "../../shared/test-model.js";
import { AiSettingsService } from "./ai-settings-service.js";
import { FORM_TEST_GENERATION_OUTPUT_SCHEMA } from "./ai-output.js";
import { PageAnalysisService } from "../page-analysis/page-analysis-service.js";
import {
  ImapAccountRepository,
  ProjectRepository,
} from "../persistence/repositories.js";
import { ProjectFormSettingsRepository } from "../persistence/form-settings-repository.js";
import { TestsService } from "../tests-service.js";
import { DefaultTestFilesService } from "../default-test-files-service.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, label: string, max: number): string => {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > max
  ) {
    throw new Error(`Răspunsul AI conține ${label} invalid.`);
  }
  return value.trim();
};

const stringArray = (value: unknown, allowed: Set<string>): string[] => {
  if (!Array.isArray(value) || value.length > 100) {
    throw new Error("Răspunsul AI conține o listă de câmpuri invalidă.");
  }
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === "string"),
    ),
  ].filter((item) => allowed.has(item));
};

export const normalizeFormTestProposal = (
  value: unknown,
  form: AnalyzedForm,
  expectEmail: boolean,
): { summary: string; scenarios: FormTestScenarioProposal[] } => {
  if (!isRecord(value) || !Array.isArray(value.scenarios)) {
    throw new Error("Răspunsul AI pentru formular nu este valid.");
  }
  const fields = new Map(form.fields.map((field) => [field.id, field]));
  const allowed = new Set(fields.keys());
  const ids = new Set<string>();
  const scenarios = value.scenarios.slice(0, 20).map((raw, index) => {
    if (!isRecord(raw) || !Array.isArray(raw.values)) {
      throw new Error("AI a generat un scenariu invalid.");
    }
    let id = text(raw.id, "un ID de scenariu", 100).replaceAll(
      /[^a-zA-Z0-9_-]/g,
      "-",
    );
    if (ids.has(id)) id = `${id}-${index + 1}`;
    ids.add(id);
    const kind = raw.kind === "valid" ? "valid" : "negative";
    const values = raw.values.slice(0, 100).flatMap((entry) => {
      if (!isRecord(entry) || typeof entry.fieldId !== "string") return [];
      const field = fields.get(entry.fieldId);
      if (
        field === undefined ||
        field.semanticType === "email" ||
        field.inputType === "file" ||
        !["string", "number", "boolean"].includes(typeof entry.value)
      ) {
        return [];
      }
      return [
        {
          fieldId: entry.fieldId,
          value: entry.value as string | number | boolean,
        },
      ];
    });
    const omittedFieldIds = stringArray(raw.omittedFieldIds, allowed).filter(
      (fieldId) =>
        kind === "negative" || fields.get(fieldId)?.required !== true,
    );
    const invalidFieldIds = (
      kind === "valid" ? [] : stringArray(raw.invalidFieldIds, allowed)
    ).filter((fieldId) => {
      const field = fields.get(fieldId);
      return (
        field !== undefined &&
        !["file", "checkbox", "radio"].includes(field.inputType)
      );
    });
    const expectedMessages = Array.isArray(raw.expectedMessages)
      ? raw.expectedMessages
          .filter((message): message is string => typeof message === "string")
          .map((message) => message.trim())
          .filter((message) => message.length > 0)
          .slice(0, 20)
      : [];
    return {
      id,
      name: text(raw.name, "un nume de scenariu", 120),
      description:
        typeof raw.description === "string"
          ? raw.description.trim().slice(0, 1000)
          : "",
      kind,
      values,
      omittedFieldIds,
      invalidFieldIds,
      expectedMessages,
      expectEmail:
        kind === "valid" &&
        expectEmail &&
        form.fields.some(({ semanticType }) => semanticType === "email"),
    } satisfies FormTestScenarioProposal;
  });
  if (scenarios.length === 0) {
    throw new Error("AI nu a generat niciun scenariu pentru formular.");
  }
  return { summary: text(value.summary, "un rezumat", 2000), scenarios };
};

const defaultKeyFor = (
  field: AnalyzedFormField,
): keyof FormDataDefaults | undefined => {
  switch (field.semanticType) {
    case "first_name":
      return "firstName";
    case "last_name":
      return "lastName";
    case "full_name":
      return "fullName";
    case "phone":
      return "phone";
    case "company":
      return "company";
    case "address":
      return "address";
    case "city":
      return "city";
    case "county":
      return "county";
    case "postal_code":
      return "postalCode";
    case "country":
      return "country";
    case "password":
      return "password";
    case "message":
      return "message";
    default:
      return undefined;
  }
};

const fallbackValue = (field: AnalyzedFormField): DatasetPrimitive => {
  if (field.options.length > 0) {
    return (
      field.options.find(({ value }) => value.length > 0)?.value ??
      field.options[0]!.value
    );
  }
  switch (field.semanticType) {
    case "first_name":
      return "Andrei";
    case "last_name":
      return "Popescu";
    case "full_name":
      return "Andrei Popescu";
    case "phone":
      return "0722000000";
    case "company":
      return "Test Automation";
    case "address":
      return "Strada Testului 10";
    case "city":
      return "București";
    case "county":
      return "București";
    case "postal_code":
      return "010101";
    case "country":
      return "România";
    case "password":
      return "Test!2026Secure";
    case "message":
      return "Mesaj generat pentru test automat.";
    default:
      return "Valoare test";
  }
};

const invalidValue = (field: AnalyzedFormField): DatasetPrimitive => {
  if (field.semanticType === "email") return "email-invalid";
  if (field.semanticType === "phone") return "telefon-invalid";
  if (field.inputType === "number") return "invalid";
  if (field.minLength !== undefined && field.minLength > 1) return "x";
  if (field.maxLength !== undefined)
    return "x".repeat(Math.min(1000, field.maxLength + 1));
  return "!";
};

const action = (
  id: string,
  actionType: ActionStep["actionType"],
  title: string,
  field: AnalyzedFormField,
  valueKey?: string,
): ActionStep => ({
  id,
  type: "action",
  actionType,
  title,
  humanDescription: title,
  whyExplanation: "Pas construit din structura formularului analizat.",
  target: { primary: field.locator },
  ...(valueKey === undefined
    ? {}
    : { inputFieldId: valueKey, valueKey, valueStrategy: "dataset" as const }),
  fallbacks: [],
  enabled: true,
});

export const buildFormTestScenario = (
  form: AnalyzedForm,
  scenario: FormTestScenarioProposal,
  defaults: FormDataDefaults,
  emailAddress: string | undefined,
  account: { id: string; mailbox: string } | undefined,
  defaultFileForField?: (field: AnalyzedFormField) => FileDatasetValue,
): {
  flowItems: TestFlowItem[];
  dataset: Record<string, DatasetValue>;
  postRunChecks: ReturnType<typeof defaultTestPostRunChecks>;
} => {
  const values = new Map(
    scenario.values.map((entry) => [entry.fieldId, entry.value]),
  );
  const omitted = new Set(scenario.omittedFieldIds);
  const invalid = new Set(scenario.invalidFieldIds);
  const dataset: Record<string, DatasetValue> = {};
  const flowItems: TestFlowItem[] = [];
  form.fields.forEach((field, index) => {
    if (field.disabled || omitted.has(field.id)) return;
    const key = `form_field_${index + 1}`;
    if (["checkbox", "radio"].includes(field.inputType)) {
      flowItems.push(
        action(
          `form-check-${index + 1}`,
          "check",
          `Bifează „${field.label}”.`,
          field,
        ),
      );
      return;
    }
    if (field.inputType === "file") {
      if (defaultFileForField !== undefined) {
        dataset[key] = defaultFileForField(field);
      }
      flowItems.push(
        action(
          `form-file-${index + 1}`,
          "upload_file",
          `Încarcă un fișier în „${field.label}”.`,
          field,
          key,
        ),
      );
      return;
    }
    const preferredKey = defaultKeyFor(field);
    const value = invalid.has(field.id)
      ? invalidValue(field)
      : field.semanticType === "email"
        ? emailAddress
        : (values.get(field.id) ??
          (preferredKey === undefined ? undefined : defaults[preferredKey]) ??
          fallbackValue(field));
    if (value === undefined) return;
    dataset[key] = value;
    flowItems.push(
      action(
        `form-field-${index + 1}`,
        field.tag === "select" ? "select_option" : "fill",
        `Completează „${field.label}”.`,
        field,
        key,
      ),
    );
  });
  if (form.submit !== undefined) {
    flowItems.push({
      id: "form-submit",
      type: "action",
      actionType: "click",
      title: `Apasă „${form.submit.label}”.`,
      humanDescription: `Trimite formularul prin „${form.submit.label}”.`,
      whyExplanation:
        "Butonul de submit a fost detectat în formularul analizat.",
      target: { primary: form.submit.locator },
      fallbacks: [],
      enabled: true,
    });
  }
  const hasExpectedMessages = scenario.expectedMessages.length > 0;
  const visualPrompt = hasExpectedMessages
    ? `Confirmă că pagina afișează unul dintre mesajele: ${scenario.expectedMessages.join(", ")}.`
    : scenario.kind === "valid"
      ? `Confirmă vizual că formularul „${form.title}” a fost trimis cu succes. ${scenario.description} (Atenție: ignoră câmpurile goale, deoarece testul tocmai a apăsat pe trimitere și pagina s-a reîncărcat).`
      : `Confirmă vizual că formularul „${form.title}” afișează validarea așteptată și nu acceptă datele invalide. ${scenario.description}`;
  const check: CheckStep = {
    id: "form-result-check",
    type: "check",
    checkType: "adaptive",
    title:
      scenario.kind === "valid"
        ? "Confirmă rezultatul formularului"
        : "Confirmă validarea formularului",
    humanDescription: hasExpectedMessages
      ? scenario.expectedMessages.join(" sau ")
      : visualPrompt,
    config: {
      strategy: "auto",
      expectedTexts: scenario.expectedMessages,
      matchMode: "any",
      caseSensitive: false,
      ignoreDiacritics: true,
      visualPrompt,
      visualFallback: true,
      minimumConfidence: 0.6,
    },
    timeoutMs: 10_000,
    enabled: true,
  };
  flowItems.push(check);
  const postRunChecks = defaultTestPostRunChecks();
  if (
    scenario.expectEmail &&
    account !== undefined &&
    emailAddress !== undefined
  ) {
    postRunChecks.imap.enabled = true;
    postRunChecks.imap.inboxes = [
      {
        id: "generated-form-email",
        accountId: account.id,
        mailbox: account.mailbox,
        sender: "",
        recipient: emailAddress,
        subjectEquals: "",
        subjectContains: "",
        bodyContains: "",
      },
    ];
    postRunChecks.imap.accountIds = [account.id];
    postRunChecks.imap.recipient = emailAddress;
    postRunChecks.imap.mailbox = account.mailbox;
  }
  return { flowItems, dataset, postRunChecks };
};

export class FormTestGenerationService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly pages: PageAnalysisService,
    private readonly ai: AiSettingsService,
    private readonly tests: TestsService,
    private readonly imapAccounts: ImapAccountRepository,
    private readonly settings: ProjectFormSettingsRepository,
    private readonly defaultFiles: DefaultTestFilesService,
  ) {}

  public async generate(
    input: GenerateFormTestsInput,
  ): Promise<FormTestGenerationResult> {
    const form = await this.requireForm(
      input.projectId,
      input.pageId,
      input.formId,
    );
    const configured = this.settings.get(input.projectId);
    const accountId = input.imapAccountId ?? configured.defaultImapAccountId;
    const account =
      accountId === undefined
        ? undefined
        : this.imapAccounts.findById(accountId);
    const hasEmail = form.fields.some(
      ({ semanticType }) => semanticType === "email",
    );
    if (hasEmail && account === undefined) {
      throw new Error("Selectează un cont IMAP pentru câmpul de e-mail.");
    }
    if (
      account !== undefined &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.username)
    ) {
      throw new Error(
        "Utilizatorul contului IMAP nu este o adresă de e-mail validă.",
      );
    }
    const uniqueToken = crypto.randomUUID().slice(0, 8);
    const context = JSON.parse(
      JSON.stringify({
        objective:
          "Generează scenarii independente pentru formular. Include un caz valid, câmpuri obligatorii omise, formate invalide și limite deduse. Nu genera și nu returna valori pentru câmpurile email; aplicația le injectează din IMAP. Datele non-email trebuie să fie logice, coerente și unice pentru tokenul primit.",
        uniqueToken,
        instructions: input.instructions?.trim() ?? "",
        defaults: Object.fromEntries(
          Object.entries(configured.defaults).filter(
            ([key]) => key !== "password",
          ),
        ),
        form: {
          title: form.title,
          pageUrl: form.pageUrl,
          method: form.method,
          action: form.action,
          fields: form.fields.map((field) => ({
            id: field.id,
            label: field.label,
            name: field.name,
            tag: field.tag,
            inputType: field.inputType,
            semanticType: field.semanticType,
            required: field.required,
            pattern: field.pattern ?? "",
            minLength: field.minLength ?? null,
            maxLength: field.maxLength ?? null,
            min: field.min ?? "",
            max: field.max ?? "",
            step: field.step ?? "",
            accept: field.accept ?? "",
            multiple: field.multiple === true,
            options: field.options,
            emailValueManagedByApplication: field.semanticType === "email",
            fileValueManagedByApplication: field.inputType === "file",
          })),
        },
      }),
    ) as JsonValue;
    const generation = await this.ai.generate({
      task: "generate_form_tests",
      context,
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
      outputSchema: FORM_TEST_GENERATION_OUTPUT_SCHEMA,
    });
    const normalized = normalizeFormTestProposal(
      generation.output,
      form,
      input.expectEmail !== false && account !== undefined,
    );
    return {
      provider: generation.provider,
      model: generation.model,
      pageId: input.pageId,
      formId: input.formId,
      summary: normalized.summary,
      scenarios: normalized.scenarios,
      usage: generation.usage,
    };
  }

  public async create(
    input: CreateGeneratedFormTestsInput,
  ): Promise<CreateGeneratedFormTestsResult> {
    const form = await this.requireForm(
      input.projectId,
      input.pageId,
      input.formId,
    );
    const selected = new Set(input.selectedScenarioIds);
    const scenarios = input.scenarios.filter(({ id }) => selected.has(id));
    if (scenarios.length === 0)
      throw new Error("Selectează cel puțin un scenariu.");
    const configured = this.settings.get(input.projectId);
    const accountId = input.imapAccountId ?? configured.defaultImapAccountId;
    const account =
      accountId === undefined
        ? undefined
        : this.imapAccounts.findById(accountId);
    const hasEmail = form.fields.some(
      ({ semanticType }) => semanticType === "email",
    );
    if (hasEmail && account === undefined) {
      throw new Error(
        "Contul IMAP selectat nu mai există. Selectează din nou adresa de e-mail.",
      );
    }
    if (
      account !== undefined &&
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(account.username)
    ) {
      throw new Error(
        "Utilizatorul contului IMAP nu este o adresă de e-mail validă.",
      );
    }
    const emailAddress = account?.username;
    const created: TestDefinition[] = [];
    for (const scenario of scenarios) {
      const built = buildFormTestScenario(
        form,
        scenario,
        configured.defaults,
        emailAddress,
        account,
        (field) => this.defaultFiles.forField(field),
      );
      created.push(
        this.tests.createAiGeneratedFormTest(input.projectId, {
          name: scenario.name,
          description: scenario.description,
          startUrl: form.pageUrl,
          flowItems: built.flowItems,
          dataset: {
            name: `Date generate · ${scenario.name}`,
            values: built.dataset,
          },
          postRunChecks: built.postRunChecks,
          sourceFormId: form.id,
          instruction: scenario.description,
          provider: input.provider,
          model: input.model,
        }).test,
      );
    }
    return { tests: created };
  }

  private async requireForm(
    projectId: string,
    pageId: string,
    formId: string,
  ): Promise<AnalyzedForm> {
    if (this.projects.findById(projectId) === undefined)
      throw new Error("Proiectul nu există.");
    const form = (await this.pages.listForms(projectId, pageId)).find(
      ({ id }) => id === formId,
    );
    if (form === undefined)
      throw new Error("Formularul analizat nu mai există.");
    return form;
  }
}
