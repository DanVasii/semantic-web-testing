import { useEffect, useState } from "react";

import type { AppInfo } from "../shared/ipc.js";
import type { SemanticAppApi } from "../shared/ipc.js";
import { AiSettingsModal } from "./AiSettingsModal.js";
import { Button } from "./components/Button.js";
import { ProjectDashboard } from "./ProjectDashboard.js";

export interface AppProps {
  api?: SemanticAppApi;
}

export const App = ({ api = window.semanticApp }: AppProps) => {
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const [hasAppInfoError, setHasAppInfoError] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  useEffect(() => {
    let isActive = true;

    void api
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
  }, [api]);

  return (
    <main className="min-h-screen bg-app-canvas text-app-ink">
      <header className="border-b border-app-border bg-app-surface">
        <div className="mx-auto flex max-w-[1480px] items-center justify-between gap-6 px-5 py-4 sm:px-6">
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
          <div className="flex items-center gap-3">
            <p className="text-xs text-app-muted">
              {hasAppInfoError
                ? "Versiunea nu este disponibilă"
                : appInfo === null
                  ? "Se încarcă..."
                  : `v${appInfo.version} · Electron ${appInfo.electronVersion}`}
            </p>
            <Button
              variant="secondary"
              className="min-h-8 px-3 py-1"
              onClick={() => setSettingsOpen(true)}
            >
              Setări aplicație
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1480px] px-5 pb-10 sm:px-6">
        <ProjectDashboard api={api} />
      </div>
      <AiSettingsModal
        api={api}
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
      />
    </main>
  );
};
