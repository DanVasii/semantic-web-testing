import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project, TestRun } from "../../shared/persistence.js";
import type { CheckStep } from "../../shared/test-model.js";
import { openApplicationDatabase } from "../persistence/database.js";
import {
  MySqlRunDataRepository,
  ProjectMySqlSettingsRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../persistence/repositories.js";
import type { MySqlGateway, MySqlSession } from "./mysql-gateway.js";
import { MySqlService } from "./mysql-service.js";
import { MySqlSnapshotService } from "./mysql-snapshot-service.js";

const NOW = "2026-07-26T12:00:00.000Z";
const project: Project = {
  id: "project-1",
  name: "Fixture",
  baseUrl: "http://127.0.0.1:4173",
  normalizedBaseUrl: "http://127.0.0.1:4173/",
  createdAt: NOW,
  updatedAt: NOW,
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
};
const run: TestRun = {
  id: "run-1",
  projectId: project.id,
  testId: "test-1",
  testVersion: 1,
  startedAt: NOW,
  status: "running",
  browserType: "chromium",
  pageVersionIds: [],
};
const check: CheckStep = {
  id: "mysql-check",
  type: "check",
  checkType: "mysql",
  title: "Verifică sloturi",
  humanDescription: "Compară sloturile cu baseline-ul.",
  config: {
    tableNames: ["booking_slots"],
    identities: [
      {
        tableName: "booking_slots",
        columns: ["service_code", "appointment_date", "appointment_time"],
      },
    ],
  },
  enabled: true,
};

const schemaRows = [
  ["service_code", "varchar", "varchar(64)", 1],
  ["appointment_date", "date", "date", 1],
  ["appointment_time", "time", "time", 1],
  ["available", "tinyint", "tinyint(1)", 0],
].map(([name, dataType, columnType, primary], index) => ({
  TABLE_NAME: "booking_slots",
  COLUMN_NAME: name,
  DATA_TYPE: dataType,
  COLUMN_TYPE: columnType,
  IS_NULLABLE: "NO",
  COLUMN_DEFAULT: null,
  EXTRA: "",
  ORDINAL_POSITION: index + 1,
  IS_PRIMARY: primary,
}));

let directory: string;
let database: Awaited<ReturnType<typeof openApplicationDatabase>>;
let tableRows: Record<string, unknown>[];
let transactionBackup: Record<string, unknown>[] | undefined;
let failDeleteAt: number | undefined;
let deleteCount: number;
let service: MySqlSnapshotService;
let nextId: number;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-mysql-snapshots-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  const projects = new ProjectRepository(database.connection);
  const settings = new ProjectMySqlSettingsRepository(database.connection);
  const runs = new RunRepository(database.connection);
  projects.create(project);
  new TestRepository(database.connection).create({
    id: "test-1",
    projectId: project.id,
    name: "MySQL fixture",
    status: "valid",
    version: 1,
    testMode: "recorded",
    wipeBeforeRun: false,
    startMode: "base_url",
    startUrl: project.baseUrl,
    normalizedStartUrl: project.normalizedBaseUrl,
    workflowState: "ready",
    createdAt: NOW,
    updatedAt: NOW,
    flowItems: [check],
  });
  runs.create(run);
  tableRows = [
    {
      service_code: "semantic",
      appointment_date: "2027-08-15",
      appointment_time: "09:00:00",
      available: 1,
    },
  ];
  transactionBackup = undefined;
  failDeleteAt = undefined;
  deleteCount = 0;
  nextId = 0;

  const matches = (
    row: Record<string, unknown>,
    values: readonly unknown[],
  ): boolean =>
    row.service_code === values[0] &&
    row.appointment_date === values[1] &&
    row.appointment_time === values[2];
  const session: MySqlSession = {
    query: vi.fn((sql: string, values: readonly unknown[] = []) => {
      if (sql.includes("information_schema.COLUMNS")) {
        return Promise.resolve(schemaRows);
      }
      if (sql.startsWith("SELECT *")) {
        return Promise.resolve(structuredClone(tableRows));
      }
      if (sql.startsWith("SELECT COUNT(*)")) {
        return Promise.resolve([
          {
            row_count: tableRows.filter((row) => matches(row, values)).length,
          },
        ]);
      }
      return Promise.resolve([{ connection_test: 1 }]);
    }),
    execute: vi.fn((_sql: string, values: readonly unknown[] = []) => {
      deleteCount += 1;
      if (failDeleteAt === deleteCount) {
        return Promise.reject(
          Object.assign(new Error("simulated delete failure"), {
            code: "ER_LOCK_DEADLOCK",
          }),
        );
      }
      const before = tableRows.length;
      tableRows = tableRows.filter((row) => !matches(row, values));
      return Promise.resolve({ affectedRows: before - tableRows.length });
    }),
    beginTransaction: vi.fn(() => {
      transactionBackup = structuredClone(tableRows);
      return Promise.resolve();
    }),
    commit: vi.fn(() => {
      transactionBackup = undefined;
      return Promise.resolve();
    }),
    rollback: vi.fn(() => {
      tableRows = structuredClone(transactionBackup ?? tableRows);
      transactionBackup = undefined;
      return Promise.resolve();
    }),
    close: vi.fn(() => Promise.resolve()),
  };
  const gateway: MySqlGateway = {
    connect: vi.fn(() => Promise.resolve(session)),
  };
  const mysql = new MySqlService(projects, settings, gateway, {
    now: () => new Date(NOW),
    secrets: {
      encrypt: (value) => `encrypted:${value}`,
      decrypt: (value) => value.replace("encrypted:", ""),
    },
  });
  mysql.save(project.id, {
    host: "127.0.0.1",
    port: 3306,
    database: "semantic_fixture",
    username: "root",
    password: "",
    ssl: false,
  });
  service = new MySqlSnapshotService(
    mysql,
    new MySqlRunDataRepository(database.connection),
    runs,
    {
      createId: () => `mysql-${++nextId}`,
      now: () => new Date(NOW),
    },
  );
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("MySqlSnapshotService", () => {
  it("captures one baseline, diffs a full table and cleans inserted rows after preview", async () => {
    const baseline = await service.captureBaseline(project.id, run.id, [check]);
    expect(baseline?.tables[0]?.rows).toHaveLength(1);
    await expect(
      service.captureBaseline(project.id, run.id, [check]),
    ).rejects.toThrow("există deja");

    tableRows.push({
      service_code: "semantic",
      appointment_date: "2027-08-15",
      appointment_time: "10:30:00",
      available: 1,
    });
    const diff = await service.check(project.id, run.id, check);
    expect(diff.tables[0]?.inserted).toHaveLength(1);
    const inserted = diff.tables[0]?.inserted[0];
    if (inserted === undefined) throw new Error("Expected inserted row.");

    const preview = service.previewCleanup(run.id, diff.id, [
      {
        tableName: "booking_slots",
        identity: inserted.identity,
      },
    ]);
    expect(preview.rows[0]?.conditions).toHaveLength(3);
    expect(preview.rows[0]?.sqlPreview).toContain(
      "`service_code` = ? AND `appointment_date` = ? AND `appointment_time` = ?",
    );

    const log = await service.confirmCleanup(project.id, run.id, preview.id);
    expect(log).toMatchObject({
      status: "completed",
      affectedRows: 1,
    });
    expect(tableRows).toHaveLength(1);
    expect(service.getRunDetails(run.id).cleanupLogs).toHaveLength(1);
  });

  it("rejects updates from cleanup and rolls back every deletion on error", async () => {
    await service.captureBaseline(project.id, run.id, [check]);
    tableRows[0] = { ...tableRows[0], available: 0 };
    const updateDiff = await service.check(project.id, run.id, check);
    expect(updateDiff.tables[0]?.updated).toHaveLength(1);
    expect(() =>
      service.previewCleanup(run.id, updateDiff.id, [
        {
          tableName: "booking_slots",
          identity: updateDiff.tables[0]?.updated[0]?.identity ?? {},
        },
      ]),
    ).toThrow("exclusiv rânduri");

    tableRows.push(
      {
        service_code: "semantic",
        appointment_date: "2027-08-15",
        appointment_time: "10:30:00",
        available: 1,
      },
      {
        service_code: "semantic",
        appointment_date: "2027-08-15",
        appointment_time: "12:00:00",
        available: 1,
      },
    );
    const insertDiff = await service.check(project.id, run.id, check);
    const rows = insertDiff.tables[0]?.inserted ?? [];
    const preview = service.previewCleanup(
      run.id,
      insertDiff.id,
      rows.map((row) => ({
        tableName: "booking_slots",
        identity: row.identity,
      })),
    );
    const beforeCleanup = structuredClone(tableRows);
    failDeleteAt = 2;
    await expect(
      service.confirmCleanup(project.id, run.id, preview.id),
    ).rejects.toThrow("tranzacția a fost anulată");
    expect(tableRows).toEqual(beforeCleanup);
    expect(service.getRunDetails(run.id).cleanupLogs.at(-1)).toMatchObject({
      status: "failed",
      affectedRows: 0,
    });
  });
});
