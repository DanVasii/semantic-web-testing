import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { ProjectFormSettingsRepository } from "./form-settings-repository.js";

let database: DatabaseSync | undefined;

const createRepository = (): ProjectFormSettingsRepository => {
  database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE project_settings (
      project_id TEXT PRIMARY KEY,
      url_patterns_json TEXT NOT NULL,
      semantic_change_threshold REAL NOT NULL,
      settings_json TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
  `);
  return new ProjectFormSettingsRepository(database);
};

afterEach(() => {
  database?.close();
  database = undefined;
});

describe("ProjectFormSettingsRepository", () => {
  it("persists form defaults while preserving unrelated project settings", () => {
    const repository = createRepository();
    database!
      .prepare(
        `INSERT INTO project_settings (
        project_id, url_patterns_json, semantic_change_threshold,
        settings_json, updated_at
      ) VALUES (?, '[]', 0.3, ?, ?)`,
      )
      .run(
        "project-1",
        JSON.stringify({ discovery: { enabled: true } }),
        "2026-09-02T10:00:00.000Z",
      );

    repository.save({
      projectId: "project-1",
      defaults: { firstName: "Ana", phone: "0722000000" },
      defaultImapAccountId: "imap-1",
      updatedAt: "2026-09-02T11:00:00.000Z",
    });

    expect(repository.get("project-1")).toEqual({
      projectId: "project-1",
      defaults: { firstName: "Ana", phone: "0722000000" },
      defaultImapAccountId: "imap-1",
      updatedAt: "2026-09-02T11:00:00.000Z",
    });
    const stored = database!
      .prepare(
        "SELECT settings_json FROM project_settings WHERE project_id = ?",
      )
      .get("project-1") as { settings_json: string };
    expect(JSON.parse(stored.settings_json)).toMatchObject({
      discovery: { enabled: true },
      forms: { defaults: { firstName: "Ana", phone: "0722000000" } },
    });
  });

  it("recovers safely from malformed nested form settings", () => {
    const repository = createRepository();
    database!
      .prepare(
        `INSERT INTO project_settings (
        project_id, url_patterns_json, semantic_change_threshold,
        settings_json, updated_at
      ) VALUES (?, '[]', 0.3, ?, ?)`,
      )
      .run(
        "project-1",
        JSON.stringify({ forms: null }),
        "2026-09-02T10:00:00.000Z",
      );

    expect(repository.get("project-1")).toEqual({
      projectId: "project-1",
      defaults: {},
      updatedAt: "2026-09-02T10:00:00.000Z",
    });
  });
});
