import type { AiSettingsService } from "./ai-settings-service.js";
import type {
  PostRunAiEvaluation,
  PostRunAiEvaluationInput,
  PostRunAiFinding,
} from "../../shared/post-run-checks.js";
import type { JsonValue } from "../../shared/persistence.js";

interface EvaluationOutput {
  status: "passed" | "failed" | "inconclusive";
  summary: string;
  findings: PostRunAiFinding[];
}

const asEvaluationOutput = (value: unknown): EvaluationOutput => {
  const output = value as Partial<EvaluationOutput>;
  if (
    typeof output !== "object" ||
    output === null ||
    !["passed", "failed", "inconclusive"].includes(output.status ?? "") ||
    typeof output.summary !== "string" ||
    !Array.isArray(output.findings)
  ) {
    throw new Error("Evaluarea AI post-run nu este validă.");
  }
  return output as EvaluationOutput;
};

const record = (
  value: JsonValue | undefined,
): Record<string, JsonValue> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? value
    : undefined;

const compactMySqlEvidence = (value: JsonValue): JsonValue => {
  const details = record(value);
  if (details === undefined) return value;
  const diffs = Array.isArray(details.diffs) ? details.diffs : [];
  const tables = diffs.flatMap((diffValue): JsonValue[] => {
    const diff = record(diffValue);
    if (diff === undefined || !Array.isArray(diff.tables)) return [];
    return diff.tables.flatMap((tableValue): JsonValue[] => {
      const table = record(tableValue);
      if (table === undefined) return [];
      return [
        {
          ...(typeof diff.id === "string" ? { diffId: diff.id } : {}),
          ...(typeof diff.checkStepId === "string"
            ? { checkStepId: diff.checkStepId }
            : {}),
          tableName:
            typeof table.tableName === "string" ? table.tableName : "unknown",
          columns: Array.isArray(table.columns) ? table.columns : [],
          identityColumns: Array.isArray(table.identityColumns)
            ? table.identityColumns
            : [],
          inserted: Array.isArray(table.inserted) ? table.inserted : [],
          updated: Array.isArray(table.updated) ? table.updated : [],
          deleted: Array.isArray(table.deleted) ? table.deleted : [],
          duplicateIdentities: Array.isArray(table.duplicateIdentities)
            ? table.duplicateIdentities
            : [],
        },
      ];
    });
  });
  return {
    ...(typeof details.baselineSnapshotId === "string"
      ? { baselineSnapshotId: details.baselineSnapshotId }
      : {}),
    tables,
  };
};

export const compactPostRunEvidence = (
  evidence: PostRunAiEvaluationInput["evidence"],
): PostRunAiEvaluationInput["evidence"] => ({
  ...(evidence.mysql === undefined
    ? {}
    : { mysql: compactMySqlEvidence(evidence.mysql) }),
  ...(evidence.imap === undefined
    ? {}
    : { imap: structuredClone(evidence.imap) }),
});

export class PostRunAiEvaluationService {
  public constructor(
    private readonly aiSettings: AiSettingsService,
    private readonly now: () => Date,
  ) {}

  public async evaluate(
    input: PostRunAiEvaluationInput,
  ): Promise<PostRunAiEvaluation> {
    const generation = await this.aiSettings.generate({
      task: "evaluate_post_run",
      context: {
        testId: input.testId,
        runId: input.runId,
        instructions: input.prompt,
        dataset: input.dataset,
        evidence: compactPostRunEvidence(input.evidence),
        rules: {
          noAssumptions:
            "Folosește numai valorile prezente în evidence și dataset; datele absente produc inconclusive.",
          mysql:
            "Inserted, updated și deleted trebuie interpretate separat și raportate cu tabela și coloanele relevante.",
          customerUpsert:
            "Nu cere obligatoriu customers.inserted. Formulări precum «s-a creat clientul» sau «verifică clientul» nu înseamnă că trebuie un rând nou: clientul poate exista deja și este suficient să fie actualizat, să rămână neschimbat ori să fie demonstrat prin customer_id-ul programării. Cere insert nou numai dacă se solicită explicit o adresă nouă sau unică.",
          imap: "Compară subiectul, expeditorul, destinatarii și corpul mesajului cu instrucțiunea comună și valorile datasetului.",
          correlation:
            "Corelează dovezile MySQL și IMAP între ele și cu valorile efective ale datasetului.",
        },
      },
      ...(input.provider === undefined ? {} : { provider: input.provider }),
      ...(input.model === undefined ? {} : { model: input.model }),
    });
    const output = asEvaluationOutput(generation.output);
    return {
      ...output,
      findings: structuredClone(output.findings),
      provider: generation.provider,
      model: generation.model,
      usage: generation.usage,
      evaluatedAt: this.now().toISOString(),
    };
  }
}
