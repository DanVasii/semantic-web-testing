// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";

import type { RecorderRawEvent } from "../../shared/recorder.js";
import { recorderInitScript } from "./recorder-browser-capture.js";

describe("recorderInitScript", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("debounces text values without turning checkbox focusout into a false fill", async () => {
    document.body.innerHTML = `
      <form>
        <label for="email">Email client</label>
        <input id="email" name="email" type="email" />
        <label><input id="newsletter" name="newsletter" type="checkbox" /> Noutăți</label>
        <label><input id="premium" name="plan" type="radio" value="premium" /> Premium</label>
      </form>
    `;
    const bindingName = "__recorderCaptureTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: {
        escape: (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "\\$&"),
      },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      const control = recorderGlobal[controlName] as
        { setBlocked?: (blocked: boolean) => void } | undefined;
      control?.setBlocked?.(false);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const email = document.querySelector<HTMLInputElement>("#email");
    const checkbox = document.querySelector<HTMLInputElement>("#newsletter");
    const radio = document.querySelector<HTMLInputElement>("#premium");
    if (email === null || checkbox === null || radio === null) {
      throw new Error("Fixture-ul DOM nu a fost creat.");
    }

    email.value = "draft@example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    email.value = "final@example.test";
    email.dispatchEvent(new Event("input", { bubbles: true }));
    email.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    checkbox.checked = true;
    checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    checkbox.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    radio.checked = true;
    radio.dispatchEvent(new Event("input", { bubbles: true }));
    radio.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();

    expect(events.map(({ type }) => type)).toEqual([
      "fill",
      "checkbox",
      "radio",
    ]);
    expect(events[0]).toMatchObject({
      type: "fill",
      value: "final@example.test",
      target: { label: "Email client" },
    });
    expect(events[1]).toMatchObject({ type: "checkbox", checked: true });
    expect(events[2]).toMatchObject({
      type: "radio",
      checked: true,
      value: "premium",
    });
  });

  it("treats Tab as focus navigation and keeps the completed input as the only step", async () => {
    document.body.innerHTML = `
      <label for="first-name">Prenume</label>
      <input id="first-name" name="first_name" type="text" />
      <label for="last-name">Nume</label>
      <input id="last-name" name="last_name" type="text" />
    `;
    const bindingName = "__recorderTabTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      const control = recorderGlobal[controlName] as
        { setBlocked?: (blocked: boolean) => void } | undefined;
      control?.setBlocked?.(false);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const firstName = document.querySelector<HTMLInputElement>("#first-name");
    if (firstName === null) throw new Error("Inputul fixture lipsește.");
    firstName.value = "Ana";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
    firstName.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
    );
    firstName.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "fill",
      value: "Ana",
      target: { name: "first_name" },
    });
  });

  it("flushes the last focused input explicitly before Done", async () => {
    document.body.innerHTML = `
      <label for="notes">Observații</label>
      <input id="notes" name="notes" type="text" />
    `;
    const bindingName = "__recorderDoneFlushTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      const control = recorderGlobal[controlName] as
        { setBlocked?: (blocked: boolean) => void } | undefined;
      control?.setBlocked?.(false);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const notes = document.querySelector<HTMLInputElement>("#notes");
    if (notes === null) throw new Error("Inputul fixture lipsește.");
    notes.value = "Valoarea finală";
    notes.dispatchEvent(new Event("input", { bubbles: true }));
    expect(events).toHaveLength(0);

    const control = recorderGlobal[controlName] as
      { flushPending?: () => Promise<void> } | undefined;
    await control?.flushPending?.();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "fill",
      value: "Valoarea finală",
      target: { name: "notes" },
    });
  });

  it("records custom clickable div and span elements without requiring a button tag", async () => {
    document.body.innerHTML = `
      <div
        class="calendar-day"
        role="gridcell"
        tabindex="0"
        data-date="2026-08-17"
      ><span>17</span></div>
      <span id="custom-trigger">Deschide detalii</span>
      <article data-action="open-treatment">
        <span>ADOLESCENȚI</span>
        <h3>TEEN SKIN RITUAL</h3>
        <p>Pentru pielea sensibilă, predispusă la erupții.</p>
        <strong>450,00 lei</strong>
      </article>
    `;
    const bindingName = "__recorderCustomClickableTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      const control = recorderGlobal[controlName] as
        { setBlocked?: (blocked: boolean) => void } | undefined;
      control?.setBlocked?.(false);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const dayText = document.querySelector<HTMLElement>(".calendar-day span");
    const customTrigger =
      document.querySelector<HTMLElement>("#custom-trigger");
    const treatmentTitle = document.querySelector<HTMLElement>("article h3");
    if (dayText === null || customTrigger === null || treatmentTitle === null) {
      throw new Error("Elementele custom din fixture lipsesc.");
    }

    dayText.click();
    await Promise.resolve();
    customTrigger.click();
    await Promise.resolve();
    treatmentTitle.click();
    await Promise.resolve();

    expect(events).toHaveLength(3);
    expect(events[0]).toMatchObject({
      type: "click",
      target: {
        tagName: "div",
        role: "gridcell",
        dataAttributes: { "data-date": "2026-08-17" },
      },
    });
    expect(events[1]).toMatchObject({
      type: "click",
      target: {
        tagName: "span",
        id: "custom-trigger",
        text: "Deschide detalii",
      },
    });
    expect(events[2]).toMatchObject({
      type: "click",
      target: {
        tagName: "article",
        actionText: "TEEN SKIN RITUAL",
        dataAttributes: { "data-action": "open-treatment" },
      },
    });
  });
});
