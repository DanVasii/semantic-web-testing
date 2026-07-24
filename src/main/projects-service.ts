import type { BrowserConfig, Project } from "../shared/persistence.js";
import {
  hasProjectInputErrors,
  normalizeProjectUrl,
  validateProjectInput,
  type ProjectInput,
  type ProjectOverview,
} from "../shared/projects.js";
import { ProjectRepository } from "./persistence/repositories.js";

export interface ProjectsServiceOptions {
  createId: () => string;
  now: () => Date;
}

const createDefaultProject = (
  id: string,
  input: ProjectInput,
  now: string,
): Project => ({
  id,
  name: input.name.trim(),
  baseUrl: input.baseUrl.trim(),
  normalizedBaseUrl: normalizeProjectUrl(input.baseUrl),
  createdAt: now,
  updatedAt: now,
  browserConfig: {
    browserType: "chromium",
    sessionMode: "temporary",
    headless: false,
    viewport: {
      width: 1440,
      height: 900,
    },
  },
  aiConfig: {},
  shortcutConfig: {},
});

export class ProjectsService {
  public constructor(
    private readonly repository: ProjectRepository,
    private readonly options: ProjectsServiceOptions,
  ) {}

  public list(): ProjectOverview[] {
    return this.repository.list().map((project) => ({
      project,
      statistics: this.repository.getStatistics(project.id),
    }));
  }

  public create(input: ProjectInput): ProjectOverview {
    this.assertValid(input);
    const project = createDefaultProject(
      this.options.createId(),
      input,
      this.options.now().toISOString(),
    );
    this.repository.create(project);
    return this.getOverview(project);
  }

  public update(projectId: string, input: ProjectInput): ProjectOverview {
    this.assertValid(input);
    const existing = this.repository.findById(projectId);

    if (existing === undefined) {
      throw new Error("Proiectul nu mai există.");
    }

    const project: Project = {
      ...existing,
      name: input.name.trim(),
      baseUrl: input.baseUrl.trim(),
      normalizedBaseUrl: normalizeProjectUrl(input.baseUrl),
      updatedAt: this.options.now().toISOString(),
    };
    this.repository.update(project);
    return this.getOverview(project);
  }

  public updateBrowserConfig(
    projectId: string,
    browserConfig: BrowserConfig,
  ): ProjectOverview {
    const existing = this.repository.findById(projectId);

    if (existing === undefined) {
      throw new Error("Proiectul nu mai există.");
    }

    this.assertValidBrowserConfig(browserConfig);
    const project: Project = {
      ...existing,
      browserConfig,
      updatedAt: this.options.now().toISOString(),
    };
    this.repository.update(project);
    return this.getOverview(project);
  }

  public delete(projectId: string): boolean {
    return this.repository.delete(projectId);
  }

  private assertValid(input: ProjectInput): void {
    if (hasProjectInputErrors(validateProjectInput(input))) {
      throw new Error("Datele proiectului nu sunt valide.");
    }
  }

  private assertValidBrowserConfig(config: BrowserConfig): void {
    const validBrowserTypes = new Set([
      "chrome",
      "chromium",
      "firefox",
      "webkit",
    ]);
    const validSessionModes = new Set([
      "temporary",
      "reusable",
      "persistent_profile",
      "external_chrome_debug",
    ]);

    if (
      !validBrowserTypes.has(config.browserType) ||
      !validSessionModes.has(config.sessionMode) ||
      config.headless !== false
    ) {
      throw new Error("Configurația browserului nu este validă.");
    }

    if (
      config.remoteDebuggingPort !== undefined &&
      (!Number.isInteger(config.remoteDebuggingPort) ||
        config.remoteDebuggingPort < 1024 ||
        config.remoteDebuggingPort > 65_535)
    ) {
      throw new Error("Portul remote debugging nu este valid.");
    }

    if (
      config.viewport !== undefined &&
      (!Number.isInteger(config.viewport.width) ||
        !Number.isInteger(config.viewport.height) ||
        config.viewport.width < 320 ||
        config.viewport.height < 240)
    ) {
      throw new Error("Dimensiunea viewport-ului nu este validă.");
    }
  }

  private getOverview(project: Project): ProjectOverview {
    return {
      project,
      statistics: this.repository.getStatistics(project.id),
    };
  }
}
