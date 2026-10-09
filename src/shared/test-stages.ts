import {
  normalizeTestPostRunChecks,
  type TestPostRunChecks,
} from "./post-run-checks.js";
import type {
  CheckStep,
  ImapCheckConfig,
  JsonCheckValue,
  MysqlCheckConfig,
  TestFlowItem,
} from "./test-model.js";

export const SESSION_VARIABLE_TYPES = [
  "string",
  "number",
  "boolean",
  "url",
  "date_time",
  "json",
] as const;

export type SessionVariableType = (typeof SESSION_VARIABLE_TYPES)[number];
export type VariableOverwritePolicy = "deny" | "replace";

export interface VariableOutputDefinition {
  name: string;
  type: SessionVariableType;
  required: boolean;
  overwritePolicy: VariableOverwritePolicy;
  sensitive?: boolean;
}

export const MYSQL_ROW_SOURCES = [
  "inserted",
  "updated_after",
  "updated_before",
  "deleted",
  "current_snapshot",
] as const;
export type MysqlRowSource = (typeof MYSQL_ROW_SOURCES)[number];

export const MYSQL_FILTER_OPERATORS = [
  "equals",
  "not_equals",
  "contains",
  "is_null",
  "is_not_null",
] as const;
export type MysqlFilterOperator = (typeof MYSQL_FILTER_OPERATORS)[number];

export interface MysqlExtractorFilter {
  column: string;
  operator: MysqlFilterOperator;
  valueTemplate?: string;
}

export interface MysqlVariableExtractor {
  id: string;
  source: "mysql";
  tableName: string;
  rowSource: MysqlRowSource;
  filters: MysqlExtractorFilter[];
  column: string;
  cardinality: "exactly_one";
  output: VariableOutputDefinition;
}

export interface ImapLinkSelector {
  operator: "equals" | "contains" | "regex";
  value: string;
  caseSensitive?: boolean;
}

export type ImapExtractorField =
  | "link_by_text"
  | "link_by_href"
  | "subject"
  | "body_regex_group"
  | "text_regex_group";

export interface ImapVariableExtractor {
  id: string;
  source: "imap";
  field: ImapExtractorField;
  selector?: ImapLinkSelector;
  pattern?: string;
  group?: number;
  cardinality: "exactly_one";
  output: VariableOutputDefinition;
}

export type VariableExtractor = MysqlVariableExtractor | ImapVariableExtractor;

export type ExternalCheckStep = CheckStep & {
  checkType: "mysql" | "imap";
  config: MysqlCheckConfig | ImapCheckConfig;
  required?: boolean;
  extractors?: VariableExtractor[];
};

export type StageEntry =
  | { type: "test_start" }
  | { type: "continue_current_page" }
  | { type: "static_url"; url: string }
  | { type: "url_template"; template: string }
  | { type: "variable_url"; variableName: string };

export interface TestStage {
  id: string;
  name: string;
  description?: string;
  enabled: boolean;
  entry: StageEntry;
  flowItems: TestFlowItem[];
  postChecks: ExternalCheckStep[];
}

export interface SessionVariableValue {
  name: string;
  type: SessionVariableType;
  value: JsonCheckValue;
  source: "system" | "dataset" | "mysql" | "imap" | "manual";
  stageId?: string;
  producerId?: string;
  publishedAt: string;
  manual: boolean;
  sensitive: boolean;
}

export interface StageValidationIssue {
  path: string;
  code:
    | "invalid_stage"
    | "duplicate_id"
    | "invalid_variable_name"
    | "unknown_variable"
    | "variable_used_before_produced"
    | "ambiguous_producer"
    | "type_mismatch"
    | "invalid_template"
    | "invalid_extractor";
  message: string;
}

export const SESSION_VARIABLE_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
export const RESERVED_SESSION_VARIABLES = new Set([
  "baseUrl",
  "runId",
  "testId",
  "startedAt",
  "stageId",
  "stageStartedAt",
]);

