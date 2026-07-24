import { mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

import {
  APPLICATION_MIGRATIONS,
  assertValidMigrations,
  type Migration,
} from "./migrations.js";

export interface OpenDatabaseOptions {
  filePath: string;
  backupDirectory?: string;
  migrations?: readonly Migration[];
  now?: () => Date;
}

export interface ApplicationDatabase {
  connection: DatabaseSync;
  backupPath?: string;
  close: () => void;
}

const getUserVersion = (database: DatabaseSync): number => {
  const row = database.prepare("PRAGMA user_version").get() as
    { user_version: number } | undefined;
  return row?.user_version ?? 0;
};

const createBackupName = (version: number, now: Date): string => {
  const timestamp = now.toISOString().replaceAll(":", "-");
  return `semantic-web-testing-v${version}-${timestamp}.sqlite`;
};

const prepareMigrationJournal = (database: DatabaseSync): void => {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);
};

const applyMigrations = (
  database: DatabaseSync,
  migrations: readonly Migration[],
  currentVersion: number,
  now: () => Date,
): void => {
  const pending = migrations.filter(
    (migration) => migration.version > currentVersion,
  );

  for (const migration of pending) {
    database.exec("BEGIN IMMEDIATE");

    try {
      migration.up(database);
      database
        .prepare(
          "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
        )
        .run(migration.version, migration.name, now().toISOString());
      database.exec(`PRAGMA user_version = ${migration.version}`);
      database.exec("COMMIT");
    } catch (error) {
      database.exec("ROLLBACK");
      throw new Error(
        `Migration ${migration.version} (${migration.name}) failed.`,
        { cause: error },
      );
    }
  }
};

export const openApplicationDatabase = async ({
  filePath,
  backupDirectory = join(dirname(filePath), "backups"),
  migrations = APPLICATION_MIGRATIONS,
  now = () => new Date(),
}: OpenDatabaseOptions): Promise<ApplicationDatabase> => {
  assertValidMigrations(migrations);
  mkdirSync(dirname(filePath), { recursive: true });

  const existedWithData = (() => {
    try {
      return statSync(filePath).size > 0;
    } catch {
      return false;
    }
  })();

  const connection = new DatabaseSync(filePath);
  connection.exec("PRAGMA foreign_keys = ON");
  connection.exec("PRAGMA busy_timeout = 5000");

  const currentVersion = getUserVersion(connection);
  const hasPendingMigration = migrations.some(
    (migration) => migration.version > currentVersion,
  );
  let backupPath: string | undefined;

  try {
    if (existedWithData && hasPendingMigration) {
      mkdirSync(backupDirectory, { recursive: true });
      backupPath = join(
        backupDirectory,
        createBackupName(currentVersion, now()),
      );
      await backup(connection, backupPath);
    }

    prepareMigrationJournal(connection);
    applyMigrations(connection, migrations, currentVersion, now);
    connection.exec("PRAGMA journal_mode = WAL");
  } catch (error) {
    connection.close();
    throw error;
  }

  return {
    connection,
    ...(backupPath === undefined ? {} : { backupPath }),
    close: () => {
      connection.close();
    },
  };
};
