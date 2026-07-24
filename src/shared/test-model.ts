export const ACTION_TYPES = [
  "navigate",
  "click",
  "fill",
  "select_option",
  "check",
  "uncheck",
  "press_key",
  "scroll",
  "wait_for_element",
  "wait_for_url",
  "choose_repeated_item",
  "calendar_select",
  "manual_intervention",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

export const MATCH_OPERATORS = [
  "equals",
  "contains",
  "contains_all_keywords",
  "contains_any_keyword",
  "starts_with",
  "ends_with",
  "regex",
] as const;

export type MatchOperator = (typeof MATCH_OPERATORS)[number];

export const SIMPLE_LOCATOR_TYPES = [
  "css",
  "role",
  "label",
  "text",
  "title",
  "placeholder",
  "data_attribute",
] as const;

export type SimpleLocatorType = (typeof SIMPLE_LOCATOR_TYPES)[number];
export type LocatorStrategyType =
  SimpleLocatorType | "relative" | "repeated_component";

export interface SimpleLocator {
  type: SimpleLocatorType;
  operator: MatchOperator;
  value: string | string[];
  caseSensitive?: boolean;
  role?: string;
  attribute?: string;
}

export const RELATIVE_LOCATOR_RELATIONS = [
  "inside",
  "parent",
  "ancestor",
  "sibling",
  "following",
  "preceding",
] as const;

export type RelativeLocatorRelation =
  (typeof RELATIVE_LOCATOR_RELATIONS)[number];

export interface RelativeLocator {
  type: "relative";
  anchor: LocatorDefinition;
  relation: RelativeLocatorRelation;
  target: LocatorDefinition;
}

export interface ComponentFilter {
  field: LocatorDefinition;
  operator: MatchOperator;
  value: string | string[];
  caseSensitive?: boolean;
}

export interface RepeatedComponentLocator {
  type: "repeated_component";
  container: LocatorDefinition;
  filters: ComponentFilter[];
  targetInsideContainer: LocatorDefinition;
}

export type LocatorDefinition =
  SimpleLocator | RelativeLocator | RepeatedComponentLocator;

export interface LocatorFallback {
  locator: LocatorDefinition;
  humanDescription: string;
  whyExplanation: string;
}

export interface TargetDefinition {
  fieldId?: string;
  primary: LocatorDefinition;
  stability?: number;
}

export const WAIT_TYPES = [
  "none",
  "dom_stable",
  "network_idle",
  "timeout",
  "element",
  "url",
] as const;

export type WaitType = (typeof WAIT_TYPES)[number];

export interface WaitDefinition {
  type: WaitType;
  timeoutMs?: number;
  target?: LocatorDefinition;
  value?: string;
}

export type DatasetValueStrategy = "dataset" | "manual";

export interface ActionStep {
  id: string;
  type: "action";
  actionType: ActionType;
  title: string;
  humanDescription: string;
  whyExplanation: string;
  pageId?: string;
  target?: TargetDefinition;
  inputFieldId?: string;
  valueKey?: string;
  valueStrategy?: DatasetValueStrategy;
  url?: string;
  key?: string;
  waitAfter?: WaitDefinition;
  fallbacks: LocatorFallback[];
  enabled: boolean;
}

export type CheckType = "element" | "text" | "url" | "mysql" | "imap";

export interface ElementCheckConfig {
  target: LocatorDefinition;
  state:
    "visible" | "hidden" | "enabled" | "disabled" | "checked" | "unchecked";
}

export interface TextCheckConfig {
  target: LocatorDefinition;
  operator: MatchOperator;
  value: string | string[];
  caseSensitive?: boolean;
}

export interface UrlCheckConfig {
  operator: MatchOperator;
  value: string;
  caseSensitive?: boolean;
}

export interface TableIdentityConfig {
  tableName: string;
  columns: string[];
}

export interface MysqlCheckConfig {
  tableNames: string[];
  identities: TableIdentityConfig[];
}

export interface ImapCheckConfig {
  accountId: string;
  receivedAfterTestStart: true;
  sender?: string;
  recipient?: string;
  subjectEquals?: string;
  subjectContains?: string;
  bodyContains?: string;
  mailbox?: string;
}

export type CheckConfig =
  | ElementCheckConfig
  | TextCheckConfig
  | UrlCheckConfig
  | MysqlCheckConfig
  | ImapCheckConfig;

export interface CheckStep {
  id: string;
  type: "check";
  checkType: CheckType;
  title: string;
  humanDescription: string;
  config: CheckConfig;
  enabled: boolean;
}

export interface BreakpointItem {
  id: string;
  type: "breakpoint";
  title?: string;
  instructions?: string;
  enabled: boolean;
}

export interface ManualInterventionStep {
  id: string;
  type: "manual_intervention";
  title: string;
  instructions: string;
  humanDescription: string;
  whyExplanation: string;
  completionShortcut?: string;
  enabled: boolean;
}

export type TestFlowItem =
  ActionStep | CheckStep | BreakpointItem | ManualInterventionStep;

export type DatasetPrimitive = string | number | boolean | null;

export interface FixedDatasetValue {
  type: "fixed";
  value: DatasetPrimitive;
}

export interface TimestampDatasetValue {
  type: "generated";
  strategy: "timestamp";
}

export interface UuidDatasetValue {
  type: "generated";
  strategy: "uuid";
}

export interface RandomNumberDatasetValue {
  type: "generated";
  strategy: "random_number";
  min: number;
  max: number;
}

export interface UniqueEmailDatasetValue {
  type: "generated";
  strategy: "unique_email";
  template?: string;
}

export interface CurrentDateDatasetValue {
  type: "generated";
  strategy: "current_date";
  format?: string;
}

export interface RelativeDateDatasetValue {
  type: "generated";
  strategy: "current_date_plus_days" | "current_date_minus_days";
  days: number;
  format?: string;
}

export interface RandomChoiceDatasetValue {
  type: "generated";
  strategy: "random_choice";
  choices: DatasetPrimitive[];
}

export interface TemplateDatasetValue {
  type: "generated";
  strategy: "template";
  template: string;
}

export type GeneratedDatasetValue =
  | TimestampDatasetValue
  | UuidDatasetValue
  | RandomNumberDatasetValue
  | UniqueEmailDatasetValue
  | CurrentDateDatasetValue
  | RelativeDateDatasetValue
  | RandomChoiceDatasetValue
  | TemplateDatasetValue;

export type DatasetValue =
  DatasetPrimitive | FixedDatasetValue | GeneratedDatasetValue;

export interface TestDataset {
  id: string;
  testId: string;
  name: string;
  values: Record<string, DatasetValue>;
  createdAt: string;
  updatedAt: string;
}

export interface DeclarativeTestDefinition {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  description?: string;
  status: "draft" | "valid" | "invalidated";
  version: number;
  wipeBeforeRun: boolean;
  startMode: "base_url" | "current_page";
  startUrl: string;
  createdAt: string;
  updatedAt: string;
  flowItems: TestFlowItem[];
  datasets: TestDataset[];
}
