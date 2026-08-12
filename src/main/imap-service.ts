import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

import type {
  ImapAccountSummary,
  ImapConnectionTestResult,
  ImapDiagnosticPollResult,
  ImapMailboxSummary,
  ImapMatchedMessage,
  SaveImapAccountInput,
} from "../shared/imap.js";
import type { JsonValue } from "../shared/persistence.js";
import type { CheckStep } from "../shared/test-model.js";
import type { ImapCheckConfig } from "../shared/test-model.js";
import type { SecretProtector } from "./project-basic-auth-service.js";
import {
  ImapAccountRepository,
  type ImapAccountRecord,
} from "./persistence/repositories.js";

export interface ImapServiceOptions {
  createId: () => string;
  secrets: SecretProtector;
}

const cleanText = (value: string, label: string, max = 300): string => {
  const result = value.trim();
  if (result.length === 0 || result.length > max || /[\r\n]/.test(result)) {
    throw new Error(`${label} nu este valid.`);
  }
  return result;
};

const summary = (record: ImapAccountRecord): ImapAccountSummary => ({
  id: record.id,
  name: record.name,
  host: record.host,
  port: record.port,
  secure: record.secure,
  username: record.username,
  mailbox: record.mailbox,
  passwordConfigured: record.encryptedPassword.length > 0,
});

const normalized = (value: string): string => value.trim().toLocaleLowerCase();
const contains = (value: string, expected: string): boolean =>
  expected.length === 0 || normalized(value).includes(normalized(expected));
const addressMatches = (addresses: string[], expected: string): boolean =>
  expected.length === 0 ||
  addresses.some((address) => normalized(address) === normalized(expected));

export interface ImapFilterableMessage {
  from: string[];
  to: string[];
  subject: string;
  text: string;
}

export const matchesImapFilters = (
  message: ImapFilterableMessage,
  config: ImapCheckConfig,
): boolean =>
  addressMatches(message.from, config.sender ?? "") &&
  addressMatches(message.to, config.recipient ?? "") &&
  ((config.subjectEquals ?? "").length === 0 ||
    normalized(message.subject) === normalized(config.subjectEquals ?? "")) &&
  contains(message.subject, config.subjectContains ?? "") &&
  contains(message.text, config.bodyContains ?? "");

export class ImapService {
  public constructor(
    private readonly accounts: ImapAccountRepository,
    private readonly options: ImapServiceOptions,
  ) {}

  public list(): ImapAccountSummary[] {
    return this.accounts.list().map(summary);
  }

  public save(input: SaveImapAccountInput): ImapAccountSummary {
    return summary(this.accounts.save(this.resolveInput(input)));
  }

  public delete(accountId: string): boolean {
    return this.accounts.delete(accountId);
  }

