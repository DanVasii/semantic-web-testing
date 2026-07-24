import type { Project } from "./persistence.js";

export interface ProjectInput {
  name: string;
  baseUrl: string;
}

export interface ProjectInputErrors {
  name?: string;
  baseUrl?: string;
}

export interface ProjectStatistics {
  pageCount: number;
  testCount: number;
  runCount: number;
  lastRunAt?: string;
}

export interface ProjectOverview {
  project: Project;
  statistics: ProjectStatistics;
}

export const normalizeProjectUrl = (value: string): string => {
  const url = new URL(value.trim());
  url.search = "";
  url.hash = "";
  return url.toString();
};

export const validateProjectInput = (
  input: ProjectInput,
): ProjectInputErrors => {
  const errors: ProjectInputErrors = {};
  const name = input.name.trim();
  const baseUrl = input.baseUrl.trim();

  if (name.length === 0) {
    errors.name = "Numele proiectului este obligatoriu.";
  } else if (name.length > 100) {
    errors.name = "Numele proiectului poate avea maximum 100 de caractere.";
  }

  if (baseUrl.length === 0) {
    errors.baseUrl = "URL-ul proiectului este obligatoriu.";
  } else {
    try {
      const url = new URL(baseUrl);

      if (url.protocol !== "http:" && url.protocol !== "https:") {
        errors.baseUrl = "URL-ul trebuie să folosească HTTP sau HTTPS.";
      } else if (url.hostname.length === 0) {
        errors.baseUrl = "URL-ul trebuie să conțină un domeniu valid.";
      } else if (url.username.length > 0 || url.password.length > 0) {
        errors.baseUrl = "Credentialele nu pot fi incluse în URL.";
      }
    } catch {
      errors.baseUrl = "Introdu un URL complet și valid.";
    }
  }

  return errors;
};

export const hasProjectInputErrors = (errors: ProjectInputErrors): boolean =>
  Object.keys(errors).length > 0;
