import { useState } from "react";

import type { AiRunCost, AiRunRequestDetail } from "../../shared/runner.js";
import { Button } from "./Button.js";

export interface AiRunCostDetailsProps {
  cost: AiRunCost;
  className?: string;
}

const formatCost = (request: AiRunRequestDetail): string => {
  if (request.local) return "local · fără cost API";
  if (request.estimatedUsd === undefined) return "preț indisponibil";
  return `$${request.estimatedUsd.toFixed(6)}`;
};

const JsonBlock = ({ label, value }: { label: string; value: unknown }) => (
  <details className="rounded-lg border border-app-border bg-app-surface">
    <summary className="cursor-pointer px-3 py-2 text-xs font-semibold text-app-ink">
      {label}
    </summary>
    <pre className="max-h-72 overflow-auto border-t border-app-border p-3 text-xs whitespace-pre-wrap break-words text-app-muted">
      {JSON.stringify(value, null, 2)}
    </pre>
  </details>
);

export const AiRunCostDetails = ({
  className = "",
  cost,
}: AiRunCostDetailsProps) => {
  const [expanded, setExpanded] = useState(false);
  const requests = cost.requests ?? [];

  return (
    <section
      className={`rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <span className="font-semibold">Cost AI rulare</span>
          <span className="text-app-muted">
            {cost.localOnly
              ? " · local, fără cost API"
              : ` · $${cost.estimatedUsd.toFixed(6)}`}
            {` · ${cost.totalTokens.toLocaleString("ro-RO")} tokeni · ${cost.requestCount} requesturi`}
            {cost.unpricedRequests > 0
              ? ` · estimare incompletă (${cost.unpricedRequests} fără preț)`
              : ""}
          </span>
        </p>
        {requests.length > 0 ? (
          <Button
            size="compact"
            variant="secondary"
            aria-expanded={expanded}
            onClick={() => setExpanded((current) => !current)}
          >
            {expanded ? "Ascunde requesturile" : "Explică requesturile"}
          </Button>
        ) : null}
      </div>

      {requests.length === 0 && cost.requestCount > 0 ? (
        <p className="mt-2 text-xs text-app-muted">
          Detaliile nu sunt disponibile pentru această rulare mai veche.
        </p>
      ) : null}

      {expanded ? (
        <ol className="mt-3 grid gap-3 border-t border-app-border pt-3">
          {requests.map((request, index) => (
            <li
              key={request.id}
              className="rounded-lg border border-app-border bg-app-canvas p-3"
            >
              <p className="font-semibold text-app-ink">
                Request {index + 1} ({request.reason})
              </p>
              <p className="mt-1 text-xs text-app-muted">
                {request.provider} · {request.model} · {formatCost(request)} ·{" "}
                {request.totalTokens.toLocaleString("ro-RO")} tokeni (input{" "}
                {request.inputTokens.toLocaleString("ro-RO")}, output{" "}
                {request.outputTokens.toLocaleString("ro-RO")})
              </p>
              <div className="mt-3 grid gap-2">
                <JsonBlock label="Payload trimis" value={request.payload} />
                <JsonBlock label="Răspuns primit" value={request.response} />
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
};
