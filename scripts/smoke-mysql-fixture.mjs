import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { chromium } from "playwright-core";
import { createConnection } from "mysql2/promise";

import { createMySqlGateway } from "../dist/main/mysql/mysql-gateway.js";
import { MySqlService } from "../dist/main/mysql/mysql-service.js";
import { MySqlSnapshotService } from "../dist/main/mysql/mysql-snapshot-service.js";
import { openApplicationDatabase } from "../dist/main/persistence/database.js";
import {
  MySqlRunDataRepository,
  ProjectMySqlSettingsRepository,
  ProjectRepository,
  RunRepository,
  TestRepository,
} from "../dist/main/persistence/repositories.js";

const fixtureUrl =
  process.env["SEMANTIC_FIXTURE_URL"] ?? "http://127.0.0.1:4173/";
const executablePath =
  process.env["SEMANTIC_CHROME_PATH"] ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const now = "2026-07-26T12:00:00.000Z";
const mysqlConfig = {
  host: "127.0.0.1",
  port: 3306,
  database: "semantic_fixture",
  username: "root",
  password: "",
  ssl: false,
};

const directory = await mkdtemp(join(tmpdir(), "semantic-mysql-smoke-"));
const database = await openApplicationDatabase({
  filePath: join(directory, "application.sqlite"),
});
const projects = new ProjectRepository(database.connection);
const tests = new TestRepository(database.connection);
const runs = new RunRepository(database.connection);
projects.create({
  id: "mysql-smoke-project",
  name: "MySQL fixture",
  baseUrl: fixtureUrl,
  normalizedBaseUrl: fixtureUrl,
  createdAt: now,
  updatedAt: now,
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
  },
  aiConfig: {},
  shortcutConfig: {},
});
const service = new MySqlService(
  projects,
  new ProjectMySqlSettingsRepository(database.connection),
  createMySqlGateway(),
  {
    now: () => new Date(now),
    secrets: {
      encrypt: (value) => `fixture:${value}`,
      decrypt: (value) => value.slice("fixture:".length),
    },
  },
);
const mysqlCheck = {
  id: "mysql-check-appointments",
  type: "check",
  checkType: "mysql",
  title: "Verifică programarea în MySQL",
  humanDescription: "Compară tabela appointments cu baseline-ul rulării.",
  config: {
    tableNames: ["appointments"],
    identities: [{ tableName: "appointments", columns: ["id"] }],
  },
  enabled: true,
};
tests.create({
  id: "mysql-smoke-test",
  projectId: "mysql-smoke-project",
  name: "Formular cu MySQL",
  status: "valid",
  version: 1,
  testMode: "recorded",
  wipeBeforeRun: false,
  startMode: "base_url",
  startUrl: fixtureUrl,
  normalizedStartUrl: fixtureUrl,
  workflowState: "ready",
  createdAt: now,
  updatedAt: now,
  flowItems: [mysqlCheck],
});
runs.create({
  id: "mysql-smoke-run",
  projectId: "mysql-smoke-project",
  testId: "mysql-smoke-test",
  testVersion: 1,
  startedAt: now,
  status: "running",
  browserType: "chromium",
  pageVersionIds: [],
});
let nextMySqlId = 0;
const snapshotService = new MySqlSnapshotService(
  service,
  new MySqlRunDataRepository(database.connection),
  runs,
  {
    createId: () => `mysql-smoke-${++nextMySqlId}`,
    now: () => new Date(now),
  },
);

const connection = await createConnection({
  host: mysqlConfig.host,
  port: mysqlConfig.port,
  database: mysqlConfig.database,
  user: mysqlConfig.username,
  password: mysqlConfig.password,
  dateStrings: true,
});
const browser = await chromium.launch({ executablePath, headless: true });