  public async test(
    input: SaveImapAccountInput,
  ): Promise<ImapConnectionTestResult> {
    const startedAt = Date.now();
    try {
      const account = this.resolveInput(input);
      await this.withClient(account, async (client) => {
        const lock = await client.getMailboxLock(account.mailbox);
        lock.release();
      });
      return {
        success: true,
        message: "Conexiunea și mailbox-ul IMAP sunt disponibile.",
        latencyMs: Date.now() - startedAt,
      };
    } catch (error) {
      return {
        success: false,
        message:
          error instanceof Error
            ? error.message
            : "Conexiunea IMAP nu a putut fi testată.",
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  private resolveInput(input: SaveImapAccountInput): ImapAccountRecord {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.name !== "string" ||
      typeof input.host !== "string" ||
      !Number.isInteger(input.port) ||
      input.port < 1 ||
      input.port > 65_535 ||
      typeof input.secure !== "boolean" ||
      typeof input.username !== "string" ||
      typeof input.mailbox !== "string" ||
      (input.password !== undefined && typeof input.password !== "string")
    ) {
      throw new Error("Configurația IMAP nu este validă.");
    }
    const existing =
      input.id === undefined ? undefined : this.accounts.findById(input.id);
    const password = input.password?.trim();
    const encryptedPassword =
      password === undefined || password.length === 0
        ? existing?.encryptedPassword
        : this.options.secrets.encrypt(password);
    if (encryptedPassword === undefined) {
      throw new Error("Parola IMAP este obligatorie la crearea contului.");
    }
    return {
      id: existing?.id ?? this.options.createId(),
      name: cleanText(input.name, "Numele contului", 120),
      host: cleanText(input.host, "Host-ul IMAP"),
      port: input.port,
      secure: input.secure,
      username: cleanText(input.username, "Utilizatorul IMAP"),
      encryptedPassword,
      mailbox: cleanText(input.mailbox, "Mailbox-ul IMAP"),
    };
  }

  public async listMailboxes(accountId: string): Promise<ImapMailboxSummary[]> {
    const account = this.requireAccount(accountId);
    return this.withClient(account, async (client) =>
      (await client.list())
        .filter((mailbox) => !mailbox.flags.has("\\Noselect"))
        .map((mailbox) => ({
          path: mailbox.path,
          name: mailbox.name,
          ...(mailbox.specialUse === undefined
            ? {}
            : { specialUse: mailbox.specialUse }),
          subscribed: mailbox.subscribed,
        }))
        .sort((left, right) => left.path.localeCompare(right.path)),
    );
  }

  public async pollDiagnostic(
    input: SaveImapAccountInput,
    receivedAfter: string,
  ): Promise<ImapDiagnosticPollResult> {
    const account = this.resolveInput(input);
    const threshold = new Date(receivedAfter);
    if (Number.isNaN(threshold.getTime())) {
      throw new Error("Momentul pornirii ascultării IMAP nu este valid.");
    }
    const messages = await this.withClient(account, async (client) => {
      const lock = await client.getMailboxLock(account.mailbox);
      try {
        const found = await client.search({ since: threshold }, { uid: true });
        const uids = found === false ? [] : found;
        const result: ImapDiagnosticPollResult["messages"] = [];
        for (const uid of uids.slice(-20).reverse()) {
          const message = await client.fetchOne(
            uid,
            { envelope: true, internalDate: true, source: true },
            { uid: true },
          );
          if (message === false) continue;
          const receivedAt =
            typeof message.internalDate === "string"
              ? new Date(message.internalDate)
              : message.internalDate;
          if (receivedAt !== undefined && receivedAt < threshold) continue;
          const parsed =
            message.source === undefined
              ? undefined
              : await simpleParser(message.source);
          const text =
            parsed?.text ??
            (typeof parsed?.html === "string"
              ? parsed.html.replaceAll(/<[^>]+>/g, " ")
              : "");
          result.push({
            uid,
            mailbox: account.mailbox,
            receivedAt: receivedAt?.toISOString() ?? "",
            subject: message.envelope?.subject ?? parsed?.subject ?? "",
            from:
              message.envelope?.from?.map((address) => address.address ?? "") ??
              [],
            to:
              message.envelope?.to?.map((address) => address.address ?? "") ??
              [],
            textPreview: text.replaceAll(/\s+/g, " ").trim().slice(0, 500),
          });
        }
        return result;
      } finally {
        lock.release();
      }
    });
    console.info("[IMAP][settings-listen] Poll", {
      accountName: account.name,
      username: account.username,
      mailbox: account.mailbox,
      receivedAfter: threshold.toISOString(),
      messages: messages.map((message) => ({
        uid: message.uid,
        receivedAt: message.receivedAt,
        subject: message.subject,
        from: message.from,
        to: message.to,
      })),
    });
    return {
      checkedAt: new Date().toISOString(),
      messages,
    };
  }

  public async check(
    _projectId: string,
    _runId: string,
    step: CheckStep,
    testStartedAt: string,
  ): Promise<{ matched: boolean; message: string; evidence?: JsonValue }> {
    if (
      step.checkType !== "imap" ||
      !("accountId" in step.config) ||
      !("receivedAfterTestStart" in step.config)
    ) {
      throw new Error("Configurația check-ului IMAP nu este validă.");
    }
    const config = step.config;
    const account = this.requireAccount(config.accountId);
    const mailbox = config.mailbox?.trim() || account.mailbox;
    const threshold = new Date(testStartedAt);
    console.info("[IMAP][post-run] Începe verificarea", {
      accountId: account.id,
      accountName: account.name,
      username: account.username,
      mailbox,
      receivedAfter: threshold.toISOString(),
      filters: {
        sender: config.sender ?? "",
        recipient: config.recipient ?? "",
        subjectEquals: config.subjectEquals ?? "",
        subjectContains: config.subjectContains ?? "",
        bodyContains: config.bodyContains ?? "",
      },
    });
    const messages = await this.withClient(account, async (client) => {
      const lock = await client.getMailboxLock(mailbox);
      try {
        const found = await client.search({ since: threshold }, { uid: true });
        const uids = found === false ? [] : found;
        console.info("[IMAP][post-run] Mesaje candidate găsite", {
          accountName: account.name,
          mailbox,
          count: uids.length,
          uids,
        });
        const result: ImapMatchedMessage[] = [];
        for (const uid of uids.slice(-20).reverse()) {
          const message = await client.fetchOne(
            uid,
            { envelope: true, internalDate: true, source: true },
            { uid: true },
          );
          if (message === false) {
            console.warn("[IMAP][post-run] Mesajul nu a putut fi citit", {
              accountName: account.name,
              mailbox,
              uid,
            });
            continue;
          }
          const receivedAt =
            typeof message.internalDate === "string"
              ? new Date(message.internalDate)
              : message.internalDate;
          if (receivedAt !== undefined && receivedAt < threshold) {
            console.info("[IMAP][post-run] Mesaj ignorat: anterior testului", {
              accountName: account.name,
              mailbox,
              uid,
              receivedAt: receivedAt.toISOString(),
              receivedAfter: threshold.toISOString(),
            });
            continue;
          }
          const source = message.source;
          const parsed =
            source === undefined ? undefined : await simpleParser(source);
          const from =
            message.envelope?.from?.map((address) => address.address ?? "") ??
            [];
          const to =
            message.envelope?.to?.map((address) => address.address ?? "") ?? [];
          const subject = message.envelope?.subject ?? parsed?.subject ?? "";
          const text =
            parsed?.text ??
            (typeof parsed?.html === "string"
              ? parsed.html.replaceAll(/<[^>]+>/g, " ")
              : (source?.toString("utf8") ?? ""));
          const matched = matchesImapFilters(
            { from, to, subject, text },
            config,
          );
          console.info("[IMAP][post-run] Mesaj primit", {
            accountName: account.name,
            mailbox,
            uid,
            receivedAt: receivedAt?.toISOString() ?? "",
            subject,
            from,
            to,
            matched,
            textPreview: text.replaceAll(/\s+/g, " ").trim().slice(0, 240),
          });
          if (!matched) {
            continue;
          }
          result.push({
            accountId: account.id,
            accountName: account.name,
            mailbox,
            uid,
            receivedAt: receivedAt?.toISOString() ?? "",
            subject,
            from,
            to,
            text: text.slice(0, 20_000),
            ...(typeof parsed?.html === "string"
              ? { html: parsed.html.slice(0, 20_000) }
              : {}),
          });
        }
        console.info("[IMAP][post-run] Verificare finalizată", {
          accountName: account.name,
          mailbox,
          candidates: uids.length,
          matched: result.length,
        });
        return result;
      } finally {
        lock.release();
      }
    });
    if (messages.length === 0) {
      return {
        matched: false,
        message: `Nu a sosit încă niciun mesaj care să corespundă filtrelor în ${mailbox}.`,
      };
    }
    return {
      matched: true,
      message: `${messages.length} mesaj(e) din ${account.name} corespund filtrelor.`,
      evidence: JSON.parse(
        JSON.stringify({
          accountId: account.id,
          accountName: account.name,
          mailbox,
          messages,
        }),
      ) as JsonValue,
    };
  }

  private async withClient<T>(
    account: ImapAccountRecord,
    action: (client: ImapFlow) => Promise<T>,
  ): Promise<T> {
    const client = new ImapFlow({
      host: account.host,
      port: account.port,
      secure: account.secure,
      auth: {
        user: account.username,
        pass: this.options.secrets.decrypt(account.encryptedPassword),
      },
      logger: false,
      disableAutoIdle: true,
    });
    await client.connect();
    try {
      return await action(client);
    } finally {
      await client.logout().catch(() => undefined);
    }
  }

  private requireAccount(accountId: string): ImapAccountRecord {
    const account = this.accounts.findById(accountId);
    if (account === undefined) {
      throw new Error("Contul IMAP global nu există.");
    }
    return account;
  }
}
