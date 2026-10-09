import { useEffect, useRef, useState } from "react";

import type { AiModelPricing, AiProviderId } from "../../shared/ai.js";
import type { SemanticAppApi } from "../../shared/ipc.js";
import { Button } from "./Button.js";
import { Input } from "./Input.js";

export interface AiModelPricingPanelProps {
  api: SemanticAppApi;
  model: string;
  provider: AiProviderId;
  className?: string;
}

const formatUsd = (value: number | undefined): string =>
  value === undefined
    ? "—"
    : new Intl.NumberFormat("ro-RO", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 6,
      }).format(value);

export const AiModelPricingPanel = ({
  api,
  className = "",
  model,
  provider,
}: AiModelPricingPanelProps) => {
  const [pricing, setPricing] = useState<AiModelPricing>();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [manualInputPrice, setManualInputPrice] = useState("");
  const [manualOutputPrice, setManualOutputPrice] = useState("");
  const [message, setMessage] = useState<string>();
  const requestId = useRef(0);
  const normalizedModel = model.trim();
  const pricedProvider = provider === "gemini" || provider === "openai";

  useEffect(() => {
    const currentRequest = ++requestId.current;
    setPricing(undefined);
    setMessage(undefined);
    setManualInputPrice("");
    setManualOutputPrice("");

    if (!pricedProvider || normalizedModel.length === 0) {
      setLoading(false);
      return;
    }

    if (typeof api.getAiModelPricing !== "function") {
      setLoading(false);
      setPricing({
        provider,
        model: normalizedModel,
        status: "unavailable",
        message: "Prețurile nu au putut fi încărcate.",
      });
      return;
    }

    setLoading(true);
    void Promise.resolve(api.getAiModelPricing(provider, normalizedModel))
      .then((loaded) => {
        if (requestId.current !== currentRequest) return;
        if (loaded === undefined) {
          setPricing({
            provider,
            model: normalizedModel,
            status: "unavailable",
            message: "Prețurile nu au putut fi încărcate.",
          });
          return;
        }
        setPricing(loaded);
        if (loaded.status === "unavailable") {
          setManualInputPrice(
            loaded.staleManualInputPerMillionUsd?.toString() ?? "",
          );
          setManualOutputPrice(
            loaded.staleManualOutputPerMillionUsd?.toString() ?? "",
          );
        }
      })
      .catch(() => {
        if (requestId.current !== currentRequest) return;
        setPricing({
          provider,
          model: normalizedModel,
          status: "unavailable",
          message: "Prețurile nu au putut fi încărcate.",
        });
      })
      .finally(() => {
        if (requestId.current === currentRequest) setLoading(false);
      });
  }, [api, normalizedModel, pricedProvider, provider]);

  if (provider === "none" || normalizedModel.length === 0) return null;

  if (!pricedProvider) {
    return (
      <p
        className={`rounded-lg border border-app-border bg-white p-3 text-sm text-app-muted ${className}`.trim()}
      >
        Model local · fără cost API calculat.
      </p>
    );
  }

  const saveManualPricing = async (): Promise<void> => {
    setSaving(true);
    setMessage(undefined);
    try {
      const saved = await api.saveAiModelPricing({
        provider,
        model: normalizedModel,
        ...(manualInputPrice.trim().length === 0
          ? {}
          : { inputPerMillionUsd: Number(manualInputPrice) }),
        ...(manualOutputPrice.trim().length === 0
          ? {}
          : { outputPerMillionUsd: Number(manualOutputPrice) }),
      });
      setPricing(saved);
      setMessage("Prețurile manuale au fost salvate pentru 7 zile.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Prețurile manuale nu au putut fi salvate.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`rounded-lg border border-app-border bg-white p-3 ${className}`.trim()}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-app-ink">
            Preț model · per 1 milion de tokeni
          </p>
          <p className="mt-0.5 text-xs text-app-muted">
            Catalog LiteLLM, păstrat local 7 zile. Prețurile manuale sunt
            opționale.
          </p>
        </div>
        {pricing?.source ? (
          <span className="rounded-full bg-slate-100 px-2 py-1 text-xs text-app-muted">
            {pricing.source === "litellm" ? "LiteLLM" : "Manual"}
          </span>
        ) : null}
      </div>

      {loading ? (
        <p className="mt-3 text-sm text-app-muted">
          Se caută prețurile modelului…
        </p>
      ) : pricing?.status === "available" ? (
        <div className="mt-3">
          <dl className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md bg-app-canvas p-2">
              <dt className="text-xs text-app-muted">Input</dt>
              <dd className="font-semibold">
                {formatUsd(pricing.inputPerMillionUsd)}
              </dd>
            </div>
            <div className="rounded-md bg-app-canvas p-2">
              <dt className="text-xs text-app-muted">Output</dt>
              <dd className="font-semibold">
                {formatUsd(pricing.outputPerMillionUsd)}
              </dd>
            </div>
            <div className="rounded-md bg-app-canvas p-2">
              <dt className="text-xs text-app-muted">Input din cache</dt>
              <dd className="font-semibold">
                {formatUsd(pricing.cachedInputPerMillionUsd)}
              </dd>
            </div>
          </dl>
          {pricing.expiresAt ? (
            <p className="mt-2 text-xs text-app-muted">
              Se actualizează din nou după{" "}
              {new Date(pricing.expiresAt).toLocaleString("ro-RO")}.
            </p>
          ) : null}
        </div>
      ) : pricing?.status === "unavailable" ? (
        <div className="mt-3 grid gap-3">
          <p className="text-sm text-amber-800">{pricing.message}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Input
              label="Preț input / 1M USD (opțional)"
              type="number"
              min="0"
              step="any"
              value={manualInputPrice}
              onChange={(event) => setManualInputPrice(event.target.value)}
            />
            <Input
              label="Preț output / 1M USD (opțional)"
              type="number"
              min="0"
              step="any"
              value={manualOutputPrice}
              onChange={(event) => setManualOutputPrice(event.target.value)}
            />
          </div>
          <div>
            <Button
              variant="secondary"
              disabled={
                saving ||
                (manualInputPrice.trim().length === 0 &&
                  manualOutputPrice.trim().length === 0)
              }
              onClick={() => void saveManualPricing()}
            >
              {saving ? "Se salvează…" : "Salvează prețurile manuale"}
            </Button>
          </div>
        </div>
      ) : null}

      {message ? (
        <p className="mt-2 text-sm text-app-muted" role="status">
          {message}
        </p>
      ) : null}
    </div>
  );
};
