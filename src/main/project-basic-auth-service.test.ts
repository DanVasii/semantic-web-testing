import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Project } from "../shared/persistence.js";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "./persistence/database.js";
import {
  ProjectBasicAuthRepository,
  ProjectRepository,
} from "./persistence/repositories.js";
import { ProjectBasicAuthService } from "./project-basic-auth-service.js";

const NOW = "2026-07-25T10:00:00.000Z";
const project: Project = {
  id: "project-1",
  name: "Proiect protejat",
  baseUrl: "https://secure.example.test/app?preview=1",
  normalizedBaseUrl: "https://secure.example.test/app",
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

let directory: string;
let database: ApplicationDatabase;
let repository: ProjectBasicAuthRepository;
let service: ProjectBasicAuthService;

beforeEach(async () => {
  directory = mkdtempSync(join(tmpdir(), "semantic-app-basic-auth-"));
  database = await openApplicationDatabase({
    filePath: join(directory, "application.sqlite"),
  });
  const projectRepository = new ProjectRepository(database.connection);
  projectRepository.create(project);
  repository = new ProjectBasicAuthRepository(database.connection);
  service = new ProjectBasicAuthService(projectRepository, repository, {
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

describe("ProjectBasicAuthService", () => {
  it("reports an unconfigured project without exposing a password", () => {
    expect(service.get(project.id)).toEqual({
      projectId: project.id,
      origin: "https://secure.example.test",
      username: "",
      configured: false,
    });
  });

  it("encrypts credentials, resolves them for the project origin and preserves the password on edit", () => {
    const saved = service.save(project.id, {
      username: " initial-user ",
      password: "secret-value",
    });

    expect(saved).toMatchObject({
      projectId: project.id,
      origin: "https://secure.example.test",
      username: "initial-user",
      configured: true,
      updatedAt: NOW,
    });
    expect(saved).not.toHaveProperty("password");
    expect(repository.findByProjectId(project.id)?.encryptedPassword).toBe(
      "encrypted:c2VjcmV0LXZhbHVl",
    );
    expect(service.resolve(project.id, "https://secure.example.test")).toEqual({
      username: "initial-user",
      password: "secret-value",
    });
    expect(
      service.resolve(project.id, "https://other.example.test"),
    ).toBeUndefined();

    service.save(project.id, { username: "edited-user" });
    expect(service.resolve(project.id, "https://secure.example.test")).toEqual({
      username: "edited-user",
      password: "secret-value",
    });
  });

  it("requires a password on first save and can delete stored credentials", () => {
    expect(() => service.save(project.id, { username: "user" })).toThrowError(
      "Parola HTTP Basic este obligatorie la prima salvare.",
    );

    service.save(project.id, { username: "user", password: "secret" });
    expect(service.delete(project.id)).toBe(true);
    expect(service.get(project.id).configured).toBe(false);
    expect(service.resolve(project.id, "https://secure.example.test")).toBe(
      undefined,
    );
  });
});
