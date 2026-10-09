import type { JsonValue } from "../shared/persistence.js";
import type { VisualCheckDebug } from "../shared/runner.js";

export const visualCheckDebugFrom = (
  value: JsonValue | undefined,
): VisualCheckDebug | undefined => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  const debug = value.visualCheckDebug;
  if (typeof debug !== "object" || debug === null || Array.isArray(debug)) {
    return undefined;
  }
  if (
    !Array.isArray(debug.dataUrls) ||
    !debug.dataUrls.every(
      (dataUrl) =>
        typeof dataUrl === "string" && dataUrl.startsWith("data:image/"),
    ) ||
    (debug.mimeType !== "image/jpeg" && debug.mimeType !== "image/png") ||
    typeof debug.byteLength !== "number" ||
    typeof debug.prompt !== "string"
  ) {
    return undefined;
  }
  return debug as unknown as VisualCheckDebug;
};

export const withoutVisualCheckDebug = (value: JsonValue): JsonValue => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "visualCheckDebug"),
  );
};

export const VisualCheckEvidence = ({ debug }: { debug: VisualCheckDebug }) => (
  <details className="mt-3 overflow-hidden rounded-lg border border-sky-200 bg-sky-50 p-3 text-app-ink">
    <summary className="cursor-pointer text-sm font-semibold text-sky-900">
      Vezi capturile trimise către AI ({debug.dataUrls.length})
    </summary>
    <div className="mt-3 grid gap-3">
      <p className="text-xs text-sky-900">
        {debug.mimeType} · {(debug.byteLength / 1024).toFixed(1)} KB ·{" "}
        {debug.dataUrls.length}{" "}
        {debug.dataUrls.length === 1 ? "captură" : "capturi"}
      </p>
      <div className="flex items-start justify-between gap-4">
        <p className="text-xs text-app-muted">Prompt: {debug.prompt}</p>
        <div className="flex shrink-0 flex-col gap-2">
          <button
            className="rounded border border-sky-300 bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-200"
            onClick={() => void navigator.clipboard.writeText(debug.prompt)}
            title="Copiază promptul în clipboard pentru a-l trimite manual unui AI"
          >
            Copiază promptul
          </button>
          <button
            className="rounded border border-sky-300 bg-sky-100 px-2 py-0.5 text-[10px] font-semibold text-sky-800 hover:bg-sky-200"
            onClick={() =>
              void navigator.clipboard.writeText(
                JSON.stringify(
                  {
                    model: "local-model",
                    messages: [
                      {
                        role: "user",
                        content: [
                          { type: "text", text: debug.prompt },
                          ...debug.dataUrls.map((url) => ({
                            type: "image_url",
                            image_url: { url },
                          })),
                        ],
                      },
                    ],
                    temperature: 0,
                  },
                  null,
                  2,
                ),
              )
            }
            title="Copiază request-ul cu imaginile base64 în format JSON"
          >
            Copiază payload-ul complet (JSON)
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-3">
        {debug.dataUrls.map((dataUrl, index) => (
          <figure key={index} className="flex flex-col gap-1">
            <img
              alt={`Captura ${index + 1} trimisă către AI`}
              className="max-h-[36rem] w-full rounded border border-sky-200 bg-white object-contain object-top"
              src={dataUrl}
            />
            <figcaption className="flex items-center justify-between gap-2 text-xs text-app-muted">
              <span>Captura {index + 1}</span>
              <a
                className="font-semibold text-sky-800 underline"
                download={`visual-check-debug-${index + 1}.${debug.mimeType === "image/png" ? "png" : "jpg"}`}
                href={dataUrl}
              >
                Descarcă
              </a>
            </figcaption>
          </figure>
        ))}
      </div>
    </div>
  </details>
);
