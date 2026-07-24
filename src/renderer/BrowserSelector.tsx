import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type { Project } from "../shared/persistence.js";
import {
  getSelectableBrowsers,
  type BrowserManagerStatus,
  type DetectedBrowser,
} from "../shared/browser-manager.js";
import { Button } from "./components/Button.js";
import { Select } from "./components/Select.js";

export interface BrowserSelectorProps {
  api: SemanticAppApi;
  browserStatus: BrowserManagerStatus;
  project: Project;
}

const storageKey = (projectId: string): string =>
  `semantic-app:browser:${projectId}`;

export const BrowserSelector = ({
  api,
  browserStatus,
  project,
}: BrowserSelectorProps) => {
  const [detections, setDetections] = useState<DetectedBrowser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();

  useEffect(() => {
    let isActive = true;
    setIsLoading(true);
    setError(undefined);

    void api
      .detectBrowsers()
      .then((loadedDetections) => {
        if (!isActive) {
          return;
        }

        const selectable = getSelectableBrowsers(loadedDetections);
        const savedId = localStorage.getItem(storageKey(project.id));
        const initialId =
          selectable.find(({ installationId }) => installationId === savedId)
            ?.installationId ??
          selectable[0]?.installationId ??
          "";
        setDetections(loadedDetections);
        setSelectedId(initialId);
      })
      .catch(() => {
        if (isActive) {
          setError("Browserele instalate nu au putut fi detectate.");
        }
      })
      .finally(() => {
        if (isActive) {
          setIsLoading(false);
        }
      });

    return () => {
      isActive = false;
    };
  }, [api, project.id]);

  const selectableBrowsers = useMemo(
    () => getSelectableBrowsers(detections),
    [detections],
  );
  const selectedBrowser = selectableBrowsers.find(
    ({ installationId }) => installationId === selectedId,
  );
  const hasActiveBrowser = ["starting", "running", "reconnecting"].includes(
    browserStatus.state,
  );
  const isCurrentProject =
    hasActiveBrowser && browserStatus.projectId === project.id;
  const isBusy = isLaunching || isOpening || isClosing;

  const launch = async (): Promise<void> => {
    if (!selectedBrowser) {
      return;
    }

    setIsLaunching(true);
    setError(undefined);
    setSuccessMessage(undefined);
    let wasLaunched = false;

    try {
      await api.launchBrowser({
        projectId: project.id,
        browser: selectedBrowser.id,
        source: selectedBrowser.source,
        sessionMode: project.browserConfig.sessionMode,
        ...(selectedBrowser.executablePath === undefined
          ? {}
          : { executablePath: selectedBrowser.executablePath }),
        ...(project.browserConfig.profilePath === undefined
          ? {}
          : { profilePath: project.browserConfig.profilePath }),
        ...(project.browserConfig.remoteDebuggingPort === undefined
          ? {}
          : {
              remoteDebuggingPort: project.browserConfig.remoteDebuggingPort,
            }),
        ...(project.browserConfig.viewport === undefined
          ? {}
          : { viewport: project.browserConfig.viewport }),
      });
      wasLaunched = true;
      localStorage.setItem(
        storageKey(project.id),
        selectedBrowser.installationId,
      );
      await api.openProjectUrl(project.id, project.normalizedBaseUrl);
      setSuccessMessage(
        `${selectedBrowser.displayName} a fost pornit și URL-ul proiectului a fost deschis.`,
      );
    } catch {
      setError(
        wasLaunched
          ? "Browserul a pornit, dar URL-ul proiectului nu a putut fi deschis."
          : `${selectedBrowser.displayName} nu a putut fi pornit. Verifică instalarea browserului.`,
      );
    } finally {
      setIsLaunching(false);
    }
  };

  const openProjectUrl = async (): Promise<void> => {
    setIsOpening(true);
    setError(undefined);
    setSuccessMessage(undefined);

    try {
      await api.openProjectUrl(project.id, project.normalizedBaseUrl);
      setSuccessMessage("URL-ul proiectului a fost deschis într-un tab nou.");
    } catch {
      setError("URL-ul proiectului nu a putut fi deschis.");
    } finally {
      setIsOpening(false);
    }
  };

  const closeBrowser = async (): Promise<void> => {
    setIsClosing(true);
    setError(undefined);
    setSuccessMessage(undefined);

    try {
      await api.closeBrowser();
      setSuccessMessage("Browserul a fost închis.");
    } catch {
      setError("Browserul nu a putut fi închis.");
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Select
            label="Browser disponibil"
            value={selectedId}
            disabled={
              isLoading || hasActiveBrowser || selectableBrowsers.length === 0
            }
            options={
              isLoading
                ? [{ value: "", label: "Se detectează browserele..." }]
                : selectableBrowsers.length === 0
                  ? [{ value: "", label: "Niciun browser compatibil" }]
                  : selectableBrowsers.map((browser) => ({
                      value: browser.installationId,
                      label: browser.displayName,
                    }))
            }
            onChange={(event) => {
              setSelectedId(event.target.value);
              setError(undefined);
              setSuccessMessage(undefined);
            }}
          />
        </div>
        {isCurrentProject && browserStatus.state === "running" ? (
          <Button
            disabled={isBusy}
            onClick={() => {
              void openProjectUrl();
            }}
          >
            {isOpening ? "Se deschide..." : "Deschide URL-ul"}
          </Button>
        ) : null}
        {hasActiveBrowser && browserStatus.state !== "starting" ? (
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              void closeBrowser();
            }}
          >
            {isClosing ? "Se închide..." : "Închide browserul"}
          </Button>
        ) : null}
        {!hasActiveBrowser ? (
          <Button
            disabled={!selectedBrowser || isBusy}
            onClick={() => {
              void launch();
            }}
          >
            {isLaunching ? "Se pornește..." : "Pornește și deschide"}
          </Button>
        ) : null}
      </div>

      {selectedBrowser ? (
        <p className="mt-2 text-xs text-app-muted">
          {selectedBrowser.source === "system"
            ? "Instalare detectată în sistem"
            : "Motor gestionat de Playwright"}
          {selectedBrowser.executablePath
            ? ` · ${selectedBrowser.executablePath}`
            : ""}
        </p>
      ) : null}
      {hasActiveBrowser && !isCurrentProject ? (
        <p role="status" className="mt-3 text-sm text-amber-700">
          Există deja un browser activ pentru alt proiect. Închide-l pentru a
          porni selecția curentă.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {successMessage ? (
        <p role="status" className="mt-3 text-sm text-emerald-700">
          {successMessage}
        </p>
      ) : null}
      {!error &&
      !successMessage &&
      browserStatus.message &&
      browserStatus.projectId === project.id ? (
        <p role="status" className="mt-3 text-sm text-app-muted">
          {browserStatus.message}
        </p>
      ) : null}
    </section>
  );
};
