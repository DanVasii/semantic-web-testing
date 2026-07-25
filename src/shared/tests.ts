import type { Project, TestDefinition, TestMode } from "./persistence.js";

export interface TestInput {
  name: string;
  description?: string;
  startUrl: string;
  testMode?: TestMode;
  wipeBeforeRun?: boolean;
}

export interface TestInputErrors {
  name?: string;
  description?: string;
  startUrl?: string;
  wipeBeforeRun?: string;
  testMode?: string;
}

export const normalizeTestStartUrl = (value: string): string =>
  new URL(value.trim()).toString();

export const validateTestInput = (
  input: TestInput,
  project: Project,
): TestInputErrors => {
  const errors: TestInputErrors = {};
  const name = input.name.trim();
  const description = input.description?.trim() ?? "";
  const startUrl = input.startUrl.trim();

  if (
    input.wipeBeforeRun !== undefined &&
    typeof input.wipeBeforeRun !== "boolean"
  ) {
    errors.wipeBeforeRun = "Configurarea wipe trebuie să fie booleană.";
  }
  if (
    input.testMode !== undefined &&
    input.testMode !== "recorded" &&
    input.testMode !== "dynamic_ai"
  ) {
    errors.testMode = "Tipul testului nu este valid.";
  }

  if (name.length === 0) {
    errors.name = "Numele testului este obligatoriu.";
  } else if (name.length > 120) {
    errors.name = "Numele testului poate avea maximum 120 de caractere.";
  }

  if (description.length > 500) {
    errors.description = "Descrierea poate avea maximum 500 de caractere.";
  }

  if (startUrl.length === 0) {
    errors.startUrl = "URL-ul de start este obligatoriu.";
  } else {
    try {
      const url = new URL(startUrl);
      const projectUrl = new URL(project.normalizedBaseUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.startUrl =
          "URL-ul de start trebuie să folosească HTTP sau HTTPS.";
      } else if (url.username.length > 0 || url.password.length > 0) {
        errors.startUrl = "Credentialele nu pot fi incluse în URL.";
      } else if (url.origin !== projectUrl.origin) {
        errors.startUrl =
          "URL-ul de start trebuie să aparțină site-ului proiectului.";
      }
    } catch {
      errors.startUrl = "Introdu un URL de start complet și valid.";
    }
  }

  return errors;
};

export const hasTestInputErrors = (errors: TestInputErrors): boolean =>
  Object.keys(errors).length > 0;

export const getTestPrimaryAction = (
  test: TestDefinition,
):
  | "Înregistrează testul"
  | "Done"
  | "Finalizează analiza"
  | "Așteaptă analiza"
  | "Revizuiește pașii"
  | "Rulează testul" => {
  switch (test.workflowState) {
    case "recording":
      return "Done";
    case "recorded":
      return "Finalizează analiza";
    case "analyzing_flow":
      return "Așteaptă analiza";
    case "flow_analyzed":
      return "Revizuiește pașii";
    case "ready":
      return "Rulează testul";
    default:
      return "Înregistrează testul";
  }
};