try {
  const saved = service.save("mysql-smoke-project", mysqlConfig);
  assert.equal(saved.passwordConfigured, true);
  assert.ok(!("password" in saved));
  const connectionResult = await service.testConnection("mysql-smoke-project", {
    ...mysqlConfig,
    password: undefined,
  });
  assert.equal(connectionResult.success, true);
  const schema = await service.loadSchema("mysql-smoke-project");
  assert.deepEqual(
    schema.tables.map((table) => table.name),
    ["appointments", "appointment_events", "booking_slots", "customers"],
  );
  assert.deepEqual(
    schema.tables.find((table) => table.name === "booking_slots")?.primaryKey,
    ["service_code", "appointment_date", "appointment_time"],
  );
  assert.equal(
    schema.tables.find((table) => table.name === "appointment_events")
      ?.identitySource,
    "none",
  );

  await connection.query("DELETE FROM appointment_events");
  await connection.query("DELETE FROM appointments");
  await connection.query("DELETE FROM customers");
  const baseline = await snapshotService.captureBaseline(
    "mysql-smoke-project",
    "mysql-smoke-run",
    [mysqlCheck],
  );
  assert.equal(baseline?.tables[0]?.rows.length, 0);

  const page = await browser.newPage({
    viewport: { width: 1280, height: 3000 },
  });
  await page.goto(fixtureUrl);
  await page
    .locator('[data-testid="fixture-database-status"]')
    .filter({ hasText: "connected" })
    .waitFor();
  await page.locator("#customer-email").fill("mysql-smoke@example.test");
  await page.locator("#customer-name").fill("Ana Fixture");
  await page.locator("#customer-password").fill("fixture-secret");
  await page.locator('input[value="premium"]').check();
  await page.locator('select[name="service"]').selectOption("semantic");
  await page.locator('[data-testid="calendar-year"]').selectOption("2027");
  await page.locator('[data-testid="calendar-next-month"]').click();
  await page.locator('[data-testid="calendar-day-2027-08-15"]').click();
  await page.getByRole("button", { name: "10:30" }).click();
  await page.locator('[data-testid="fixture-submit"]').click();
  await page
    .locator('[data-testid="fixture-database-status"]')
    .filter({ hasText: /saved .* appointment #/ })
    .waitFor();

  const [appointments] = await connection.query(
    `SELECT
       c.email,
       c.password_hash,
       c.customer_plan,
       a.appointment_date,
       a.appointment_time
     FROM appointments a
     INNER JOIN customers c ON c.id = a.customer_id
     WHERE c.email = ?`,
    ["mysql-smoke@example.test"],
  );
  assert.equal(appointments.length, 1);
  assert.equal(appointments[0]?.email, "mysql-smoke@example.test");
  assert.notEqual(appointments[0]?.password_hash, "fixture-secret");
  assert.equal(appointments[0]?.customer_plan, "premium");
  assert.equal(appointments[0]?.appointment_date, "2027-08-15");
  assert.equal(appointments[0]?.appointment_time, "10:30:00");
  await page
    .locator('[data-testid="fixture-appointments"]')
    .getByText("mysql-smoke@example.test")
    .waitFor();
  const diff = await snapshotService.check(
    "mysql-smoke-project",
    "mysql-smoke-run",
    mysqlCheck,
  );
  assert.equal(diff.tables[0]?.inserted.length, 1);
  const inserted = diff.tables[0]?.inserted[0];
  assert.ok(inserted);
  const preview = snapshotService.previewCleanup("mysql-smoke-run", diff.id, [
    { tableName: "appointments", identity: inserted.identity },
  ]);
  assert.equal(preview.rows[0]?.conditions.length, 1);
  const cleanup = await snapshotService.confirmCleanup(
    "mysql-smoke-project",
    "mysql-smoke-run",
    preview.id,
  );
  assert.equal(cleanup.status, "completed");
  assert.equal(cleanup.affectedRows, 1);
  const [remainingAppointments] = await connection.query(
    "SELECT COUNT(*) AS row_count FROM appointments",
  );
  assert.equal(Number(remainingAppointments[0]?.row_count), 0);

  process.stdout.write(
    "MySQL fixture smoke passed: V config/schema, W baseline/diff and X transactional cleanup verified.\n",
  );
} finally {
  await connection.query("DELETE FROM appointment_events");
  await connection.query("DELETE FROM appointments");
  await connection.query("DELETE FROM customers");
  await browser.close();
  await connection.end();
  database.close();
  await rm(directory, { recursive: true, force: true });
}
