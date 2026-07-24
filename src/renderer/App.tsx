import { useEffect, useState } from "react";

import type { AppInfo } from "../shared/ipc.js";
import { DesignSystemShowcase } from "./DesignSystemShowcase.js";

export const App = () => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [hasAppInfoError, setHasAppInfoError] = useState(false);

  useEffect(() => {
    let isActive = true;

    void window.semanticApp
      .getAppInfo()
      .then((loadedAppInfo) => {
        if (isActive) {
          setAppInfo(loadedAppInfo);
        }
      })
      .catch(() => {
        if (isActive) {
          setHasAppInfoError(true);
        }
      });

    return () => {
      isActive = false;
    };
  }, []);

  return (
    <main className="min-h-screen bg-app-canvas px-8 py-10 text-app-ink">
      <div className="mx-auto max-w-5xl">
        <span className="inline-flex rounded-full bg-brand-100 px-3 py-1 text-xs font-semibold tracking-[0.14em] text-brand-700 uppercase">
          Fundație aplicație
        </span>

        <h1 className="mt-5 text-4xl font-semibold tracking-tight">
          Semantic Web Testing App
        </h1>
        <p className="mt-3 max-w-2xl text-base leading-7 text-app-muted">
          Renderer-ul React folosește acum Tailwind pentru interfața de testare
          semantică. Hot reload verificat.
        </p>

        <section
          aria-label="Stare fundație"
          className="mt-8 flex items-center gap-3 rounded-xl border border-app-border bg-app-surface p-5 shadow-sm"
        >
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-full bg-brand-500"
          />
          <div>
            <p className="font-medium">Interfață activă</p>
            <p className="mt-1 text-sm text-app-muted">
              Light mode cu accent portocaliu.
            </p>
            <p className="mt-1 text-sm text-app-muted">
              {hasAppInfoError
                ? "Informațiile aplicației nu sunt disponibile."
                : appInfo === null
                  ? "Se încarcă informațiile aplicației."
                  : `Versiune aplicație ${appInfo.version} · Electron ${appInfo.electronVersion}`}
            </p>
          </div>
        </section>

        <DesignSystemShowcase />
      </div>
    </main>
  );
};
