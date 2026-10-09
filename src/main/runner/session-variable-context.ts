import type { JsonValue } from "../../shared/persistence.js";
import {
  SESSION_VARIABLE_NAME_PATTERN,
  type SessionVariableType,
  type SessionVariableValue,
  type VariableOutputDefinition,
} from "../../shared/test-stages.js";

export type VariableFailureReason =
  | "not_produced"
  | "empty_value"
  | "type_mismatch"
  | "invalid_url"
  | "collision";

export class SessionVariableError extends Error {
  public constructor(
    public readonly variableName: string,
    public readonly reason: VariableFailureReason,
    message: string,
  ) {
    super(message);
    this.name = "SessionVariableError";
  }
}

export interface VariablePublication {
  output: VariableOutputDefinition;
  value: unknown;
  source: SessionVariableValue["source"];
  stageId?: string;
  producerId?: string;
  manual?: boolean;
}

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  return Object.values(value).every(isJsonValue);
};

const scalarText = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  throw new Error("Valoarea nu poate fi convertită în text.");
};

export const validateHttpUrl = (value: string): string => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Valoarea nu este un URL complet valid.");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username.length > 0 ||
    url.password.length > 0
  ) {
    throw new Error("Sunt permise numai URL-uri HTTP(S) fără credențiale.");
  }
  return url.toString();
};

export const coerceSessionValue = (
  value: unknown,
  type: SessionVariableType,
): JsonValue => {
  if (value === null || value === undefined || value === "") {
    throw new Error("Valoarea este goală.");
  }
  switch (type) {
    case "string":
      return scalarText(value);
    case "number": {
      const result =
        typeof value === "number" ? value : Number(scalarText(value).trim());
      if (!Number.isFinite(result)) {
        throw new Error("Valoarea nu este un număr finit.");
      }
      return result;
    }
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true" || value === "1" || value === 1) return true;
      if (value === "false" || value === "0" || value === 0) return false;
      throw new Error("Valoarea nu este booleană.");
    case "url":
      return validateHttpUrl(scalarText(value).trim());
    case "date_time": {
      const text = scalarText(value).trim();
      const timestamp = Date.parse(text);
      if (Number.isNaN(timestamp)) {
        throw new Error("Valoarea nu este o dată validă.");
      }
      return new Date(timestamp).toISOString();
    }
    case "json":
      if (!isJsonValue(value)) {
        throw new Error("Valoarea nu poate fi serializată ca JSON.");
      }
      return structuredClone(value);
  }
};

const textValue = (variable: SessionVariableValue): string => {
  if (
    variable.type === "json" ||
    typeof variable.value === "object" ||
    variable.value === null
  ) {
    throw new SessionVariableError(
      variable.name,
      "type_mismatch",
      `Variabila „${variable.name}” nu poate fi interpolată ca text.`,
    );
  }
  return String(variable.value);
};

export class SessionVariableContext {
  private readonly values = new Map<string, SessionVariableValue>();
  private readonly timeline: SessionVariableValue[] = [];

  public constructor(private readonly now: () => Date) {}

  public seed(
    name: string,
    value: unknown,
    type: SessionVariableType,
    source: "system" | "dataset",
    sensitive = false,
  ): void {
    const normalized = coerceSessionValue(value, type);
    const entry: SessionVariableValue = {
      name,
      type,
      value: normalized,
      source,
      publishedAt: this.now().toISOString(),
      manual: false,
      sensitive,
    };
    this.values.set(name, entry);
    this.timeline.push(structuredClone(entry));
  }

  public has(name: string): boolean {
    return this.values.has(name);
  }

  public get(name: string): SessionVariableValue | undefined {
    const value = this.values.get(name);
    return value === undefined ? undefined : structuredClone(value);
  }

  public require(
    name: string,
    expectedType?: SessionVariableType,
  ): SessionVariableValue {
    const value = this.values.get(name);
    if (value === undefined) {
      throw new SessionVariableError(
        name,
        "not_produced",
        `Variabila obligatorie „${name}” nu a fost produsă.`,
      );
    }
    if (expectedType !== undefined && value.type !== expectedType) {
      throw new SessionVariableError(
        name,
        "type_mismatch",
        `Variabila „${name}” este ${value.type}, dar este necesar tipul ${expectedType}.`,
      );
    }
    return structuredClone(value);
  }

