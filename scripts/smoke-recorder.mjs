import assert from "node:assert/strict";

import { chromium } from "playwright-core";

import {
  installRecorderCapture,
  setRecorderPageBlocked,
  stopRecorderCapture,
} from "../dist/main/recorder/recorder-browser-capture.js";

const fixtureUrl =
  process.env["SEMANTIC_FIXTURE_URL"] ?? "http://127.0.0.1:4173/";
const executablePath =
  process.env["SEMANTIC_CHROME_PATH"] ??
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";

const browser = await chromium.launch({
  executablePath,
  headless: true,
});

try {
  const page = await browser.newPage({
    viewport: { width: 1280, height: 4000 },
  });
  await page.goto(fixtureUrl);
  const events = [];
  const bindingName = "__semanticRecorderSmoke";
  await installRecorderCapture(page, bindingName, (event) => {
    events.push(event);
    queueMicrotask(() => {
      void setRecorderPageBlocked(page, bindingName, false);
    });
  });
  await page.locator("form").evaluate((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
    });
  });
  const waitUntilReady = async () => {
    await page
      .locator('[data-semantic-recorder-internal="blocker"]')
      .waitFor({ state: "detached" });
  };

  const email = page.locator("#customer-email");
  await email.fill("draft@example.test");
  await page.waitForTimeout(50);
  assert.equal(events.length, 0, "fill must not emit for every input event");
  await email.fill("final@example.test");
  await email.press("Tab");
  await waitUntilReady();

  await page.locator('select[name="service"]').selectOption("");
  await waitUntilReady();
  await page.locator('input[name="newsletter"]').uncheck();
  await waitUntilReady();
  await page.locator('input[value="premium"]').click();
  await waitUntilReady();
  await page.locator(".product-card").nth(1).getByRole("button").click();
  await waitUntilReady();
  await page
    .locator(".product-card")
    .nth(1)
    .getByRole("button")
    .press("Escape");
  await waitUntilReady();
  await page.locator('[data-testid="calendar-year"]').selectOption("2027");
  await waitUntilReady();
  await page.locator('[data-testid="calendar-next-month"]').click();
  await waitUntilReady();
  await page.locator('[data-testid="calendar-day-2027-08-15"]').click();
  await waitUntilReady();

  await page.evaluate(() => {
    document.body.style.minHeight = "8000px";
  });
  await page.mouse.wheel(0, 600);
  await page.waitForTimeout(650);

  const beforeInternalClick = events.length;
  await setRecorderPageBlocked(page, bindingName, true);
  await page
    .locator('[data-semantic-recorder-internal="blocker"]')
    .click({ force: true, position: { x: 2, y: 2 } });
  await page.waitForTimeout(50);
  assert.equal(
    events.length,
    beforeInternalClick,
    "internal recorder controls must be ignored",
  );
  await setRecorderPageBlocked(page, bindingName, false);

  const types = events.map((event) => event.type);
  assert.deepEqual(types, [
    "fill",
    "select",
    "checkbox",
    "radio",
    "click",
    "press_key",
    "select",
    "click",
    "click",
    "scroll",
  ]);
  assert.equal(events[0]?.value, "final@example.test");
  assert.equal(events[0]?.target?.label, "Email client");
  assert.equal(events[1]?.value, "");
  assert.equal(events[2]?.checked, false);
  assert.equal(events[3]?.value, "premium");
  assert.equal(
    events[4]?.target?.repeated?.distinguishingText,
    "Masaj Premium",
  );
  assert.equal(events[5]?.key, "Escape");
  assert.ok(
    !events.some((event) => event.type === "press_key" && event.key === "Tab"),
    "Tab must move focus without becoming a recorded step",
  );
  assert.equal(events[6]?.value, "2027");
  assert.equal(
    events[7]?.target?.dataAttributes?.["data-testid"],
    "calendar-next-month",
  );
  assert.equal(
    events[8]?.target?.dataAttributes?.["data-testid"],
    "calendar-day-2027-08-15",
  );
  assert.ok(Math.abs(events[9]?.scrollY ?? 0) >= 120);
  assert.equal(
    await page.locator("#appointment-date").inputValue(),
    "2027-08-15",
  );
  await assert.doesNotReject(async () => {
    await page
      .getByText("Data selectată: 15 august 2027 (2027-08-15)")
      .waitFor();
  });

  await stopRecorderCapture(page, bindingName);
  process.stdout.write(
    `Recorder smoke passed: ${types.join(", ")}; internal events ignored.\n`,
  );
} finally {
  await browser.close();
}
