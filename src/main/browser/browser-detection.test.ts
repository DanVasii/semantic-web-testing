import { describe, expect, it } from "vitest";

import { detectBrowsers } from "./browser-detection.js";

const windowsEnvironment = {
  PROGRAMFILES: "C:\\Program Files",
  "PROGRAMFILES(X86)": "C:\\Program Files (x86)",
  LOCALAPPDATA: "C:\\Users\\Tester\\AppData\\Local",
};

describe("detectBrowsers", () => {
  it("detects system and Playwright installations independently", () => {
    const existingPaths = new Set([
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Users\\Tester\\AppData\\Local\\Programs\\Opera\\opera.exe",
      "C:\\playwright\\chromium.exe",
      "C:\\playwright\\webkit.exe",
    ]);

    const detections = detectBrowsers({
      platform: "win32",
      environment: windowsEnvironment,
      playwrightPaths: {
        chromium: "C:\\playwright\\chromium.exe",
        firefox: "C:\\playwright\\firefox.exe",
        webkit: "C:\\playwright\\webkit.exe",
      },
      pathExists: (path) => existingPaths.has(path),
    });
    const byInstallation = Object.fromEntries(
      detections.map((browser) => [browser.installationId, browser]),
    );

    expect(byInstallation["system:chrome"]).toMatchObject({
      installed: true,
      supported: true,
      executablePath:
        "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    });
    expect(byInstallation["system:opera"]).toMatchObject({
      installed: true,
      supported: true,
    });
    expect(byInstallation["system:edge"]?.installed).toBe(false);
    expect(byInstallation["playwright:chromium"]?.installed).toBe(true);
    expect(byInstallation["playwright:firefox"]?.installed).toBe(false);
    expect(byInstallation["playwright:webkit"]?.installed).toBe(true);
  });

  it("never marks desktop Safari as supported Playwright WebKit", () => {
    const detections = detectBrowsers({
      platform: "darwin",
      environment: {},
      playwrightPaths: {
        chromium: "/cache/chromium",
        firefox: "/cache/firefox",
        webkit: "/cache/webkit",
      },
      pathExists: (path) => path.includes("Safari.app"),
    });

    expect(
      detections.find(
        ({ installationId }) => installationId === "system:safari",
      ),
    ).toMatchObject({
      installed: true,
      supported: false,
      id: "safari",
    });
  });
});
