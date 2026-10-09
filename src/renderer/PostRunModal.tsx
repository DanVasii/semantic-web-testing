import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { StepRunResult } from "../shared/persistence.js";
import {
  MANUAL_WIPE_RESOURCES,
  type ManualWipeResource,
  type RunnerSnapshot,
  type VisualCheckDebug,
} from "../shared/runner.js";
import { Button } from "./components/Button.js";
import { Modal } from "./components/Modal.js";
import { EmailMessagePreview } from "./EmailMessagePreview.js";
import { MySqlRunPanel } from "./MySqlRunPanel.js";
import {
  VisualCheckEvidence,
  visualCheckDebugFrom,
} from "./VisualCheckEvidence.js";

export interface PostRunModalProps {
  api: SemanticAppApi;
  open: boolean;
  snapshot: RunnerSnapshot;
  stepResults?: StepRunResult[];
  onClose: () => void;
  onSnapshot: (snapshot: RunnerSnapshot) => void;
}

const resourceLabels: Record<ManualWipeResource, string> = {
  cookies: "Cookies",
  localStorage: "localStorage",
  sessionStorage: "sessionStorage",
  indexedDB: "IndexedDB",
  cacheStorage: "Cache Storage",
  serviceWorkers: "Service workers",
};

const terminalStates = new Set<RunnerSnapshot["state"]>([
  "completed",
  "failed",
  "stopped",
  "paused_on_error",
]);

const collectImapMessages = (snapshot: RunnerSnapshot) => {
  const allEvidence = snapshot.imap?.allEvidence as
    | undefined
    | {
        checks?: Array<{
          messages?: NonNullable<RunnerSnapshot["imap"]>["matchedMessages"];
        }>;
      };
  const messages = [
    ...(allEvidence?.checks?.flatMap((check) => check.messages ?? []) ?? []),
    ...(snapshot.imap?.matchedMessages ?? []),
  ];

  return messages.filter(
    (message, index, all) =>
      all.findIndex(
        (candidate) =>
          candidate.uid === message.uid &&
          candidate.accountId === message.accountId &&
          candidate.mailbox === message.mailbox,
      ) === index,
  );
};

const collectVisualEvidence = (
  result: StepRunResult | undefined,
): VisualCheckDebug[] =>
  (result?.logs ?? [])
    .map(visualCheckDebugFrom)
    .filter((debug): debug is VisualCheckDebug => debug !== undefined);