const postRunChecksAsSteps = (
  testId: string,
  value: TestPostRunChecks | undefined,
): ExternalCheckStep[] => {
  const checks = normalizeTestPostRunChecks(value);
  const result: ExternalCheckStep[] = [];
  if (checks.mysql.enabled && checks.mysql.tableNames.length > 0) {
    result.push({
      id: `post-run-mysql-${testId}`,
      type: "check",
      checkType: "mysql",
      title: "MySQL snapshot post-run",
      humanDescription:
        "Compară tabelele configurate cu baseline-ul capturat înainte de flow.",
      config: {
        tableNames: [...checks.mysql.tableNames],
        identities: structuredClone(checks.mysql.identities),
      },
      enabled: true,
      required: true,
      extractors: [],
    });
  }
  checks.imap.inboxes.forEach((inbox, index) => {
    if (!checks.imap.enabled) return;
    result.push({
      id: `post-run-imap-${testId}-${inbox.id || index + 1}`,
      type: "check",
      checkType: "imap",
      title: `Ascultare e-mail post-run ${index + 1}`,
      humanDescription:
        "Așteaptă un mesaj primit după momentul pornirii flow-ului.",
      config: {
        accountId: inbox.accountId,
        mailbox: inbox.mailbox,
        receivedAfterTestStart: true,
        ...(inbox.sender.length === 0 ? {} : { sender: inbox.sender }),
        ...(inbox.recipient.length === 0 ? {} : { recipient: inbox.recipient }),
        ...(inbox.subjectEquals.length === 0
          ? {}
          : { subjectEquals: inbox.subjectEquals }),
        ...(inbox.subjectContains.length === 0
          ? {}
          : { subjectContains: inbox.subjectContains }),
        ...(inbox.bodyContains.length === 0
          ? {}
          : { bodyContains: inbox.bodyContains }),
      },
      enabled: true,
      required: true,
      extractors: [],
    });
  });
  return result;
};

export interface StageBackedTest {
  id: string;
  name: string;
  flowItems: TestFlowItem[];
  postRunChecks?: TestPostRunChecks;
  stages?: TestStage[];
}

/** Legacy tests are projected into one stage without mutating them. */
export const stagesForTest = (test: StageBackedTest): TestStage[] => {
  if (test.stages !== undefined && test.stages.length > 0) {
    return structuredClone(test.stages);
  }
  const inlinePostChecks = test.flowItems.filter(
    (item): item is ExternalCheckStep =>
      item.type === "check" &&
      (item.checkType === "mysql" || item.checkType === "imap"),
  );
  const flowItems = test.flowItems.filter(
    (item) =>
      !(
        item.type === "check" &&
        (item.checkType === "mysql" || item.checkType === "imap")
      ),
  );
  const configured = postRunChecksAsSteps(test.id, test.postRunChecks);
  return [
    {
      id: `stage-${test.id}-1`,
      name: "Flow principal",
      enabled: true,
      entry: { type: "test_start" },
      flowItems: structuredClone(flowItems),
      postChecks: structuredClone(
        configured.length > 0 ? configured : inlinePostChecks,
      ),
    },
  ];
};

const externalCheckAsFlowItem = (check: ExternalCheckStep): TestFlowItem => {
  const flowCheck = structuredClone(check);
  delete flowCheck.required;
  delete flowCheck.extractors;
  return flowCheck;
};

/**
 * Keeps the legacy flat flow projection free of stage-only metadata.
 * The full check definition (including `required` and extractors) remains in
 * `stages[].postChecks`, while `flowItems` stays compatible with schema v1.
 */
export const flattenStageFlowItems = (stages: TestStage[]): TestFlowItem[] =>
  stages.flatMap((stage) => [
    ...structuredClone(stage.flowItems),
    ...stage.postChecks.map(externalCheckAsFlowItem),
  ]);

export const templateVariableNames = (template: string): string[] => {
  const result: string[] = [];
  const token = /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g;
  let match: RegExpExecArray | null;
  while ((match = token.exec(template)) !== null) {
    if (match[1] !== undefined) result.push(match[1]);
  }
  return [...new Set(result)];
};

const malformedTemplate = (template: string): boolean => {
  const remainder = template.replace(
    /\{\{\s*[A-Za-z_][A-Za-z0-9_]*\s*\}\}/g,
    "",
  );
  return remainder.includes("{{") || remainder.includes("}}");
};

