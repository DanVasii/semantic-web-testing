import type { RunnerState } from "../../shared/runner.js";

export interface StatusBadgeProps {
  status: RunnerState;
}

const statusLabels: Record<RunnerState, string> = {
  idle: "Inactiv",
  preparing: "Se pregătește",
  browser_starting: "Browserul pornește",
  waiting_for_basic_auth: "Așteaptă autentificarea Basic",
  waiting_for_start: "Așteaptă pornirea",
  running: "Rulează",
  waiting_at_breakpoint: "Așteaptă la breakpoint",
  waiting_after_step: "Așteaptă după pas",
  waiting_for_missing_data: "Așteaptă date lipsă",
  waiting_for_fallback_decision: "Așteaptă decizia de fallback",
  waiting_for_manual_intervention: "Așteaptă intervenția manuală",
  waiting_for_mysql_check: "Așteaptă verificarea MySQL",
  waiting_for_imap_check: "Așteaptă verificarea IMAP",
  waiting_for_ai_analysis: "AI verifică rezultatele",
  paused_on_error: "Pauză la eroare",
  completed: "Finalizat",
  failed: "Eșuat",
  stopped: "Oprit",
};

const getStatusClasses = (status: RunnerState): string => {
  if (status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-800";
  }

  if (status === "failed") {
    return "border-red-200 bg-red-50 text-red-800";
  }

  if (status === "stopped" || status === "idle") {
    return "border-slate-200 bg-slate-100 text-slate-700";
  }

  if (status === "paused_on_error") {
    return "border-orange-200 bg-orange-50 text-orange-800";
  }

  if (status.startsWith("waiting_")) {
    return "border-amber-200 bg-amber-50 text-amber-800";
  }

  return "border-sky-200 bg-sky-50 text-sky-800";
};

export const StatusBadge = ({ status }: StatusBadgeProps) => (
  <span
    role="status"
    aria-label={`Status runner: ${statusLabels[status]}`}
    className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${getStatusClasses(status)}`}
  >
    {statusLabels[status]}
  </span>
);
