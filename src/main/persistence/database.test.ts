import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { openApplicationDatabase } from "./database.js";
import {
  APPLICATION_MIGRATIONS,
  assertValidMigrations,
  type Migration,
} from "./migrations.js";

const temporaryDirectories: string[] = [];

const createTemporaryDirectory = (): string => {
  const directory = mkdtempSync(join(tmpdir(), "semantic-app-database-"));
  temporaryDirectories.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("application database", () => {
  it("creates the local database and every Group C table", async () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "data", "application.sqlite");
    const database = await openApplicationDatabase({ filePath });

    const tables = database.connection
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
         ORDER BY name`,
      )
      .all()
      .map((row) => (row as { name: string }).name);
    const version = database.connection
      .prepare("PRAGMA user_version")
      .get() as { user_version: number };
    const journalCount = database.connection
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as { count: number };

    expect(existsSync(filePath)).toBe(true);
    expect(tables).toEqual([
      "ai_model_pricing_cache",
      "application_ai_settings",
      "batch_run_items",
      "batch_runs",
      "datasets",
      "global_imap_accounts",
      "imap_accounts",
      "mysql_cleanup_logs",
      "mysql_run_diffs",
      "mysql_run_snapshots",
      "page_versions",
      "pages",
      "project_basic_auth",
      "project_mysql_settings",
      "project_settings",
      "projects",
      "run_artifacts",
      "runs",
      "schema_migrations",
      "step_results",
      "test_suites",
      "test_versions",
      "tests",
    ]);
    expect(version.user_version).toBe(29);
    expect(journalCount.count).toBe(APPLICATION_MIGRATIONS.length);

    database.close();
  });

  it("migrates existing AI settings and adds LM Studio defaults", async () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "application.sqlite");
    const beforeLmStudio = await openApplicationDatabase({
      filePath,
      migrations: APPLICATION_MIGRATIONS.filter(({ version }) => version < 23),
    });
    beforeLmStudio.connection
      .prepare(
        `INSERT INTO application_ai_settings (
          singleton_id, provider, ollama_base_url, ollama_model,
          gemini_model, encrypted_gemini_api_key, updated_at
        ) VALUES (1, 'ollama', ?, ?, ?, ?, ?)`,
      )
      .run(
        "http://127.0.0.1:11434",
        "gemma3:4b",
        "gemini-flash",
        "encrypted-key",
        "2026-08-30T12:00:00.000Z",
      );
    beforeLmStudio.close();

    const upgraded = await openApplicationDatabase({ filePath });
    const row = upgraded.connection
      .prepare("SELECT * FROM application_ai_settings WHERE singleton_id = 1")
      .get() as Record<string, unknown>;

    expect(row).toMatchObject({
      provider: "ollama",
      ollama_model: "gemma3:4b",
      lm_studio_base_url: "http://127.0.0.1:1234",
      lm_studio_model: "",
      gemini_model: "gemini-flash",
      encrypted_gemini_api_key: "encrypted-key",
    });
    upgraded.close();
  });

  it("creates a restorable backup before upgrading an existing database", async () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "application.sqlite");
    const backupDirectory = join(directory, "backups");
    const migrations: readonly Migration[] = [
      {
        version: 1,
        name: "create_alpha",
        up(database) {
          database.exec("CREATE TABLE alpha (id INTEGER PRIMARY KEY) STRICT;");
        },
      },
      {
        version: 2,
        name: "create_beta",
        up(database) {
          database.exec("CREATE TABLE beta (id INTEGER PRIMARY KEY) STRICT;");
        },
      },
    ];

    const original = await openApplicationDatabase({
      filePath,
      backupDirectory,
      migrations: migrations.slice(0, 1),
    });
    original.connection.prepare("INSERT INTO alpha (id) VALUES (?)").run(7);
    original.close();

    const upgraded = await openApplicationDatabase({
      filePath,
      backupDirectory,
      migrations,
      now: () => new Date("2026-07-24T12:34:56.000Z"),
    });

    expect(upgraded.backupPath).toBe(
      join(
        backupDirectory,
        "semantic-web-testing-v1-2026-07-24T12-34-56.000Z.sqlite",
      ),
    );
    expect(existsSync(upgraded.backupPath ?? "")).toBe(true);
    upgraded.close();

    if (upgraded.backupPath === undefined) {
      throw new Error("Expected an automatic migration backup.");
    }

    const restored = new DatabaseSync(upgraded.backupPath);
    const restoredVersion = restored.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const originalData = restored.prepare("SELECT id FROM alpha").get() as {
      id: number;
    };
    const betaTable = restored
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'beta'",
      )
      .get();

    expect(restoredVersion.user_version).toBe(1);
    expect(originalData.id).toBe(7);
    expect(betaTable).toBeUndefined();
    restored.close();
  });

  it("rolls back a failed migration without advancing its version", async () => {
    const directory = createTemporaryDirectory();
    const filePath = join(directory, "application.sqlite");
    const migrations: readonly Migration[] = [
      {
        version: 1,
        name: "invalid_change",
        up(database) {
          database.exec(
            "CREATE TABLE transient_data (id INTEGER PRIMARY KEY) STRICT;",
          );
          throw new Error("simulated migration error");
        },
      },
    ];

    await expect(
      openApplicationDatabase({ filePath, migrations }),
    ).rejects.toThrow("Migration 1 (invalid_change) failed.");

    const database = new DatabaseSync(filePath);
    const version = database.prepare("PRAGMA user_version").get() as {
      user_version: number;
    };
    const transientTable = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name = 'transient_data'`,
      )
      .get();

    expect(version.user_version).toBe(0);
    expect(transientTable).toBeUndefined();
    database.close();
  });

  it("rejects duplicate or unordered migration versions", () => {
    expect(() =>
      assertValidMigrations([
        { version: 2, name: "second", up: () => undefined },
        { version: 1, name: "first", up: () => undefined },
      ]),
    ).toThrow("Migrations must be ordered by unique ascending version.");
  });
});
