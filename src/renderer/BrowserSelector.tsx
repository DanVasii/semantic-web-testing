import { useEffect, useMemo, useState } from "react";

import type { SemanticAppApi } from "../shared/ipc.js";
import type {
  BrowserConfig,
  BrowserSessionMode,
  Project,
} from "../shared/persistence.js";
import type { ProjectOverview } from "../shared/projects.js";
import {
  getSelectableBrowsers,
  type BrowserManagerStatus,
  type DetectedBrowser,
} from "../shared/browser-manager.js";
import { Button } from "./components/Button.js";
import { Input } from "./components/Input.js";
import { Select } from "./components/Select.js";
import { ProjectBasicAuthSettingsPanel } from "./ProjectBasicAuthSettings.js";

export interface BrowserSelectorProps {
  api: SemanticAppApi;
  browserStatus: BrowserManagerStatus;
  onProjectUpdated: (overview: ProjectOverview) => void;
  project: Project;
}

const storageKey = (projectId: string): string =>
  `semantic-app:browser:${projectId}`;

const sessionModeOptions: Array<{
  value: BrowserSessionMode;
  label: string;
}> = [
  { value: "temporary", label: "Temporară" },
  { value: "reusable", label: "Reutilizabilă" },
  { value: "persistent_profile", label: "Profil persistent" },
  { value: "external_chrome_debug", label: "Chrome prin CDP" },
];

const requiresProfile = (mode: BrowserSessionMode): boolean =>
  mode === "persistent_profile" || mode === "external_chrome_debug";

