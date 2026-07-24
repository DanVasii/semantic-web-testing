import { useEffect, useState } from "react";

import type { AppInfo } from "../shared/ipc.js";
import { ProjectDashboard } from "./ProjectDashboard.js";

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
    <main className="min-h-screen bg-app-canvas text-app-ink">
      <header className="border-b border-app-border bg-app-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-8 py-5">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-600 font-bold text-white shadow-sm">
              S
            </span>
            <div>
              <h1 className="font-semibold tracking-tight">
                Semantic Web Testing
              </h1>
              <p className="text-xs text-app-muted">Aplicație desktop locală</p>
            </div>
          </div>
          <p className="text-xs text-app-muted">
            {hasAppInfoError
              ? "Versiunea nu este disponibilă"
              : appInfo === null
                ? "Se încarcă..."
                : `v${appInfo.version} · Electron ${appInfo.electronVersion}`}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-8 pb-12">
        <ProjectDashboard />
      </div>
    </main>
  );
};
