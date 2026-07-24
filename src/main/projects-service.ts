import type { Project } from "../shared/persistence.js";
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

  public delete(projectId: string): boolean {
    return this.repository.delete(projectId);
  }

  private assertValid(input: ProjectInput): void {
    if (hasProjectInputErrors(validateProjectInput(input))) {
      throw new Error("Datele proiectului nu sunt valide.");
    }
  }

  private getOverview(project: Project): ProjectOverview {
    return {
      project,
      statistics: this.repository.getStatistics(project.id),
    };
  }
}