export const PostRunModal = ({
  api,
  onClose,
  onSnapshot,
  open,
  snapshot,
  stepResults = [],
}: PostRunModalProps) => {
  const [secondsLeft, setSecondsLeft] = useState(30);
  const [selectedResources, setSelectedResources] = useState<
    ManualWipeResource[]
  >([]);
  const [busy, setBusy] = useState<"imap" | "abandon" | "stop" | "wipe">();
  const [error, setError] = useState<string>();
  const waitingForImap = snapshot.state === "waiting_for_imap_check";
  const runId = snapshot.run?.id;
  const imapPollingActive =
    open && waitingForImap && secondsLeft > 0 && runId !== undefined;
  const canWipe =
    snapshot.run !== undefined && terminalStates.has(snapshot.state);
  const imapMessages = useMemo(() => collectImapMessages(snapshot), [snapshot]);
  const stepResultsById = useMemo(
    () => new Map(stepResults.map((result) => [result.stepId, result])),
    [stepResults],
  );
  const runWarnings = useMemo(
    () =>
      (snapshot.run?.warnings ?? []).map((warning, index) => {
        if (
          typeof warning === "object" &&
          warning !== null &&
          !Array.isArray(warning)
        ) {
          return {
            key: `${typeof warning.code === "string" ? warning.code : "warning"}-${index}`,
            message:
              typeof warning.message === "string"
                ? warning.message
                : "Rularea conține un avertisment fără detalii.",
          };
        }
        return {
          key: `warning-${index}`,
          message:
            typeof warning === "string"
              ? warning
              : "Rularea conține un avertisment.",
        };
      }),
    [snapshot.run?.warnings],
  );
  const passedChecks = useMemo(() => {
    const checkItems =
      snapshot.checkItems ??
      snapshot.flowItems?.filter(
        (item): item is Extract<typeof item, { type: "check" }> =>
          item.type === "check" && item.enabled,
      ) ??
      [];
    if (snapshot.state !== "completed" || checkItems.length === 0) return [];
    return checkItems.every((check) => {
      const status = stepResultsById.get(check.id)?.status;
      return status === "passed" || status === "passed_with_fallback";
    })
      ? checkItems
      : [];
  }, [
    snapshot.checkItems,
    snapshot.flowItems,
    snapshot.state,
    stepResultsById,
  ]);

  useEffect(() => {
    if (!open || !waitingForImap || secondsLeft <= 0) return;
    const timer = window.setInterval(() => {
      setSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);
    return () => {
      window.clearInterval(timer);
    };
  }, [open, secondsLeft, waitingForImap]);

  useEffect(() => {
    if (!imapPollingActive || runId === undefined) return;
    let active = true;
    let requestInFlight = false;
    const poll = async (): Promise<void> => {
      if (requestInFlight) return;
      requestInFlight = true;
      setBusy("imap");
      try {
        const nextSnapshot = await api.pollImapCheck(runId);
        if (active) onSnapshot(nextSnapshot);
      } catch (reason) {
        if (active) {
          setError(
            reason instanceof Error
              ? reason.message
              : "Verificarea IMAP nu a putut fi actualizată.",
          );
        }
      } finally {
        requestInFlight = false;
        if (active) {
          setBusy(undefined);
        }
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 3000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [api, imapPollingActive, onSnapshot, runId]);

  useEffect(() => {
    if (!waitingForImap) setSecondsLeft(30);
  }, [waitingForImap]);

  useEffect(() => {
    if (waitingForImap) setSecondsLeft(30);
  }, [snapshot.imap?.stepId, waitingForImap]);

  const selectedSet = useMemo(
    () => new Set<ManualWipeResource>(selectedResources),
    [selectedResources],
  );

  const abandonImap = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setBusy("abandon");
    setError(undefined);
    try {
      onSnapshot(await api.abandonImapCheck(snapshot.run.id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Verificarea IMAP nu a putut fi abandonată.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const stopOnImapFailure = async (): Promise<void> => {
    if (snapshot.run === undefined) return;
    setBusy("stop");
    setError(undefined);
    try {
      onSnapshot(await api.stopRun(snapshot.run.id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Testul nu a putut fi oprit.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  const wipe = async (): Promise<void> => {
    if (snapshot.run === undefined || selectedResources.length === 0) return;
    setBusy("wipe");
    setError(undefined);
    try {
      onSnapshot(
        await api.manualWipeRunData(snapshot.run.id, selectedResources),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Wipe-ul manual nu a putut fi executat.",
      );
    } finally {
      setBusy(undefined);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Verificări post-run"
      size="wide"
    >
      <p>
        Acțiunile din browser s-au încheiat. Verificările bazei de date și ale
        e-mailului se finalizează înainte ca sesiunea să poată fi curățată.
      </p>

      {runWarnings.length > 0 ? (
        <section
          className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950"
          aria-label="Avertismente rulare"
        >
          <h3 className="font-semibold">Test finalizat cu avertismente</h3>
          <ul className="mt-2 grid gap-2 text-sm">
            {runWarnings.map((warning) => (
              <li key={warning.key}>{warning.message}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {passedChecks.length > 0 ? (
        <section
          className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950"
          aria-label="Rezumat verificări trecute"
        >
          <h3 className="font-semibold">
            Toate verificările au trecut cu succes
          </h3>
          <p className="mt-1 text-sm">
            {passedChecks.length === 1
              ? "A fost executată și validată o verificare."
              : `Au fost executate și validate ${passedChecks.length} verificări.`}
          </p>
          <ul className="mt-3 grid gap-2">
            {passedChecks.map((check) => {
              const visualEvidence = collectVisualEvidence(
                stepResultsById.get(check.id),
              );
              return (
                <li
                  key={check.id}
                  className="rounded-lg border border-emerald-200 bg-white p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{check.title}</strong>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold uppercase">
                      {check.checkType} · passed
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-emerald-900">
                    {check.humanDescription}
                  </p>
                  {visualEvidence.map((debug, index) => (
                    <VisualCheckEvidence
                      key={`${check.id}-visual-${index}`}
                      debug={debug}
                    />
                  ))}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {(() => {
        if (snapshot.error === undefined) return null;
        const failedStep = snapshot.error.stepId
          ? snapshot.flowItems?.find((i) => i.id === snapshot.error?.stepId)
          : undefined;
        const isCheck = failedStep?.type === "check";

        return (
          <section className="mt-4 rounded-xl border border-red-200 bg-red-50 p-4">
            <h3 className="font-semibold text-red-800">
              {isCheck ? "Test eșuat" : "Eroare de execuție"}
            </h3>
            <p className="mt-1 text-red-900">
              {isCheck
                ? `Testul a eșuat la verificarea: ${failedStep?.title}`
                : `Testul s-a oprit deoarece un pas a eșuat: ${snapshot.error.message}`}
            </p>
            {isCheck && failedStep?.humanDescription ? (
              <p className="mt-1 text-sm text-red-800">
                {failedStep.humanDescription}
              </p>
            ) : null}
            {snapshot.error.causeMessage ? (
              <p className="mt-2 text-sm text-red-800">
                Detalii: {snapshot.error.causeMessage}
              </p>
            ) : null}
            {snapshot.error.stepId ? (
              <p className="mt-1 text-xs text-red-700 font-mono">
                Pas ID: {snapshot.error.stepId}
              </p>
            ) : null}
            {snapshot.error.visualCheckDebug ? (
              <VisualCheckEvidence debug={snapshot.error.visualCheckDebug} />
            ) : null}
          </section>
        );
      })()}

      {snapshot.mysql === undefined ? (
        <section className="mt-4 rounded-xl border border-app-border bg-app-canvas p-4">
          <h3 className="font-semibold text-app-ink">Bază de date</h3>
          <p className="mt-1">Testul nu conține verificări MySQL active.</p>
        </section>
      ) : (
        <MySqlRunPanel api={api} snapshot={snapshot} onSnapshot={onSnapshot} />
      )}

      <section
        className="mt-4 rounded-xl border border-app-border bg-app-canvas p-4"
        aria-label="Verificare IMAP"
      >
        <h3 className="font-semibold text-app-ink">E-mail prin IMAP</h3>
        {waitingForImap ? (
          <>
            <p className="mt-1">
              {snapshot.imap?.message ??
                "Se așteaptă mesajul care corespunde filtrelor testului."}
            </p>
            <Button
              className="mt-3"
              variant="danger"
              disabled={busy !== undefined}
              onClick={() => void stopOnImapFailure()}
            >
              {busy === "stop"
                ? "Se oprește…"
                : "Oprește testul și marchează check failed"}
            </Button>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full bg-brand-600 transition-[width]"
                style={{ width: `${(secondsLeft / 30) * 100}%` }}
              />
            </div>
            <p className="mt-2 font-mono text-sm">
              {secondsLeft > 0
                ? `Se verifică încă ${secondsLeft} secunde…`
                : "Fereastra de 30 de secunde s-a încheiat."}
            </p>
            {secondsLeft === 0 ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={busy !== undefined}
                  onClick={() => {
                    setError(undefined);
                    setSecondsLeft(30);
                  }}
                >
                  Mai așteaptă 30 secunde
                </Button>
                <Button
                  variant="danger"
                  disabled={busy !== undefined}
                  onClick={() => void abandonImap()}
                >
                  {busy === "abandon"
                    ? "Se abandonează…"
                    : "Abandonează verificarea"}
                </Button>
              </div>
            ) : null}
          </>
        ) : snapshot.imap !== undefined ? (
          <>
            <p className="mt-1">
              {snapshot.imap.status === "matched" ? "Primit: " : "Abandonat: "}
              {snapshot.imap.message}
            </p>
          </>
        ) : (
          <p className="mt-1">Testul nu conține verificări IMAP active.</p>
        )}
        {imapMessages.length > 0 ? (
          <div className="mt-4" aria-label="Mesaje IMAP primite">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="font-semibold text-app-ink">
                {waitingForImap
                  ? `Mesaje primite până acum (${imapMessages.length})`
                  : `Mesaje primite (${imapMessages.length})`}
              </h4>
              {waitingForImap ? (
                <span className="text-xs text-violet-800">
                  Se așteaptă și celelalte căsuțe selectate…
                </span>
              ) : null}
            </div>
            {imapMessages.map((message) => (
              <EmailMessagePreview
                key={`${message.accountId}:${message.mailbox}:${message.uid}`}
                message={message}
              />
            ))}
          </div>
        ) : null}
      </section>

      <section
        className="mt-4 rounded-xl border border-brand-200 bg-brand-50 p-4"
        aria-label="Evaluare AI post-run"
      >
        <h3 className="font-semibold text-brand-950">
          Evaluare AI a rezultatelor
        </h3>
        {snapshot.state === "waiting_for_ai_analysis" ? (
          <p className="mt-1">Se analizează dovezile MySQL și IMAP…</p>
        ) : snapshot.postRunAi === undefined ? (
          <p className="mt-1">
            Evaluarea AI nu a fost selectată sau nu există instrucțiuni salvate.
          </p>
        ) : (
          <>
            <p className="mt-1 font-semibold">
              {snapshot.postRunAi.status === "passed"
                ? "Condițiile sunt îndeplinite"
                : snapshot.postRunAi.status === "failed"
                  ? "Condițiile nu sunt îndeplinite"
                  : "Dovezile sunt insuficiente"}
            </p>
            <p className="mt-1">{snapshot.postRunAi.summary}</p>
            <ul className="mt-3 grid gap-2">
              {snapshot.postRunAi.findings.map((finding, index) => (
                <li
                  key={`${finding.source}-${index}`}
                  className="rounded-lg border border-brand-200 bg-white p-3"
                >
                  <strong>
                    {finding.source === "mysql" ? "MySQL" : "IMAP"} ·{" "}
                    {finding.passed ? "OK" : "Nu corespunde"}
                  </strong>
                  <p className="mt-1">{finding.message}</p>
                  {finding.evidence.length > 0 ? (
                    <ul className="mt-2 list-disc pl-5 text-xs">
                      {finding.evidence.map((evidence, evidenceIndex) => (
                        <li key={evidenceIndex}>{evidence}</li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs">
              {snapshot.postRunAi.provider} · {snapshot.postRunAi.model} ·{" "}
              {snapshot.postRunAi.usage.totalTokens} tokenuri
            </p>
          </>
        )}
      </section>

      <section
        className="mt-4 rounded-xl border border-orange-200 bg-orange-50 p-4"
        aria-label="Wipe manual"
      >
        <h3 className="font-semibold text-orange-950">
          Curățare manuală a sesiunii
        </h3>
        <p className="mt-1 text-orange-900">
          Nimic nu este șters automat. Selectează explicit datele pe care vrei
          să le cureți.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {MANUAL_WIPE_RESOURCES.map((resource) => (
            <label
              key={resource}
              className="flex items-center gap-2 rounded-lg border border-orange-200 bg-white px-3 py-2"
            >
              <input
                type="checkbox"
                checked={selectedSet.has(resource)}
                disabled={!canWipe || busy !== undefined}
                onChange={(event) => {
                  setSelectedResources((current) =>
                    event.target.checked
                      ? [...current, resource]
                      : current.filter((item) => item !== resource),
                  );
                }}
              />
              {resourceLabels[resource]}
            </label>
          ))}
        </div>
        <Button
          className="mt-3"
          variant="danger"
          disabled={
            !canWipe || selectedResources.length === 0 || busy !== undefined
          }
          onClick={() => void wipe()}
        >
          {busy === "wipe" ? "Se curăță…" : "Wipe date selectate"}
        </Button>
        {!canWipe ? (
          <p className="mt-2 text-xs text-orange-900">
            Finalizează sau abandonează verificările post-run înainte de wipe.
          </p>
        ) : null}

        {snapshot.cleanup !== undefined ? (
          <div
            className={`mt-4 rounded-lg border p-3 ${
              snapshot.cleanup.status === "completed"
                ? "border-emerald-300 bg-emerald-50"
                : "border-red-300 bg-red-50"
            }`}
          >
            <p className="font-semibold">
              {snapshot.cleanup.status === "completed"
                ? "Wipe finalizat"
                : "Wipe finalizat cu erori"}
            </p>
            <ul className="mt-2 grid gap-1 text-xs">
              {snapshot.cleanup.entries.map((entry, index) => (
                <li key={`${entry.resource}-${index}`}>
                  {entry.resource}: {entry.status} · {entry.message}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      {error !== undefined ? (
        <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-red-800">
          {error}
        </p>
      ) : null}

      <div className="mt-5 flex justify-end">
        <Button variant="secondary" onClick={onClose}>
          Închide
        </Button>
      </div>
    </Modal>
  );
};
