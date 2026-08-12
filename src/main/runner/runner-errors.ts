import {
  RunnerError,
  type RunnerErrorCode,
  type RunnerErrorDetails,
} from "../../shared/runner.js";
import { StepExecutionError } from "./step-executor.js";
import { WipeError } from "./wipe-browser-state.js";

export interface RunnerErrorContext {
  stepId?: string;
  operation?: string;
  now?: () => Date;
}

const NON_RETRYABLE_CODES = new Set<RunnerErrorCode>([
  "dataset_missing",
  "invalid_test",
  "unsupported_step",
]);

export const classifyRunnerError = (
  error: unknown,
  context: RunnerErrorContext = {},
): RunnerErrorDetails => {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const normalized =
    `${error instanceof Error ? error.name : ""} ${rawMessage}`.toLowerCase();
  const inherited = error instanceof RunnerError ? error.details : undefined;
  const code = determineCode(error, normalized, context.operation);
  const count =
    error instanceof StepExecutionError ? error.count : inherited?.count;
  const stepId = context.stepId ?? inherited?.stepId;
  const operation = context.operation ?? inherited?.operation;
  const details: RunnerErrorDetails = {
    code,
    message: humanMessage(code, rawMessage),
    technicalDetails: redactTechnicalDetails(error),
    occurredAt: (context.now ?? (() => new Date()))().toISOString(),
    retryable: inherited?.retryable ?? !NON_RETRYABLE_CODES.has(code),
  };
  if (count !== undefined) details.count = count;
  if (stepId !== undefined) details.stepId = stepId;
  if (operation !== undefined) details.operation = operation;
  if (inherited?.causeMessage !== undefined) {
    details.causeMessage = inherited.causeMessage;
  }
  return details;
};

const determineCode = (
  error: unknown,
  normalized: string,
  operation?: string,
): RunnerErrorCode => {
  if (error instanceof RunnerError) {
    return error.code;
  }
  if (error instanceof WipeError) {
    return "wipe_failed";
  }
  if (
    normalized.includes("target closed") ||
    normalized.includes("browser has been closed") ||
    normalized.includes("browser disconnected") ||
    normalized.includes("page has been closed") ||
    normalized.includes("context has been closed")
  ) {
    return "browser_disconnected";
  }
  if (
    normalized.includes("timeout") &&
    (operation?.includes("navigate") ||
      operation?.includes("url") ||
      normalized.includes("navigation") ||
      normalized.includes("goto") ||
      normalized.includes("url"))
  ) {
    return "navigation_timeout";
  }
  if (
    operation?.includes("imap") ||
    normalized.includes("imap") ||
    normalized.includes("mailbox")
  ) {
    return "imap_failed";
  }
  if (operation?.includes("mysql") || normalized.includes("mysql")) {
    return "mysql_failed";
  }
  return "step_failed";
};

const humanMessage = (code: RunnerErrorCode, fallback: string): string => {
  switch (code) {
    case "browser_disconnected":
      return "Browserul s-a deconectat în timpul rulării.";
    case "navigation_timeout":
      return "Navigarea nu s-a finalizat în timpul permis.";
    case "mysql_failed":
      return "Verificarea MySQL nu a putut fi finalizată.";
    case "imap_failed":
      return "Verificarea IMAP nu a putut fi finalizată.";
    default:
      return fallback;
  }
};

const redactTechnicalDetails = (error: unknown): string => {
  if (!(error instanceof Error)) {
    return redact(String(error));
  }
  const details = [`${error.name}: ${error.message}`];
  if (error.cause instanceof Error) {
    details.push(`Cauză: ${error.cause.name}: ${error.cause.message}`);
  }
  return redact(details.join("\n"));
};

const redact = (value: string): string =>
  value.replace(
    /\b(password|passwd|token|authorization|api[-_ ]?key)\b(\s*[:=]\s*)([^\s,;]+)/gi,
    "$1$2[REDACTED]",
  );
