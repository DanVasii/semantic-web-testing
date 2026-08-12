import type { AiProviderId, AiTokenUsage } from "./ai.js";
import type { JsonValue } from "./persistence.js";
import type { TableIdentityConfig } from "./test-model.js";

export interface TestPostRunChecks {
  aiPrompt: string;
  mysql: {
    enabled: boolean;
    tableNames: string[];
    identities: TableIdentityConfig[];
    /** @deprecated Prompturile separate sunt reunite de normalizare. */
    aiPrompt?: string;
  };
  imap: {
    enabled: boolean;
    accountIds: string[];
    mailbox: string;
    sender: string;
    recipient: string;
    subjectEquals: string;
    subjectContains: string;
    bodyContains: string;
    /** @deprecated Prompturile separate sunt reunite de normalizare. */
    aiPrompt?: string;
  };
}

export interface RunPostRunSelection {
  mysql: boolean;
  imap: boolean;
  ai: boolean;
  imapAccountIds?: string[];
  provider?: AiProviderId;
  model?: string;
}

export interface PostRunAiFinding {
  source: "mysql" | "imap";
  passed: boolean;
  message: string;
  evidence: string[];
}

export interface PostRunAiEvaluation {
  status: "passed" | "failed" | "inconclusive";
  summary: string;
  findings: PostRunAiFinding[];
  provider: Exclude<AiProviderId, "none">;
  model: string;
  usage: AiTokenUsage;
  evaluatedAt: string;
}

export interface PostRunAiEvaluationInput {
  projectId: string;
  testId: string;
  runId: string;
  prompt: string;
  dataset: {
    id?: string;
    name?: string;
    values: Record<string, string>;
  };
  evidence: {
    mysql?: JsonValue;
    imap?: JsonValue;
  };
  provider?: AiProviderId;
  model?: string;
}

export const defaultTestPostRunChecks = (): TestPostRunChecks => ({
  aiPrompt: "",
  mysql: {
    enabled: false,
    tableNames: [],
    identities: [],
  },
  imap: {
    enabled: false,
    accountIds: [],
    mailbox: "INBOX",
    sender: "",
    recipient: "",
    subjectEquals: "",
    subjectContains: "",
    bodyContains: "",
  },
});

export const normalizeTestPostRunChecks = (
  value: TestPostRunChecks | undefined,
): TestPostRunChecks => {
  const defaults = defaultTestPostRunChecks();
  if (value === undefined) return defaults;
  const legacyMysqlPrompt =
    typeof value.mysql.aiPrompt === "string" ? value.mysql.aiPrompt.trim() : "";
  const legacyImapPrompt =
    typeof value.imap.aiPrompt === "string" ? value.imap.aiPrompt.trim() : "";
  const legacyPrompt = [...new Set([legacyMysqlPrompt, legacyImapPrompt])]
    .filter((prompt) => prompt.length > 0)
    .join("\n\n");
  const currentPrompt =
    typeof value.aiPrompt === "string" ? value.aiPrompt : "";
  const legacyAccountId = (
    value.imap as TestPostRunChecks["imap"] & { accountId?: string }
  ).accountId;
  return {
    aiPrompt:
      currentPrompt.trim().length > 0 || legacyPrompt.length === 0
        ? currentPrompt
        : legacyPrompt,
    mysql: {
      enabled: value.mysql.enabled ?? defaults.mysql.enabled,
      tableNames: [...(value.mysql.tableNames ?? [])],
      identities: structuredClone(value.mysql.identities ?? []),
    },
    imap: {
      enabled: value.imap.enabled ?? defaults.imap.enabled,
      accountIds:
        value.imap.accountIds?.length > 0
          ? [...value.imap.accountIds]
          : legacyAccountId === undefined || legacyAccountId.length === 0
            ? []
            : [legacyAccountId],
      mailbox: value.imap.mailbox ?? defaults.imap.mailbox,
      sender: value.imap.sender ?? defaults.imap.sender,
      recipient: value.imap.recipient ?? defaults.imap.recipient,
      subjectEquals: value.imap.subjectEquals ?? defaults.imap.subjectEquals,
      subjectContains:
        value.imap.subjectContains ?? defaults.imap.subjectContains,
      bodyContains: value.imap.bodyContains ?? defaults.imap.bodyContains,
    },
  };
};

