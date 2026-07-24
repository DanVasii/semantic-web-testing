import { describe, expect, it } from "vitest";

import {
  getSelectableBrowsers,
  type DetectedBrowser,
} from "./browser-manager.js";

const detectedBrowsers: DetectedBrowser[] = [
  {
    installationId: "system:chrome",
    id: "chrome",
    displayName: "Google Chrome",
    engine: "chromium",
    source: "system",
    installed: true,
    supported: true,
    executablePath:
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  },
  {
    installationId: "system:firefox",
    id: "firefox",
    displayName: "Mozilla Firefox",
    engine: "firefox",
    source: "system",
    installed: false,
    supported: true,
    unavailableReason: "Browserul nu este instalat.",
  },
  {
    installationId: "system:safari",
    id: "safari",
    displayName: "Safari",
    engine: "webkit",
    source: "system",
    installed: false,
    supported: false,
    unavailableReason: "Safari nu este disponibil pe Windows.",
  },
  {
    installationId: "system:edge",
    id: "edge",
    displayName: "Microsoft Edge",
    engine: "chromium",
    source: "system",
    installed: true,
    supported: true,
    executablePath:
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  },
];

describe("getSelectableBrowsers", () => {
  it("returns only installed and supported browsers", () => {
    expect(getSelectableBrowsers(detectedBrowsers).map(({ id }) => id)).toEqual(
      ["chrome", "edge"],
    );
  });

  it("does not mutate the detection result", () => {
    const originalOrder = detectedBrowsers.map(({ id }) => id);

    getSelectableBrowsers(detectedBrowsers);

    expect(detectedBrowsers.map(({ id }) => id)).toEqual(originalOrder);
  });
});
