import { existsSync } from "node:fs";
import { join } from "node:path";

import type {
  BrowserEngine,
  BrowserProduct,
  DetectedBrowser,
} from "../../shared/browser-manager.js";

export interface PlaywrightExecutablePaths {
  chromium: string;
  firefox: string;
  webkit: string;
}

export interface BrowserDetectionOptions {
  platform?: NodeJS.Platform;
  environment?: NodeJS.ProcessEnv;
  playwrightPaths: PlaywrightExecutablePaths;
  pathExists?: (path: string) => boolean;
}

interface BrowserCandidate {
  installationId: string;
  id: BrowserProduct;
  displayName: string;
  engine: BrowserEngine;
  source: DetectedBrowser["source"];
  paths: string[];
  supported: boolean;
  unavailableReason?: string;
}

const compactPaths = (
  roots: Array<string | undefined>,
  ...segments: string[]
): string[] =>
  roots
    .filter((root): root is string => Boolean(root))
    .map((root) => join(root, ...segments));

const createSystemCandidates = (
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
): BrowserCandidate[] => {
  if (platform === "win32") {
    const programRoots = [
      environment["PROGRAMFILES"],
      environment["PROGRAMFILES(X86)"],
    ];
    const localAppData = environment["LOCALAPPDATA"];

    return [
      {
        installationId: "system:chrome",
        id: "chrome",
        displayName: "Google Chrome",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: [
          ...compactPaths(
            programRoots,
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
          ...compactPaths(
            [localAppData],
            "Google",
            "Chrome",
            "Application",
            "chrome.exe",
          ),
        ],
      },
      {
        installationId: "system:edge",
        id: "edge",
        displayName: "Microsoft Edge",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: [
          ...compactPaths(
            programRoots,
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          ),
          ...compactPaths(
            [localAppData],
            "Microsoft",
            "Edge",
            "Application",
            "msedge.exe",
          ),
        ],
      },
      {
        installationId: "system:opera",
        id: "opera",
        displayName: "Opera",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: [
          ...compactPaths([localAppData], "Programs", "Opera", "opera.exe"),
          ...compactPaths(programRoots, "Opera", "launcher.exe"),
        ],
      },
      {
        installationId: "system:firefox",
        id: "firefox",
        displayName: "Mozilla Firefox",
        engine: "firefox",
        source: "system",
        supported: false,
        unavailableReason:
          "Firefox desktop nu include protocolul Playwright necesar.",
        paths: compactPaths(programRoots, "Mozilla Firefox", "firefox.exe"),
      },
      {
        installationId: "system:safari",
        id: "safari",
        displayName: "Safari",
        engine: "webkit",
        source: "system",
        supported: false,
        unavailableReason: "Safari nu este disponibil pe Windows.",
        paths: [],
      },
    ];
  }

  if (platform === "darwin") {
    return [
      {
        installationId: "system:chrome",
        id: "chrome",
        displayName: "Google Chrome",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"],
      },
      {
        installationId: "system:edge",
        id: "edge",
        displayName: "Microsoft Edge",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: [
          "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        ],
      },
      {
        installationId: "system:opera",
        id: "opera",
        displayName: "Opera",
        engine: "chromium",
        source: "system",
        supported: true,
        paths: ["/Applications/Opera.app/Contents/MacOS/Opera"],
      },
      {
        installationId: "system:safari",
        id: "safari",
        displayName: "Safari",
        engine: "webkit",
        source: "system",
        supported: false,
        unavailableReason:
          "Safari desktop nu expune protocolul Playwright necesar.",
        paths: ["/Applications/Safari.app/Contents/MacOS/Safari"],
      },
    ];
  }

  return [
    {
      installationId: "system:chrome",
      id: "chrome",
      displayName: "Google Chrome",
      engine: "chromium",
      source: "system",
      supported: true,
      paths: ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable"],
    },
    {
      installationId: "system:edge",
      id: "edge",
      displayName: "Microsoft Edge",
      engine: "chromium",
      source: "system",
      supported: true,
      paths: ["/usr/bin/microsoft-edge", "/usr/bin/microsoft-edge-stable"],
    },
    {
      installationId: "system:opera",
      id: "opera",
      displayName: "Opera",
      engine: "chromium",
      source: "system",
      supported: true,
      paths: ["/usr/bin/opera"],
    },
  ];
};

const createPlaywrightCandidates = (
  paths: PlaywrightExecutablePaths,
): BrowserCandidate[] => [
  {
    installationId: "playwright:chromium",
    id: "chromium",
    displayName: "Chromium (Playwright)",
    engine: "chromium",
    source: "playwright",
    supported: true,
    paths: [paths.chromium],
  },
  {
    installationId: "playwright:firefox",
    id: "firefox",
    displayName: "Firefox (Playwright)",
    engine: "firefox",
    source: "playwright",
    supported: true,
    paths: [paths.firefox],
  },
  {
    installationId: "playwright:webkit",
    id: "webkit",
    displayName: "WebKit (Playwright)",
    engine: "webkit",
    source: "playwright",
    supported: true,
    paths: [paths.webkit],
  },
];

export const detectBrowsers = ({
  environment = process.env,
  pathExists = existsSync,
  platform = process.platform,
  playwrightPaths,
}: BrowserDetectionOptions): DetectedBrowser[] =>
  [
    ...createSystemCandidates(platform, environment),
    ...createPlaywrightCandidates(playwrightPaths),
  ].map((candidate) => {
    const executablePath = candidate.paths.find(pathExists);

    return {
      installationId: candidate.installationId,
      id: candidate.id,
      displayName: candidate.displayName,
      engine: candidate.engine,
      source: candidate.source,
      installed: executablePath !== undefined,
      supported: candidate.supported,
      ...(executablePath === undefined ? {} : { executablePath }),
      ...(candidate.unavailableReason === undefined
        ? {}
        : { unavailableReason: candidate.unavailableReason }),
    };
  });