const validName = (value: string): boolean =>
  value.length > 0 && value.length <= 128 && /^[A-Za-z0-9_$-]+$/.test(value);

export const validateTestPostRunChecks = (
  value: TestPostRunChecks,
): TestPostRunChecks => {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.mysql !== "object" ||
    value.mysql === null ||
    typeof value.imap !== "object" ||
    value.imap === null
  ) {
    throw new Error("Configurația verificărilor post-run nu este validă.");
  }
  const normalized = normalizeTestPostRunChecks(value);
  if (
    typeof normalized.aiPrompt !== "string" ||
    normalized.aiPrompt.length > 8_000 ||
    typeof normalized.mysql?.enabled !== "boolean" ||
    !Array.isArray(normalized.mysql.tableNames) ||
    !Array.isArray(normalized.mysql.identities) ||
    typeof normalized.imap?.enabled !== "boolean" ||
    !Array.isArray(normalized.imap.accountIds) ||
    normalized.imap.accountIds.length > 50 ||
    normalized.imap.accountIds.some(
      (accountId) =>
        typeof accountId !== "string" ||
        accountId.trim().length === 0 ||
        accountId.length > 200,
    ) ||
    typeof normalized.imap.mailbox !== "string" ||
    normalized.imap.mailbox.trim().length === 0 ||
    normalized.imap.mailbox.length > 200 ||
    typeof normalized.imap.sender !== "string" ||
    normalized.imap.sender.length > 320 ||
    typeof normalized.imap.recipient !== "string" ||
    normalized.imap.recipient.length > 320 ||
    typeof normalized.imap.subjectEquals !== "string" ||
    normalized.imap.subjectEquals.length > 998 ||
    typeof normalized.imap.subjectContains !== "string" ||
    normalized.imap.subjectContains.length > 998 ||
    typeof normalized.imap.bodyContains !== "string" ||
    normalized.imap.bodyContains.length > 4_000
  ) {
    throw new Error("Configurația verificărilor post-run nu este validă.");
  }
  const tableNames = [...new Set(normalized.mysql.tableNames)];
  if (
    tableNames.length > 200 ||
    tableNames.some((tableName) => !validName(tableName))
  ) {
    throw new Error("Selecția tabelelor MySQL nu este validă.");
  }
  const identities = normalized.mysql.identities.map((identity) => {
    if (
      !validName(identity.tableName) ||
      identity.columns.length === 0 ||
      identity.columns.length > 50 ||
      identity.columns.some((column) => !validName(column))
    ) {
      throw new Error("Identity columns pentru MySQL nu sunt valide.");
    }
    return {
      tableName: identity.tableName,
      columns: [...new Set(identity.columns)],
    };
  });
  if (
    tableNames.some(
      (tableName) =>
        !identities.some((identity) => identity.tableName === tableName),
    )
  ) {
    throw new Error(
      "Fiecare tabel MySQL selectat trebuie să aibă identity columns.",
    );
  }
  return {
    aiPrompt: normalized.aiPrompt.trim(),
    mysql: {
      enabled: normalized.mysql.enabled,
      tableNames,
      identities: identities.filter((identity) =>
        tableNames.includes(identity.tableName),
      ),
    },
    imap: {
      enabled: normalized.imap.enabled,
      accountIds: [
        ...new Set(
          normalized.imap.accountIds.map((accountId) => accountId.trim()),
        ),
      ],
      mailbox: normalized.imap.mailbox.trim(),
      sender: normalized.imap.sender.trim(),
      recipient: normalized.imap.recipient.trim(),
      subjectEquals: normalized.imap.subjectEquals.trim(),
      subjectContains: normalized.imap.subjectContains.trim(),
      bodyContains: normalized.imap.bodyContains.trim(),
    },
  };
};
