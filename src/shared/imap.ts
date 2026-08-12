export interface ImapAccountSummary {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  mailbox: string;
  passwordConfigured: boolean;
}

export interface ImapMailboxSummary {
  path: string;
  name: string;
  specialUse?: string;
  subscribed: boolean;
}

export interface ImapMatchedMessage {
  accountId: string;
  accountName: string;
  mailbox: string;
  uid: number;
  receivedAt: string;
  subject: string;
  from: string[];
  to: string[];
  text: string;
  html?: string;
}

export interface SaveImapAccountInput {
  id?: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  mailbox: string;
}

export interface ImapConnectionTestResult {
  success: boolean;
  message: string;
  latencyMs: number;
}

export interface ImapDiagnosticMessage {
  uid: number;
  mailbox: string;
  receivedAt: string;
  subject: string;
  from: string[];
  to: string[];
  textPreview: string;
}

export interface ImapDiagnosticPollResult {
  checkedAt: string;
  messages: ImapDiagnosticMessage[];
}
