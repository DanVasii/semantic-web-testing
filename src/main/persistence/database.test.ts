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
      "datasets",
      "imap_accounts",
      "page_versions",
      "pages",
      "project_settings",
      "projects",
      "runs",
      "schema_migrations",
      "step_results",
      "test_versions",
      "tests",
    ]);
    expect(version.user_version).toBe(12);
    expect(journalCount.count).toBe(APPLICATION_MIGRATIONS.length);

    database.close();
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
