import type { ImapMatchedMessage } from "../../shared/imap.js";
import type { ImapVariableExtractor } from "../../shared/test-stages.js";
import type { VariablePublication } from "./session-variable-context.js";
import { VariableExtractionError } from "./mysql-variable-extractor.js";

interface EmailLink {
  text: string;
  href: string;
}

const decodeHtml = (value: string): string =>
  value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_match, code: string) =>
      String.fromCodePoint(Number(code)),
    );

export const linksFromMessage = (message: ImapMatchedMessage): EmailLink[] => {
  const links: EmailLink[] = [];
  const html = message.html ?? "";
  const anchor =
    /<a\b[^>]*?href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a\s*>/gi;
  let match: RegExpExecArray | null;
  while ((match = anchor.exec(html)) !== null) {
    const href = decodeHtml(match[1] ?? match[2] ?? match[3] ?? "").trim();
    const text = decodeHtml((match[4] ?? "").replace(/<[^>]*>/g, " "))
      .replace(/\s+/g, " ")
      .trim();
    if (href.length > 0) links.push({ href, text });
  }
  if (links.length === 0) {
    const url = /https?:\/\/[^\s<>"')]+/gi;
    for (const candidate of message.text.match(url) ?? []) {
      links.push({ text: candidate, href: candidate });
    }
  }
  return links;
};

const matches = (
  actual: string,
  expected: string,
  operator: "equals" | "contains" | "regex",
  caseSensitive: boolean,
): boolean => {
  const left = caseSensitive ? actual : actual.toLocaleLowerCase();
  const right = caseSensitive ? expected : expected.toLocaleLowerCase();
  if (operator === "equals") return left === right;
  if (operator === "contains") return left.includes(right);
  return new RegExp(expected, caseSensitive ? "" : "i").test(actual);
};

const regexValue = (
  value: string,
  pattern: string,
  group: number,
): string[] => {
  const regex = new RegExp(pattern, "g");
  const values: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = regex.exec(value)) !== null) {
    const selected = match[group];
    if (selected !== undefined) values.push(selected);
    if (match[0].length === 0) regex.lastIndex += 1;
  }
  return values;
};

const candidatesFor = (
  extractor: ImapVariableExtractor,
  messages: ImapMatchedMessage[],
): string[] => {
  if (extractor.field === "subject") {
    return messages.map(({ subject }) => subject).filter(Boolean);
  }
  if (
    extractor.field === "body_regex_group" ||
    extractor.field === "text_regex_group"
  ) {
    return messages.flatMap((message) =>
      regexValue(
        extractor.field === "body_regex_group"
          ? (message.html ?? message.text)
          : message.text,
        extractor.pattern ?? "",
        extractor.group ?? 1,
      ),
    );
  }
  const selector = extractor.selector;
  if (selector === undefined) return [];
  return messages.flatMap((message) =>
    linksFromMessage(message)
      .filter((link) =>
        matches(
          extractor.field === "link_by_text" ? link.text : link.href,
          selector.value,
          selector.operator,
          selector.caseSensitive ?? false,
        ),
      )
      .map(({ href }) => href),
  );
};

export const extractImapVariables = (
  extractors: ImapVariableExtractor[],
  messages: ImapMatchedMessage[],
  stageId: string,
  producerId: string,
): VariablePublication[] =>
  extractors.flatMap((extractor) => {
    const candidates = [...new Set(candidatesFor(extractor, messages))];
    if (candidates.length === 0) {
      if (!extractor.output.required) return [];
      throw new VariableExtractionError(
        extractor.output.name,
        "no_rows",
        `Extractorul pentru „${extractor.output.name}” nu a găsit nicio valoare în email.`,
        0,
      );
    }
    if (candidates.length !== 1) {
      if (!extractor.output.required) return [];
      throw new VariableExtractionError(
        extractor.output.name,
        "ambiguous_rows",
        `Extractorul pentru „${extractor.output.name}” a găsit ${candidates.length} valori în email.`,
        candidates.length,
      );
    }
    return [
      {
        output: extractor.output,
        value: candidates[0],
        source: "imap" as const,
        stageId,
        producerId,
      },
    ];
  });
