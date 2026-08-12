import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Project } from "../../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../persistence/database.js";
import {
  ProjectMySqlSettingsRepository,
  ProjectRepository,
} from "../persistence/repositories.js";
import type { MySqlGateway, ResolvedMySqlConnection } from "./mysql-gateway.js";
import { MySqlService } from "./mysql-service.js";

const NOW = "2026-07-26T09:00:00.000Z";
const project: Project = {
  id: "project-1",
  name: "Booking",
  baseUrl: "https://booking.example.test",
  normalizedBaseUrl: "https://booking.example.test/",
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

const connectionInput = {
  host: "mysql.internal",
  port: 3306,
  database: "booking",
  username: "tester",
  password: "very-secret",
  ssl: true,
};

const schemaRows: Record<string, unknown>[] = [
  {
    TABLE_NAME: "appointments",
    COLUMN_NAME: "tenant_id",
    DATA_TYPE: "bigint",
    COLUMN_TYPE: "bigint unsigned",
    IS_NULLABLE: "NO",
    COLUMN_DEFAULT: null,
    EXTRA: "",
    ORDINAL_POSITION: 1,
    IS_PRIMARY: 1,
  },
  {
    TABLE_NAME: "appointments",
    COLUMN_NAME: "id",
    DATA_TYPE: "bigint",
    COLUMN_TYPE: "bigint unsigned",
    IS_NULLABLE: "NO",
    COLUMN_DEFAULT: null,
    EXTRA: "auto_increment",
    ORDINAL_POSITION: 2,
    IS_PRIMARY: 1,
  },
  {
    TABLE_NAME: "appointments",
    COLUMN_NAME: "customer_email",
    DATA_TYPE: "varchar",
    COLUMN_TYPE: "varchar(255)",
    IS_NULLABLE: "NO",
    COLUMN_DEFAULT: null,
    EXTRA: "",
    ORDINAL_POSITION: 3,
    IS_PRIMARY: 0,
  },
  {
    TABLE_NAME: "audit_log",
    COLUMN_NAME: "message",
    DATA_TYPE: "text",
    COLUMN_TYPE: "text",
    IS_NULLABLE: "YES",
    COLUMN_DEFAULT: null,
    EXTRA: "",
    ORDINAL_POSITION: 1,
    IS_PRIMARY: 0,
  },
];

let directory: string;
let database: ApplicationDatabase;
let repository: ProjectMySqlSettingsRepository;
let connectedWith: ResolvedMySqlConnection[];
let query: ReturnType<
  typeof vi.fn<
    (
      sql: string,
      values?: readonly unknown[],
    ) => Promise<Record<string, unknown>[]>
  >
>;
let close: ReturnType<typeof vi.fn<() => Promise<void>>>;
let gateway: MySqlGateway;
let service: MySqlService;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-mysql-service-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  const projects = new ProjectRepository(database.connection);
  projects.create(project);
  repository = new ProjectMySqlSettingsRepository(database.connection);
  connectedWith = [];
  query = vi.fn((sql: string): Promise<Record<string, unknown>[]> =>
    Promise.resolve(
      sql.includes("information_schema.COLUMNS") ? schemaRows : [{ ok: 1 }],
    ),
  );
  close = vi.fn(() => Promise.resolve());
  const connect: MySqlGateway["connect"] = (config) => {
    connectedWith.push(config);
    return Promise.resolve({
      query: (
        sql: string,
        values?: readonly unknown[],
      ): Promise<Record<string, unknown>[]> => query(sql, values),
      execute: (): Promise<{ affectedRows: number }> =>
        Promise.resolve({ affectedRows: 0 }),
      beginTransaction: (): Promise<void> => Promise.resolve(),
      commit: (): Promise<void> => Promise.resolve(),
      rollback: (): Promise<void> => Promise.resolve(),
      close: async (): Promise<void> => {
        await close();
      },
    });
  };
  gateway = {
    connect: vi.fn(connect),
  };
  service = new MySqlService(projects, repository, gateway, {
    now: () => new Date(NOW),
    secrets: {
      encrypt: (value) => `encrypted:${Buffer.from(value).toString("base64")}`,
      decrypt: (value) =>
        Buffer.from(value.replace("encrypted:", ""), "base64").toString(),
    },
  });
});