const templateInputs = (stage: TestStage) => {
  const result: Array<{
    path: string;
    value: string;
    expectedType?: SessionVariableType;
  }> = [];
  if (stage.entry.type === "url_template") {
    result.push({ path: "entry.template", value: stage.entry.template });
  }
  if (stage.entry.type === "variable_url") {
    result.push({
      path: "entry.variableName",
      value: `{{${stage.entry.variableName}}}`,
      expectedType: "url",
    });
  }
  stage.flowItems.forEach((item, index) => {
    if (item.type !== "action") return;
    if (item.url !== undefined) {
      result.push({ path: `flowItems[${index}].url`, value: item.url });
    }
  });
  stage.postChecks.forEach((check, checkIndex) => {
    (check.extractors ?? []).forEach((extractor, extractorIndex) => {
      if (extractor.source !== "mysql") return;
      extractor.filters.forEach((filter, filterIndex) => {
        if (filter.valueTemplate === undefined) return;
        result.push({
          path: `postChecks[${checkIndex}].extractors[${extractorIndex}].filters[${filterIndex}].valueTemplate`,
          value: filter.valueTemplate,
        });
      });
    });
  });
  return result;
};

export const validateTestStageDependencies = (
  stages: TestStage[],
  datasetKeys: Iterable<string> = [],
): StageValidationIssue[] => {
  const issues: StageValidationIssue[] = [];
  const available = new Map<string, SessionVariableType>();
  for (const name of RESERVED_SESSION_VARIABLES) {
    available.set(name, name === "baseUrl" ? "url" : "string");
  }
  for (const key of datasetKeys) available.set(key, "string");
  const ids = new Set<string>();
  const futureProducers = new Set(
    stages.flatMap((stage) =>
      stage.postChecks.flatMap((check) =>
        (check.extractors ?? []).map((extractor) => extractor.output.name),
      ),
    ),
  );

  stages.forEach((stage, stageIndex) => {
    const stagePath = `$.stages[${stageIndex}]`;
    if (ids.has(stage.id)) {
      issues.push({
        path: `${stagePath}.id`,
        code: "duplicate_id",
        message: `ID-ul de etapă „${stage.id}” este duplicat.`,
      });
    }
    ids.add(stage.id);
    if (stageIndex > 0 && stage.entry.type === "test_start") {
      issues.push({
        path: `${stagePath}.entry.type`,
        code: "invalid_stage",
        message: "Doar prima etapă poate folosi intrarea test_start.",
      });
    }
    if (!stage.enabled) return;

    for (const input of templateInputs(stage)) {
      if (malformedTemplate(input.value)) {
        issues.push({
          path: `${stagePath}.${input.path}`,
          code: "invalid_template",
          message: "Template-ul conține tokeni incompleți sau invalizi.",
        });
      }
      for (const name of templateVariableNames(input.value)) {
        const actualType = available.get(name);
        if (actualType === undefined) {
          issues.push({
            path: `${stagePath}.${input.path}`,
            code: futureProducers.has(name)
              ? "variable_used_before_produced"
              : "unknown_variable",
            message: futureProducers.has(name)
              ? `Variabila „${name}” este folosită înainte să fie produsă.`
              : `Variabila „${name}” nu are un producător anterior.`,
          });
        } else if (
          input.expectedType !== undefined &&
          actualType !== input.expectedType
        ) {
          issues.push({
            path: `${stagePath}.${input.path}`,
            code: "type_mismatch",
            message: `Variabila „${name}” trebuie să fie de tip ${input.expectedType}, nu ${actualType}.`,
          });
        }
      }
    }

    stage.postChecks.forEach((check, checkIndex) => {
      (check.extractors ?? []).forEach((extractor, extractorIndex) => {
        const output = extractor.output;
        const outputPath = `${stagePath}.postChecks[${checkIndex}].extractors[${extractorIndex}].output`;
        if (
          !SESSION_VARIABLE_NAME_PATTERN.test(output.name) ||
          output.name.length > 120 ||
          RESERVED_SESSION_VARIABLES.has(output.name)
        ) {
          issues.push({
            path: `${outputPath}.name`,
            code: "invalid_variable_name",
            message: `Numele variabilei „${output.name}” nu este permis.`,
          });
          return;
        }
        if (
          available.has(output.name) &&
          output.overwritePolicy !== "replace"
        ) {
          issues.push({
            path: `${outputPath}.name`,
            code: "ambiguous_producer",
            message: `Variabila „${output.name}” are deja un producător; setează overwrite explicit sau schimbă numele.`,
          });
          return;
        }
        if (check.enabled) available.set(output.name, output.type);
      });
    });
  });
  return issues;
};
