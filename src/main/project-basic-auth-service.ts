import type {
  BasicAuthCredentials,
  ProjectBasicAuthSettings,
  SaveProjectBasicAuthInput,
} from "../shared/browser-manager.js";
import {
  ProjectBasicAuthRepository,
  ProjectRepository,
} from "./persistence/repositories.js";

export interface SecretProtector {
  encrypt: (value: string) => string;
  decrypt: (value: string) => string;
}

export interface ProjectBasicAuthServiceOptions {
  now: () => Date;
  secrets: SecretProtector;
}

export class ProjectBasicAuthService {
  public constructor(
    private readonly projectRepository: ProjectRepository,
    private readonly authRepository: ProjectBasicAuthRepository,
    private readonly options: ProjectBasicAuthServiceOptions,
  ) {}

  public get(projectId: string): ProjectBasicAuthSettings {
    const project = this.requireProject(projectId);
    const origin = new URL(project.normalizedBaseUrl).origin;
    const record = this.authRepository.findByProjectId(projectId);
    if (record === undefined) {
      return {
        projectId,
        origin,
        username: "",
        configured: false,
      };
    }
    return {
      projectId,
      origin,
      username: record.username,
      configured: record.origin === origin,
      updatedAt: record.updatedAt,
    };
  }

  public save(
    projectId: string,
    input: SaveProjectBasicAuthInput,
  ): ProjectBasicAuthSettings {
    const project = this.requireProject(projectId);
    const username = input.username.trim();
    if (username.length === 0 || username.length > 512) {
      throw new Error("Username-ul HTTP Basic nu este valid.");
    }
    const existing = this.authRepository.findByProjectId(projectId);
    const password = input.password;
    if (
      password !== undefined &&
      (password.length === 0 || password.length > 512)
    ) {
      throw new Error("Parola HTTP Basic nu este validă.");
    }
    if (password === undefined && existing === undefined) {
      throw new Error("Parola HTTP Basic este obligatorie la prima salvare.");
    }
    const origin = new URL(project.normalizedBaseUrl).origin;
    const updatedAt = this.options.now().toISOString();
    this.authRepository.upsert({
      projectId,
      origin,
      username,
      encryptedPassword:
        password === undefined
          ? (existing?.encryptedPassword ?? "")
          : this.options.secrets.encrypt(password),
      updatedAt,
    });
    return {
      projectId,
      origin,
      username,
      configured: true,
      updatedAt,
    };
  }

  public delete(projectId: string): boolean {
    this.requireProject(projectId);
    return this.authRepository.delete(projectId);
  }

  public resolve(
    projectId: string,
    origin: string,
  ): BasicAuthCredentials | undefined {
    this.requireProject(projectId);
    const record = this.authRepository.findByProjectId(projectId);
    if (record === undefined || record.origin !== origin) return undefined;
    return {
      username: record.username,
      password: this.options.secrets.decrypt(record.encryptedPassword),
    };
  }

  private requireProject(projectId: string) {
    const project = this.projectRepository.findById(projectId);
    if (project === undefined) {
      throw new Error("Proiectul nu există.");
    }
    return project;
  }
}
