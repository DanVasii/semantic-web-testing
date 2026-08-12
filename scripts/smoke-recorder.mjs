import assert from "node:assert/strict";

import { chromium } from "playwright-core";

import {
  flushRecorderPendingInputs,
  installRecorderCapture,
  setRecorderPageBlocked,
  stopRecorderCapture,
} from "../dist/main/recorder/recorder-browser-capture.js";
import { buildRecorderStep } from "../dist/main/recorder/recorder-step-builder.js";
import { resolveUniqueLocator } from "../dist/main/runner/locator-resolver.js";
import { executeFlowItem } from "../dist/main/runner/step-executor.js";

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

  const password = page.locator("#customer-password");
  await password.fill("saved-on-done");
  assert.equal(
    events.length,
    1,
    "the active input must stay pending until blur or explicit flush",
  );
  await flushRecorderPendingInputs(page, bindingName);
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
  await page.getByRole("button", { name: "10:30" }).click();
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
    "fill",
    "select",
    "checkbox",
    "radio",
    "click",
    "press_key",
    "select",
    "click",
    "click",
    "click",
    "scroll",
  ]);
  assert.equal(events[0]?.value, "final@example.test");
  assert.equal(events[0]?.target?.label, "Email client");
  assert.equal(events[1]?.value, "saved-on-done");
  assert.equal(events[1]?.target?.label, "Parolă client");
  assert.equal(events[2]?.value, "");
  assert.equal(events[3]?.checked, false);
  assert.equal(events[4]?.value, "premium");
  assert.equal(
    events[5]?.target?.repeated?.distinguishingText,
    "Masaj Premium",
  );
  assert.equal(events[6]?.key, "Escape");
  assert.ok(
    !events.some((event) => event.type === "press_key" && event.key === "Tab"),
    "Tab must move focus without becoming a recorded step",
  );
  const radioDraft = buildRecorderStep(events[4], {
    createId: () => "radio-smoke",
  });
  assert.equal(
    radioDraft.step.target?.primary?.value,
    'input[type="radio"][name="customer_plan"][value="premium"]',
  );
  const uniqueRadio = await resolveUniqueLocator(
    page,
    radioDraft.step.target.primary,
  );
  assert.equal(await uniqueRadio.count(), 1);
  assert.equal(events[7]?.value, "2027");
  assert.equal(
    events[8]?.target?.dataAttributes?.["data-testid"],
    "calendar-next-month",
  );
  assert.equal(
    events[9]?.target?.dataAttributes?.["data-testid"],
    "calendar-day-2027-08-15",
  );
  assert.equal(events[10]?.target?.text, "10:30");
  assert.ok(Math.abs(events[11]?.scrollY ?? 0) >= 120);
  assert.equal(
    await page.locator("#appointment-date").inputValue(),
    "2027-08-15",
  );
  await assert.doesNotReject(async () => {
    await page
      .getByText("Data selectată: 15 august 2027 (2027-08-15)")
      .waitFor();
  });
  assert.equal(await page.locator("#appointment-time").inputValue(), "10:30");
  await assert.doesNotReject(async () => {
    await page.getByText("Ora selectată: 10:30").waitFor();
  });

  await stopRecorderCapture(page, bindingName);
  await page.locator('[data-testid="calendar-previous-month"]').click();
  await executeFlowItem(
    page,
    {
      id: "temporary-next-month",
      type: "action",
      actionType: "click",
      title: "Ajunge în septembrie",
      humanDescription:
        "Apasă luna următoare până când markerul vizual arată septembrie.",
      whyExplanation: "Plan AI temporar.",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-next-month",
        },
      },
      repeatUntil: {
        target: {
          type: "css",
          operator: "equals",
          value: "#calendar-heading",
        },
        operator: "equals",
        value: "septembrie 2027",
        maxAttempts: 24,
      },
      fallbacks: [],
      enabled: true,
    },
    {},
  );
  await executeFlowItem(
    page,
    {
      id: "temporary-september-day",
      type: "action",
      actionType: "click",
      title: "Alege 15 septembrie",
      humanDescription: "Alege ziua cerută.",
      whyExplanation: "Plan AI temporar.",
      target: {
        primary: {
          type: "data_attribute",
          attribute: "data-testid",
          operator: "equals",
          value: "calendar-day-2027-09-15",
        },
      },
      fallbacks: [],
      enabled: true,
    },
    {},
  );
  assert.equal(
    await page.locator("#appointment-date").inputValue(),
    "2027-09-15",
  );
  process.stdout.write(
    `Recorder smoke passed: ${types.join(", ")}; time shown; temporary AI calendar plan reached 2027-09-15.\n`,
  );
} finally {
  await browser.close();
}
