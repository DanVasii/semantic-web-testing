import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import { ProjectRepository } from "./persistence/repositories.js";
import { ProjectsService } from "./projects-service.js";

let directory: string;
let applicationDatabase: ApplicationDatabase;
let repository: ProjectRepository;
let service: ProjectsService;
let clock = new Date("2026-07-24T10:00:00.000Z");

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-app-project-service-"));
  applicationDatabase = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  repository = new ProjectRepository(applicationDatabase.connection);
  service = new ProjectsService(repository, {
    createId: () => "project-1",
    now: () => clock,
  });
});

afterEach(() => {
  applicationDatabase.close();
  rmSync(directory, { recursive: true, force: true });
  clock = new Date("2026-07-24T10:00:00.000Z");
});

describe("ProjectsService", () => {
  it("creates a normalized project with safe defaults", () => {
    const overview = service.create({
      name: " Magazin demo ",
      baseUrl: "https://example.test/booking?service=10#calendar",
    });

    expect(overview.project).toMatchObject({
      id: "project-1",
      name: "Magazin demo",
      baseUrl: "https://example.test/booking?service=10#calendar",
      normalizedBaseUrl: "https://example.test/booking",
      browserConfig: {
        browserType: "chromium",
        sessionMode: "temporary",
        headless: false,
      },
    });
    expect(overview.statistics).toEqual({
      pageCount: 0,
      testCount: 0,
      runCount: 0,
    });
    expect(service.list()).toEqual([overview]);
  });

  it("updates an existing project without replacing its configuration", () => {
    const created = service.create({
      name: "Inițial",
      baseUrl: "https://example.test/old",
    });
    clock = new Date("2026-07-24T11:00:00.000Z");

    const updated = service.update(created.project.id, {
      name: "Actualizat",
      baseUrl: "https://example.test/new?draft=1",
    });

    expect(updated.project).toMatchObject({
      name: "Actualizat",
      normalizedBaseUrl: "https://example.test/new",
      createdAt: "2026-07-24T10:00:00.000Z",
      updatedAt: "2026-07-24T11:00:00.000Z",
      browserConfig: created.project.browserConfig,
    });
  });

  it("persists a valid browser configuration", () => {
    const created = service.create({
      name: "Configurare browser",
      baseUrl: "https://example.test",
    });
    clock = new Date("2026-07-24T11:00:00.000Z");

    const updated = service.updateBrowserConfig(created.project.id, {
      browserType: "chrome",
      sessionMode: "external_chrome_debug",
      headless: false,
      profilePath: "D:\\profiles\\semantic",
      remoteDebuggingPort: 9333,
      viewport: { width: 1440, height: 900 },
    });

    expect(updated.project.browserConfig).toEqual({
      browserType: "chrome",
      sessionMode: "external_chrome_debug",
      headless: false,
      profilePath: "D:\\profiles\\semantic",
      remoteDebuggingPort: 9333,
      viewport: { width: 1440, height: 900 },
    });
    expect(service.list()[0]?.project.browserConfig).toEqual(
      updated.project.browserConfig,
    );
  });

  it("rejects invalid data and missing projects", () => {
    expect(() => service.create({ name: "", baseUrl: "not-a-url" })).toThrow(
      "Datele proiectului nu sunt valide.",
    );
    expect(() =>
      service.update("missing", {
        name: "Valid",
        baseUrl: "https://example.test",
      }),
    ).toThrow("Proiectul nu mai există.");
  });

  it("deletes projects and reports whether a row existed", () => {
    service.create({
      name: "Temporar",
      baseUrl: "https://example.test",
    });

    expect(service.delete("project-1")).toBe(true);
    expect(service.delete("project-1")).toBe(false);
    expect(service.list()).toEqual([]);
  });
});
