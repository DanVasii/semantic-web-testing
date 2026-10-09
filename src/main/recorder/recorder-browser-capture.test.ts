// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RecorderRawEvent } from "../../shared/recorder.js";
import { recorderInitScript } from "./recorder-browser-capture.js";

describe("recorderInitScript", () => {
  afterEach(() => {
    vi.useRealTimers();
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

  it("captures file selection as an upload action without exposing a local path", async () => {
    document.body.innerHTML = `<label for="cv">CV</label><input id="cv" name="cv" type="file" />`;
    const bindingName = "__recorderFileTest";
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
    const input = document.querySelector<HTMLInputElement>("#cv");
    if (input === null) throw new Error("Inputul file lipsește.");
    Object.defineProperty(input, "files", {
      configurable: true,
      value: [new File(["cv"], "candidate.pdf", { type: "application/pdf" })],
    });

    input.dispatchEvent(new Event("change", { bubbles: true }));
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "upload_file",
      value: "candidate.pdf",
      target: { inputType: "file", label: "CV" },
    });
  });

  it("keeps editing keys pending and emits only the final value on focusout", async () => {
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
      new KeyboardEvent("keydown", { bubbles: true, key: "Backspace" }),
    );
    firstName.value = "An";
    firstName.dispatchEvent(new Event("input", { bubbles: true }));
    firstName.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Delete" }),
    );
    firstName.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    expect(events).toHaveLength(0);
    firstName.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Tab" }),
    );
    firstName.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "fill",
      value: "An",
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
      <div class="product-card">
        <img alt="Ser facial" src="ser-facial.png" />
        <h3>Ser facial hidratant</h3>
      </div>
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
    const productImage =
      document.querySelector<HTMLElement>(".product-card img");
    if (
      dayText === null ||
      customTrigger === null ||
      treatmentTitle === null ||
      productImage === null
    ) {
      throw new Error("Elementele custom din fixture lipsesc.");
    }

    dayText.click();
    await Promise.resolve();
    customTrigger.click();
    await Promise.resolve();
    treatmentTitle.click();
    await Promise.resolve();
    productImage.click();
    await Promise.resolve();

    expect(events).toHaveLength(4);
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
    expect(events[3]).toMatchObject({
      type: "click",
      target: {
        tagName: "div",
        actionText: "Ser facial hidratant",
      },
    });
  });

  it("attaches a JS hover effect to the revealed click without adding a hover step", async () => {
    document.body.innerHTML = `
      <div id="cart" role="button" aria-haspopup="menu" tabindex="0">
        <span>Coș</span>
        <div id="cart-menu" role="menu">
          <button id="checkout">Finalizează</button>
        </div>
      </div>
      <button id="account">Contul meu</button>
    `;
    const bindingName = "__recorderHoverTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const cart = document.querySelector<HTMLElement>("#cart");
    const checkout = document.querySelector<HTMLButtonElement>("#checkout");
    const menu = document.querySelector<HTMLElement>("#cart-menu");
    const account = document.querySelector<HTMLButtonElement>("#account");
    if (
      cart === null ||
      checkout === null ||
      menu === null ||
      account === null
    ) {
      throw new Error("Meniul coșului nu a fost creat.");
    }
    cart.addEventListener("mouseover", () => {
      cart.setAttribute("aria-expanded", "true");
      menu.classList.add("is-open");
    });

    cart.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await Promise.resolve();
    checkout.click();
    await Promise.resolve();

    expect(events.map(({ type }) => type)).toEqual(["click"]);
    expect(events[0]).toMatchObject({
      type: "click",
      target: { id: "checkout", role: "button", text: "Finalizează" },
    });
    expect(
      events[0]?.hoverCandidates?.some(
        (candidate) => candidate.id === "cart" && candidate.role === "button",
      ),
    ).toBe(true);

    account.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    account.click();
    await Promise.resolve();
    expect(events.map(({ type }) => type)).toEqual(["click", "click"]);
    expect(events[1]?.hoverCandidates).toBeUndefined();
  });

  it("derives a reveal owner from a CSS hover rule", async () => {
    document.body.innerHTML = `
      <style>.nav-cart:hover .cart-menu { display: block; }</style>
      <div class="nav-cart" id="css-cart">
        <span>Coș</span>
        <div class="cart-menu"><button id="css-checkout">Finalizează</button></div>
      </div>
    `;
    const bindingName = "__recorderCssHoverTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const cart = document.querySelector<HTMLElement>("#css-cart");
    const checkout = document.querySelector<HTMLButtonElement>("#css-checkout");
    if (cart === null || checkout === null) {
      throw new Error("Meniul CSS al coșului nu a fost creat.");
    }

    cart.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    checkout.click();
    await Promise.resolve();

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("click");
    expect(
      events[0]?.hoverCandidates?.some(
        (candidate) => candidate.id === "css-cart",
      ),
    ).toBe(true);
  });

  it("records the real delta and semantic target of a nested scroll container", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div id="results" data-testid="search-results" style="overflow-y: auto">
        <div>Rezultate</div>
      </div>
    `;
    const bindingName = "__recorderNestedScrollTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const results = document.querySelector<HTMLElement>("#results");
    if (results === null) throw new Error("Containerul scrollabil lipsește.");
    Object.defineProperties(results, {
      clientHeight: { configurable: true, value: 300 },
      scrollHeight: { configurable: true, value: 1_200 },
    });

    // Chrome poate actualiza poziția prin compositor înainte ca listenerul
    // wheel din pagină să ruleze. Baseline-ul trebuie reconstruit din delta.
    results.scrollTop = 260;
    results.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 260 }),
    );
    results.dispatchEvent(new Event("scroll"));
    await vi.advanceTimersByTimeAsync(180);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "scroll",
      scrollX: 0,
      scrollY: 260,
      scrollMode: "wheel",
      target: {
        id: "results",
        dataAttributes: { "data-testid": "search-results" },
      },
    });

    const control = recorderGlobal[controlName] as
      { stop?: () => void } | undefined;
    control?.stop?.();
  });

  it("records a wheel gesture even when the page does not change scrollTop", async () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <main id="virtual-catalog" data-testid="virtual-catalog">
        Catalog controlat din JavaScript
      </main>
    `;
    const bindingName = "__recorderVirtualScrollTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const catalog = document.querySelector<HTMLElement>("#virtual-catalog");
    if (catalog === null) throw new Error("Catalogul virtual lipsește.");
    catalog.dispatchEvent(
      new WheelEvent("wheel", { bubbles: true, deltaY: 180 }),
    );
    await vi.advanceTimersByTimeAsync(180);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "scroll",
      scrollX: 0,
      scrollY: 180,
      scrollMode: "wheel",
      target: { id: "virtual-catalog" },
    });

    const control = recorderGlobal[controlName] as
      { stop?: () => void } | undefined;
    control?.stop?.();
  });

  it("captures a custom dropdown option on pointerdown and does not duplicate its click", async () => {
    document.body.innerHTML = `
      <div class="select2-dropdown">
        <div role="listbox">
          <input id="state-search" type="search" aria-label="Caută județ" />
          <div class="select2-results__option" role="option">
            <span id="state-option-text">Prahova</span>
          </div>
        </div>
      </div>
    `;
    const bindingName = "__recorderCustomOptionTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const search = document.querySelector<HTMLInputElement>("#state-search");
    const optionText =
      document.querySelector<HTMLElement>("#state-option-text");
    if (search === null || optionText === null) {
      throw new Error("Fixture-ul dropdownului custom lipsește.");
    }
    search.value = "pr";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    optionText.dispatchEvent(
      new MouseEvent("pointerdown", { bubbles: true, composed: true }),
    );
    search.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    optionText.click();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.map(({ type }) => type)).toEqual(["fill", "click"]);
    expect(events[0]).toMatchObject({
      type: "fill",
      value: "pr",
      target: { id: "state-search" },
    });
    expect(events[1]).toMatchObject({
      type: "click",
      target: { role: "option", text: "Prahova" },
    });
  });

  it("captures the highlighted custom option when Enter confirms the search", async () => {
    document.body.innerHTML = `
      <select class="select2-hidden-accessible" aria-hidden="true">
        <option value="PH">Prahova</option>
      </select>
      <div class="select2-dropdown">
        <input
          id="county-search"
          type="search"
          aria-controls="county-results"
          aria-activedescendant="county-option-ph"
        />
        <ul id="county-results" role="listbox">
          <li
            id="county-option-ph"
            class="select2-results__option select2-results__option--highlighted"
            role="option"
            aria-selected="false"
          >Prahova</li>
        </ul>
      </div>
    `;
    const bindingName = "__recorderCustomOptionEnterTest";
    const controlName = `${bindingName}Control`;
    Object.defineProperty(globalThis, "CSS", {
      configurable: true,
      value: { escape: (value: string) => value },
    });
    const recorderGlobal = globalThis as unknown as Record<string, unknown>;
    const events: RecorderRawEvent[] = [];
    recorderGlobal[bindingName] = (event: RecorderRawEvent) => {
      events.push(event);
      return Promise.resolve();
    };
    recorderInitScript({ bindingName, controlName });

    const search = document.querySelector<HTMLInputElement>("#county-search");
    const hiddenSelect = document.querySelector<HTMLSelectElement>("select");
    if (search === null || hiddenSelect === null) {
      throw new Error("Fixture-ul Select2 pentru Enter lipsește.");
    }
    search.value = "pr";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    search.dispatchEvent(
      new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
    );
    hiddenSelect.value = "PH";
    hiddenSelect.dispatchEvent(new Event("change", { bubbles: true }));
    search.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(events.map(({ type }) => type)).toEqual(["fill", "click"]);
    expect(events[0]).toMatchObject({ type: "fill", value: "pr" });
    expect(events[1]).toMatchObject({
      type: "click",
      target: { role: "option", text: "Prahova" },
    });
  });
});