afterEach(() => {
  database.close();
  rmSync(directory, { recursive: true, force: true });
});

describe("MySqlService", () => {
  it("validates host and port before opening a connection", async () => {
    await expect(
      service.testConnection(project.id, {
        ...connectionInput,
        host: "mysql://localhost",
        port: 0,
      }),
    ).rejects.toThrow("Host-ul");
    expect(gateway.connect).not.toHaveBeenCalled();
  });

  it("encrypts the password, preserves it on edit and never returns it", async () => {
    const saved = service.save(project.id, connectionInput);

    expect(saved).toMatchObject({
      projectId: project.id,
      host: "mysql.internal",
      port: 3306,
      database: "booking",
      username: "tester",
      ssl: true,
      passwordConfigured: true,
      identities: [],
    });
    expect(saved).not.toHaveProperty("password");
    expect(repository.findByProjectId(project.id)?.encryptedPassword).toBe(
      "encrypted:dmVyeS1zZWNyZXQ=",
    );

    service.save(project.id, {
      ...connectionInput,
      username: "edited",
      password: undefined,
    });
    await service.testConnection(project.id, {
      ...connectionInput,
      username: "edited",
      password: undefined,
    });
    expect(connectedWith[0]).toMatchObject({
      username: "edited",
      password: "very-secret",
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("stores and uses an explicitly empty password", async () => {
    const saved = service.save(project.id, {
      ...connectionInput,
      password: "",
    });
    await service.testConnection(project.id, {
      ...connectionInput,
      password: undefined,
    });

    expect(saved.passwordConfigured).toBe(true);
    expect(repository.findByProjectId(project.id)?.encryptedPassword).toBe(
      "encrypted:",
    );
    expect(connectedWith[0]?.password).toBe("");
  });

  it("loads all table columns, detects composite primary keys and saves manual identity columns", async () => {
    service.save(project.id, connectionInput);

    const initial = await service.loadSchema(project.id);
    const appointments = initial.tables.find(
      (table) => table.name === "appointments",
    );
    const auditLog = initial.tables.find((table) => table.name === "audit_log");
    expect(appointments).toMatchObject({
      primaryKey: ["tenant_id", "id"],
      identityColumns: ["tenant_id", "id"],
      identitySource: "primary_key",
    });
    expect(
      appointments?.columns.find((column) => column.name === "customer_email"),
    ).toMatchObject({
      name: "customer_email",
      primaryKey: false,
    });
    expect(auditLog).toMatchObject({
      primaryKey: [],
      identityColumns: [],
      identitySource: "none",
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("information_schema.COLUMNS"),
      ["booking"],
    );

    const updated = await service.saveIdentityConfig(project.id, [
      {
        tableName: "appointments",
        columns: ["tenant_id", "customer_email"],
      },
      { tableName: "audit_log", columns: ["message"] },
    ]);
    expect(updated.tables).toEqual([
      expect.objectContaining({
        name: "appointments",
        identityColumns: ["tenant_id", "customer_email"],
        identitySource: "manual",
      }),
      expect.objectContaining({
        name: "audit_log",
        identityColumns: ["message"],
        identitySource: "manual",
      }),
    ]);
    expect(service.get(project.id).identities).toEqual([
      {
        tableName: "appointments",
        columns: ["tenant_id", "customer_email"],
      },
      { tableName: "audit_log", columns: ["message"] },
    ]);
  });

  it("rejects identity columns that do not exist in the live schema", async () => {
    service.save(project.id, connectionInput);

    await expect(
      service.saveIdentityConfig(project.id, [
        { tableName: "appointments", columns: ["invented_column"] },
      ]),
    ).rejects.toThrow("nu există");
  });

  it("returns a sanitized connection error without the password", async () => {
    gateway.connect = vi.fn().mockRejectedValue({
      code: "ER_ACCESS_DENIED_ERROR",
      message: `Access denied using password ${connectionInput.password}`,
    });

    await expect(
      service.testConnection(project.id, connectionInput),
    ).rejects.toThrow("ER_ACCESS_DENIED_ERROR");
    await expect(
      service.testConnection(project.id, connectionInput),
    ).rejects.not.toThrow(connectionInput.password);
  });
});