  /** Validates the whole batch before publishing any value. */
  public publish(publications: VariablePublication[]): SessionVariableValue[] {
    const pendingNames = new Set<string>();
    const prepared = publications.map((publication) => {
      const { output } = publication;
      if (
        !SESSION_VARIABLE_NAME_PATTERN.test(output.name) ||
        output.name.length > 120
      ) {
        throw new SessionVariableError(
          output.name,
          "type_mismatch",
          `Numele variabilei „${output.name}” nu este valid.`,
        );
      }
      if (pendingNames.has(output.name)) {
        throw new SessionVariableError(
          output.name,
          "collision",
          `Variabila „${output.name}” este publicată de două ori în aceeași operație.`,
        );
      }
      pendingNames.add(output.name);
      if (
        this.values.has(output.name) &&
        output.overwritePolicy !== "replace"
      ) {
        throw new SessionVariableError(
          output.name,
          "collision",
          `Variabila „${output.name}” există deja.`,
        );
      }
      let normalized: JsonValue;
      try {
        normalized = coerceSessionValue(publication.value, output.type);
      } catch (error) {
        throw new SessionVariableError(
          output.name,
          output.type === "url" ? "invalid_url" : "type_mismatch",
          error instanceof Error ? error.message : "Valoarea nu este validă.",
        );
      }
      return {
        name: output.name,
        type: output.type,
        value: normalized,
        source: publication.source,
        ...(publication.stageId === undefined
          ? {}
          : { stageId: publication.stageId }),
        ...(publication.producerId === undefined
          ? {}
          : { producerId: publication.producerId }),
        publishedAt: this.now().toISOString(),
        manual: publication.manual ?? false,
        sensitive: output.sensitive ?? false,
      } satisfies SessionVariableValue;
    });
    prepared.forEach((entry) => {
      this.values.set(entry.name, entry);
      this.timeline.push(structuredClone(entry));
    });
    return structuredClone(prepared);
  }

  public resolveText(template: string): string {
    return template.replace(
      /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (_token, name: string) => textValue(this.require(name)),
    );
  }

  public resolveUrlTemplate(template: string): string {
    const exactVariable = template.match(
      /^\s*\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}\s*$/,
    );
    if (exactVariable?.[1] !== undefined) {
      const name = exactVariable[1];
      const value = textValue(this.require(name));
      try {
        return validateHttpUrl(value);
      } catch (error) {
        throw new SessionVariableError(
          name,
          "invalid_url",
          error instanceof Error ? error.message : "URL-ul nu este valid.",
        );
      }
    }

    const variableNames: string[] = [];
    const resolved = template.replace(
      /\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g,
      (_token, name: string) => {
        variableNames.push(name);
        const variable = this.require(name);
        const value = textValue(variable);
        return name === "baseUrl"
          ? value.replace(/\/$/, "")
          : encodeURIComponent(value);
      },
    );
    try {
      return validateHttpUrl(resolved);
    } catch (error) {
      if (variableNames.length === 0) throw error;
      throw new SessionVariableError(
        variableNames[0]!,
        "invalid_url",
        error instanceof Error ? error.message : "URL-ul nu este valid.",
      );
    }
  }

  public variableUrl(name: string): string {
    const variable = this.require(name, "url");
    if (typeof variable.value !== "string") {
      throw new Error(`Variabila „${name}” nu conține un URL textual.`);
    }
    return validateHttpUrl(variable.value);
  }

  public list(maskSensitive = false): SessionVariableValue[] {
    return [...this.values.values()].map((value) => ({
      ...structuredClone(value),
      ...(maskSensitive && value.sensitive ? { value: "••••" } : {}),
    }));
  }

  public history(maskSensitive = false): SessionVariableValue[] {
    return this.timeline.map((value) => ({
      ...structuredClone(value),
      ...(maskSensitive && value.sensitive ? { value: "••••" } : {}),
    }));
  }
}
