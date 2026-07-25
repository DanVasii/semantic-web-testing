import type { JsonValue } from "./persistence.js";

export const DEFAULT_CONTINUE_SHORTCUT = "Ctrl+Enter";
export const CONTINUE_SHORTCUT_KEY = "continueRun";

const MODIFIER_ORDER = ["Ctrl", "Alt", "Shift", "Meta"] as const;
const KEY_ALIASES: Record<string, string> = {
  control: "Ctrl",
  ctrl: "Ctrl",
  alt: "Alt",
  option: "Alt",
  shift: "Shift",
  meta: "Meta",
  command: "Meta",
  cmd: "Meta",
  return: "Enter",
  enter: "Enter",
  escape: "Escape",
  esc: "Escape",
  space: "Space",
  " ": "Space",
};

export interface ShortcutKeyEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export const normalizeShortcut = (value: string): string => {
  const parts = value
    .split("+")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length < 2) {
    throw new Error(
      "Shortcut-ul trebuie să includă un modificator și o tastă.",
    );
  }
  const modifiers = new Set<string>();
  let key: string | undefined;
  for (const part of parts) {
    const normalized =
      KEY_ALIASES[part.toLowerCase()] ??
      (part.length === 1 ? part.toUpperCase() : part);
    if ((MODIFIER_ORDER as readonly string[]).includes(normalized)) {
      modifiers.add(normalized);
    } else if (key === undefined) {
      key = normalized;
    } else {
      throw new Error("Shortcut-ul conține mai multe taste principale.");
    }
  }
  if (modifiers.size === 0 || key === undefined) {
    throw new Error(
      "Shortcut-ul trebuie să includă un modificator și o tastă.",
    );
  }
  return [
    ...MODIFIER_ORDER.filter((modifier) => modifiers.has(modifier)),
    key,
  ].join("+");
};

const asConfigRecord = (
  value: JsonValue,
): Record<string, JsonValue> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;

export const getContinueShortcut = (config: JsonValue): string => {
  const configured = asConfigRecord(config)?.[CONTINUE_SHORTCUT_KEY];
  if (typeof configured !== "string") return DEFAULT_CONTINUE_SHORTCUT;
  try {
    return normalizeShortcut(configured);
  } catch {
    return DEFAULT_CONTINUE_SHORTCUT;
  }
};

export const assertShortcutAvailable = (
  config: JsonValue,
  shortcut: string,
  ignoredKey = CONTINUE_SHORTCUT_KEY,
): string => {
  const normalized = normalizeShortcut(shortcut);
  const record = asConfigRecord(config) ?? {};
  for (const [key, value] of Object.entries(record)) {
    if (key === ignoredKey || typeof value !== "string") continue;
    try {
      if (normalizeShortcut(value) === normalized) {
        throw new Error(
          `Shortcut-ul ${normalized} este deja folosit de acțiunea ${key}.`,
        );
      }
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("este deja folosit")
      ) {
        throw error;
      }
    }
  }
  return normalized;
};

export const withContinueShortcut = (
  config: JsonValue,
  shortcut: string,
): JsonValue => ({
  ...(asConfigRecord(config) ?? {}),
  [CONTINUE_SHORTCUT_KEY]: shortcut,
});

export const matchesShortcut = (
  event: ShortcutKeyEvent,
  shortcut: string,
): boolean => {
  const normalized = normalizeShortcut(shortcut);
  const parts = new Set(normalized.split("+"));
  const normalizedKey =
    KEY_ALIASES[event.key.toLowerCase()] ??
    (event.key.length === 1 ? event.key.toUpperCase() : event.key);
  const key = normalized.split("+").at(-1);
  return (
    event.ctrlKey === parts.has("Ctrl") &&
    event.altKey === parts.has("Alt") &&
    event.shiftKey === parts.has("Shift") &&
    event.metaKey === parts.has("Meta") &&
    normalizedKey === key
  );
};
