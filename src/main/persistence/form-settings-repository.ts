import type { DatabaseSync } from "node:sqlite";

import type {
  FormDataDefaults,
  ProjectFormSettings,
} from "../../shared/form-analysis.js";
import { FORM_DEFAULT_KEYS } from "../../shared/form-analysis.js";

type Row = Record<string, unknown>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredSettings = (value: unknown): Record<string, unknown> => {
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
};

export class ProjectFormSettingsRepository {
  public constructor(private readonly database: DatabaseSync) {}

  public get(projectId: string): ProjectFormSettings {
    const row = this.database
      .prepare(
        "SELECT settings_json, updated_at FROM project_settings WHERE project_id = ?",
      )
      .get(projectId) as Row | undefined;
    if (row === undefined) return { projectId, defaults: {} };
    const stored = parseStoredSettings(row.settings_json);
    const forms = isRecord(stored.forms) ? stored.forms : {};
    const rawDefaults = isRecord(forms.defaults) ? forms.defaults : {};
    const defaults = Object.fromEntries(
      FORM_DEFAULT_KEYS.flatMap((key) =>
        typeof rawDefaults[key] === "string" ? [[key, rawDefaults[key]]] : [],
      ),
    ) as FormDataDefaults;
    return {
      projectId,
      defaults,
      ...(typeof forms.defaultImapAccountId !== "string"
        ? {}
        : { defaultImapAccountId: forms.defaultImapAccountId }),
      ...(typeof row.updated_at !== "string"
        ? {}
        : { updatedAt: row.updated_at }),
    };
  }

  public save(settings: ProjectFormSettings): ProjectFormSettings {
    const existing = this.database
      .prepare(
        "SELECT settings_json FROM project_settings WHERE project_id = ?",
      )
      .get(settings.projectId) as Row | undefined;
    const stored = parseStoredSettings(existing?.settings_json);
    stored.forms = {
      defaults: settings.defaults,
      ...(settings.defaultImapAccountId === undefined
        ? {}
        : { defaultImapAccountId: settings.defaultImapAccountId }),
    };
    this.database
      .prepare(
        `INSERT INTO project_settings (
          project_id, url_patterns_json, semantic_change_threshold,
          settings_json, updated_at
        ) VALUES (?, '[]', 0.3, ?, ?)
        ON CONFLICT(project_id) DO UPDATE SET
          settings_json = excluded.settings_json,
          updated_at = excluded.updated_at`,
      )
      .run(
        settings.projectId,
        JSON.stringify(stored),
        settings.updatedAt ?? "",
      );
    return settings;
  }
}
