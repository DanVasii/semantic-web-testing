import type { BrowserSessionMode } from "./persistence.js";

export type BrowserEngine = "chromium" | "firefox" | "webkit";

export type BrowserProduct =
  "chromium" | "firefox" | "webkit" | "chrome" | "edge" | "opera" | "safari";

export type BrowserInstallationSource = "playwright" | "system";

export interface DetectedBrowser {
  installationId: string;
  id: BrowserProduct;
  displayName: string;
  engine: BrowserEngine;
  source: BrowserInstallationSource;
  installed: boolean;
  supported: boolean;
  executablePath?: string;
  unavailableReason?: string;
}

export interface BrowserLaunchOptions {
  projectId: string;
  browser: BrowserProduct;
  source: BrowserInstallationSource;
  sessionMode: BrowserSessionMode;
  executablePath?: string;
  profilePath?: string;
  remoteDebuggingPort?: number;
  viewport?: {
    width: number;
    height: number;
  };
}

export type BrowserManagerState =
  | "idle"
  | "starting"
  | "running"
  | "reconnecting"
  | "waiting_for_basic_auth"
  | "closed"
  | "failed";

export interface BasicAuthCredentials {
  username: string;
  password: string;
}

export interface BasicAuthChallenge {
  projectId: string;
  url: string;
  origin: string;
  invalidCredentials: boolean;
}

export interface BrowserManagerStatus {
  state: BrowserManagerState;
  browser?: BrowserProduct;
  projectId?: string;
  sessionId?: string;
  message?: string;
  canReconnect?: boolean;
  basicAuthChallenge?: BasicAuthChallenge;
}

export interface BrowserSession {
  id: string;
  projectId: string;
  browser: BrowserProduct;
  engine: BrowserEngine;
  sessionMode: BrowserSessionMode;
  startedAt: string;
}

export interface BrowserTab {
  id: string;
  projectId: string;
  url: string;
}

export type BrowserNavigationResult =
  | {
      state: "opened";
      tab: BrowserTab;
    }
  | {
      state: "waiting_for_basic_auth";
      challenge: BasicAuthChallenge;
    };

export type BrowserStatusListener = (status: BrowserManagerStatus) => void;

export interface BrowserManager {
  detectAvailableBrowsers: () => Promise<DetectedBrowser[]>;
  getStatus: () => BrowserManagerStatus;
  launch: (options: BrowserLaunchOptions) => Promise<BrowserSession>;
  openProjectUrl: (
    projectId: string,
    url: string,
  ) => Promise<BrowserNavigationResult>;
  submitBasicAuth: (
    credentials: BasicAuthCredentials,
  ) => Promise<BrowserNavigationResult>;
  cancelBasicAuth: () => Promise<void>;
  clearBasicAuthCredentials: () => void;
  closeProjectTabs: (projectId: string) => Promise<void>;
  recoverConnection: () => Promise<BrowserSession>;
  close: () => Promise<void>;
  onStatusChange: (listener: BrowserStatusListener) => () => void;
}

export const getSelectableBrowsers = (
  detections: readonly DetectedBrowser[],
): DetectedBrowser[] =>
  detections
    .filter(({ installed, supported }) => installed && supported)
    .sort((left, right) => left.displayName.localeCompare(right.displayName));
