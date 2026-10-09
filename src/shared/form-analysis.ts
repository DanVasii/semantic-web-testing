import type { AiProviderId, AiTokenUsage } from "./ai.js";
import type { TestDefinition } from "./persistence.js";
import type { LocatorDefinition } from "./test-model.js";

export const FORM_FIELD_SEMANTIC_TYPES = [
  "first_name",
  "last_name",
  "full_name",
  "email",
  "phone",
  "company",
  "address",
  "city",
  "county",
  "postal_code",
  "country",
  "password",
  "message",
  "unknown",
] as const;

export type FormFieldSemanticType = (typeof FORM_FIELD_SEMANTIC_TYPES)[number];

export interface AnalyzedFormOption {
  value: string;
  label: string;
}

export interface AnalyzedFormField {
  id: string;
  name: string;
  label: string;
  tag: "input" | "select" | "textarea";
  inputType: string;
  semanticType: FormFieldSemanticType;
  required: boolean;
  disabled: boolean;
  locator: LocatorDefinition;
  autocomplete?: string;
  placeholder?: string;
  pattern?: string;
  minLength?: number;
  maxLength?: number;
  min?: string;
  max?: string;
  step?: string;
  accept?: string;
  multiple?: boolean;
  options: AnalyzedFormOption[];
}

export interface AnalyzedFormSubmit {
  label: string;
  locator: LocatorDefinition;
}

export interface AnalyzedForm {
  id: string;
  pageId: string;
  pageVersionId: string;
  pageTitle: string;
  pageUrl: string;
  title: string;
  method: string;
  action: string;
  locator: LocatorDefinition;
  fields: AnalyzedFormField[];
  submit?: AnalyzedFormSubmit;
}

export const FORM_DEFAULT_KEYS = [
  "firstName",
  "lastName",
  "fullName",
  "phone",
  "company",
  "address",
  "city",
  "county",
  "postalCode",
  "country",
  "password",
  "message",
] as const;

export type FormDefaultKey = (typeof FORM_DEFAULT_KEYS)[number];
export type FormDataDefaults = Partial<Record<FormDefaultKey, string>>;

export interface ProjectFormSettings {
  projectId: string;
  defaults: FormDataDefaults;
  defaultImapAccountId?: string;
  updatedAt?: string;
}

export interface SaveProjectFormSettingsInput {
  defaults: FormDataDefaults;
  defaultImapAccountId?: string;
}

export interface FormScenarioFieldValue {
  fieldId: string;
  value: string | number | boolean;
}

export interface FormTestScenarioProposal {
  id: string;
  name: string;
  description: string;
  kind: "valid" | "negative";
  values: FormScenarioFieldValue[];
  omittedFieldIds: string[];
  invalidFieldIds: string[];
  expectedMessages: string[];
  expectEmail: boolean;
}

export interface GenerateFormTestsInput {
  projectId: string;
  pageId: string;
  formId: string;
  imapAccountId?: string;
  expectEmail?: boolean;
  instructions?: string;
  provider?: AiProviderId;
  model?: string;
}

export interface FormTestGenerationResult {
  provider: Exclude<AiProviderId, "none">;
  model: string;
  pageId: string;
  formId: string;
  summary: string;
  scenarios: FormTestScenarioProposal[];
  usage: AiTokenUsage;
}

export interface CreateGeneratedFormTestsInput {
  projectId: string;
  pageId: string;
  formId: string;
  imapAccountId?: string;
  provider: Exclude<AiProviderId, "none">;
  model: string;
  scenarios: FormTestScenarioProposal[];
  selectedScenarioIds: string[];
}

export interface CreateGeneratedFormTestsResult {
  tests: TestDefinition[];
}
