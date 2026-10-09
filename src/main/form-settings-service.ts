import {
  FORM_DEFAULT_KEYS,
  type ProjectFormSettings,
  type SaveProjectFormSettingsInput,
} from "../shared/form-analysis.js";
import {
  ImapAccountRepository,
  ProjectRepository,
} from "./persistence/repositories.js";
import { ProjectFormSettingsRepository } from "./persistence/form-settings-repository.js";

export class FormSettingsService {
  public constructor(
    private readonly projects: ProjectRepository,
    private readonly imapAccounts: ImapAccountRepository,
    private readonly settings: ProjectFormSettingsRepository,
    private readonly now: () => Date,
  ) {}

  public get(projectId: string): ProjectFormSettings {
    this.requireProject(projectId);
    return this.settings.get(projectId);
  }

  public save(
    projectId: string,
    input: SaveProjectFormSettingsInput,
  ): ProjectFormSettings {
    this.requireProject(projectId);
    if (typeof input !== "object" || input === null) {
      throw new Error("Setările formularelor nu sunt valide.");
    }
    const defaults = Object.fromEntries(
      FORM_DEFAULT_KEYS.flatMap((key) => {
        const value = input.defaults?.[key];
        if (value === undefined) return [];
        if (
          typeof value !== "string" ||
          value.length > 500 ||
          /[\r\n]/.test(value)
        ) {
          throw new Error(`Valoarea implicită pentru ${key} nu este validă.`);
        }
        if (value.trim().length === 0) return [];
        return [[key, value.trim()]];
      }),
    );
    const accountId = input.defaultImapAccountId?.trim();
    if (
      accountId !== undefined &&
      accountId.length > 0 &&
      this.imapAccounts.findById(accountId) === undefined
    ) {
      throw new Error("Contul IMAP implicit nu există.");
    }
    return this.settings.save({
      projectId,
      defaults,
      ...(accountId === undefined || accountId.length === 0
        ? {}
        : { defaultImapAccountId: accountId }),
      updatedAt: this.now().toISOString(),
    });
  }

  private requireProject(projectId: string): void {
    if (this.projects.findById(projectId) === undefined) {
      throw new Error("Proiectul nu există.");
    }
  }
}