export const BrowserSelector = ({
  api,
  browserStatus,
  onProjectUpdated,
  project,
}: BrowserSelectorProps) => {
  const [detections, setDetections] = useState<DetectedBrowser[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [browserConfig, setBrowserConfig] = useState(project.browserConfig);
  const [remoteDebuggingPort, setRemoteDebuggingPort] = useState(
    String(project.browserConfig.remoteDebuggingPort ?? 9222),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [isLaunching, setIsLaunching] = useState(false);
  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isClosingTabs, setIsClosingTabs] = useState(false);
  const [isRecovering, setIsRecovering] = useState(false);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [error, setError] = useState<string>();
  const [successMessage, setSuccessMessage] = useState<string>();

  useEffect(() => {
    setBrowserConfig(project.browserConfig);
    setRemoteDebuggingPort(
      String(project.browserConfig.remoteDebuggingPort ?? 9222),
    );
  }, [project.browserConfig]);

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
  const hasActiveBrowser = [
    "starting",
    "running",
    "reconnecting",
    "waiting_for_basic_auth",
  ].includes(browserStatus.state);
  const isCurrentProject =
    hasActiveBrowser && browserStatus.projectId === project.id;
  const isBusy =
    isLaunching ||
    isOpening ||
    isClosing ||
    isClosingTabs ||
    isRecovering ||
    isSavingConfig;
  const parsedRemoteDebuggingPort = Number(remoteDebuggingPort);
  const isRemoteDebuggingPortValid =
    Number.isInteger(parsedRemoteDebuggingPort) &&
    parsedRemoteDebuggingPort >= 1024 &&
    parsedRemoteDebuggingPort <= 65_535;
  const hasRequiredProfile =
    !requiresProfile(browserConfig.sessionMode) ||
    Boolean(browserConfig.profilePath);
  const supportsSelectedMode =
    browserConfig.sessionMode !== "external_chrome_debug" ||
    selectedBrowser?.id === "chrome";

  const saveBrowserConfig = async (
    nextConfig: BrowserConfig,
  ): Promise<void> => {
    const previousConfig = browserConfig;
    setBrowserConfig(nextConfig);
    setIsSavingConfig(true);
    setError(undefined);
    setSuccessMessage(undefined);

    try {
      const updated = await api.updateBrowserConfig(project.id, nextConfig);
      onProjectUpdated(updated);
    } catch {
      setBrowserConfig(previousConfig);
      setError("Configurația browserului nu a putut fi salvată.");
    } finally {
      setIsSavingConfig(false);
    }
  };

  const launch = async (): Promise<void> => {
    if (!selectedBrowser) {
      return;
    }

    if (!hasRequiredProfile) {
      setError("Selectează mai întâi directorul profilului.");
      return;
    }

    if (!supportsSelectedMode) {
      setError("Modul Chrome prin CDP necesită Google Chrome.");
      return;
    }

    if (
      browserConfig.sessionMode === "external_chrome_debug" &&
      !isRemoteDebuggingPortValid
    ) {
      setError("Portul remote debugging trebuie să fie între 1024 și 65535.");
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
        sessionMode: browserConfig.sessionMode,
        ...(selectedBrowser.executablePath === undefined
          ? {}
          : { executablePath: selectedBrowser.executablePath }),
        ...(browserConfig.profilePath === undefined
          ? {}
          : { profilePath: browserConfig.profilePath }),
        ...(browserConfig.sessionMode !== "external_chrome_debug"
          ? {}
          : { remoteDebuggingPort: parsedRemoteDebuggingPort }),
        ...(browserConfig.viewport === undefined
          ? {}
          : { viewport: browserConfig.viewport }),
      });
      wasLaunched = true;
      localStorage.setItem(
        storageKey(project.id),
        selectedBrowser.installationId,
      );
      const navigation = await api.openProjectUrl(
        project.id,
        project.normalizedBaseUrl,
      );
      if (navigation.state === "opened") {
        setSuccessMessage(
          `${selectedBrowser.displayName} a fost pornit și URL-ul proiectului a fost deschis.`,
        );
      }
    } catch (caughtError) {
      const message =
        caughtError instanceof Error ? caughtError.message : undefined;
      setError(
        message?.includes("Profilul Chrome este deja folosit")
          ? "Profilul Chrome este deja folosit. Închide cealaltă instanță sau alege alt director."
          : wasLaunched
            ? "Browserul a pornit, dar URL-ul proiectului nu a putut fi deschis."
            : `${selectedBrowser.displayName} nu a putut fi pornit. Verifică instalarea și configurația browserului.`,
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
      const navigation = await api.openProjectUrl(
        project.id,
        project.normalizedBaseUrl,
      );
      if (navigation.state === "opened") {
        setSuccessMessage("URL-ul proiectului a fost deschis într-un tab nou.");
      }
    } catch {
      setError("URL-ul proiectului nu a putut fi deschis.");
    } finally {
      setIsOpening(false);
    }
  };

  const closeProjectTabs = async (): Promise<void> => {
    setIsClosingTabs(true);
    setError(undefined);
    setSuccessMessage(undefined);

    try {
      await api.closeProjectTabs(project.id);
      setSuccessMessage("Taburile proiectului au fost închise.");
    } catch {
      setError("Taburile proiectului nu au putut fi închise.");
    } finally {
      setIsClosingTabs(false);
    }
  };

  const recoverConnection = async (): Promise<void> => {
    setIsRecovering(true);
    setError(undefined);
    setSuccessMessage(undefined);

    try {
      await api.recoverBrowserConnection();
      const navigation = await api.openProjectUrl(
        project.id,
        project.normalizedBaseUrl,
      );
      if (navigation.state === "opened") {
        setSuccessMessage(
          "Conexiunea a fost recuperată și URL-ul proiectului a fost redeschis.",
        );
      }
    } catch {
      setError("Conexiunea cu browserul nu a putut fi recuperată.");
    } finally {
      setIsRecovering(false);
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

  const selectProfilePath = async (): Promise<void> => {
    setError(undefined);
    const profilePath = await api.selectBrowserProfilePath();

    if (profilePath !== undefined) {
      await saveBrowserConfig({ ...browserConfig, profilePath });
    }
  };

  return (
    <section className="mt-6 rounded-xl border border-app-border bg-app-canvas p-4">
      <div className="grid gap-4 lg:grid-cols-2">
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
        <Select
          label="Mod sesiune"
          value={browserConfig.sessionMode}
          disabled={hasActiveBrowser || isBusy}
          options={sessionModeOptions}
          onChange={(event) => {
            const sessionMode = event.target.value as BrowserSessionMode;
            const nextConfig: BrowserConfig = {
              ...browserConfig,
              sessionMode,
              ...(sessionMode === "external_chrome_debug" &&
              browserConfig.remoteDebuggingPort === undefined
                ? { remoteDebuggingPort: 9222 }
                : {}),
            };
            void saveBrowserConfig(nextConfig);
          }}
        />
      </div>

      {requiresProfile(browserConfig.sessionMode) ? (
        <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <Button
              variant="secondary"
              disabled={hasActiveBrowser || isBusy}
              onClick={() => {
                void selectProfilePath();
              }}
            >
              Alege directorul profilului
            </Button>
            <span className="min-w-0 break-all text-sm text-app-ink">
              {browserConfig.profilePath ?? "Niciun director selectat"}
            </span>
          </div>
          <p className="mt-2 text-xs text-amber-800">
            Folosește un director separat pentru automatizare. Chrome 136+ nu
            permite remote debugging pe profilul implicit folosit zilnic.
          </p>
        </div>
      ) : null}

      {browserConfig.sessionMode === "external_chrome_debug" ? (
        <div className="mt-4 max-w-xs">
          <Input
            label="Port remote debugging"
            type="number"
            min={1024}
            max={65_535}
            value={remoteDebuggingPort}
            {...(remoteDebuggingPort.length > 0 && !isRemoteDebuggingPortValid
              ? { error: "Introdu un port între 1024 și 65535." }
              : {})}
            disabled={hasActiveBrowser || isBusy}
            onChange={(event) => {
              setRemoteDebuggingPort(event.target.value);
            }}
            onBlur={() => {
              if (isRemoteDebuggingPortValid) {
                void saveBrowserConfig({
                  ...browserConfig,
                  remoteDebuggingPort: parsedRemoteDebuggingPort,
                });
              }
            }}
          />
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {isCurrentProject && browserStatus.state === "running" ? (
          <>
            <Button
              disabled={isBusy}
              onClick={() => {
                void openProjectUrl();
              }}
            >
              {isOpening ? "Se deschide..." : "Deschide URL-ul"}
            </Button>
            <Button
              variant="secondary"
              disabled={isBusy}
              onClick={() => {
                void closeProjectTabs();
              }}
            >
              {isClosingTabs ? "Se închid..." : "Închide taburile"}
            </Button>
          </>
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
            disabled={
              !selectedBrowser ||
              isBusy ||
              !hasRequiredProfile ||
              !supportsSelectedMode ||
              (browserConfig.sessionMode === "external_chrome_debug" &&
                !isRemoteDebuggingPortValid)
            }
            onClick={() => {
              void launch();
            }}
          >
            {isLaunching ? "Se pornește..." : "Pornește și deschide"}
          </Button>
        ) : null}
        {!hasActiveBrowser && browserStatus.canReconnect ? (
          <Button
            variant="secondary"
            disabled={isBusy}
            onClick={() => {
              void recoverConnection();
            }}
          >
            {isRecovering ? "Se reconectează..." : "Recuperează conexiunea"}
          </Button>
        ) : null}
      </div>

      {selectedBrowser ? (
        <p className="mt-3 text-xs text-app-muted">
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
      <ProjectBasicAuthSettingsPanel api={api} project={project} />
    </section>
  );
};
