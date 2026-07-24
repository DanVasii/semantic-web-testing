import { describe, expect, it } from "vitest";

import {
  hasProjectInputErrors,
  normalizeProjectUrl,
  validateProjectInput,
} from "./projects.js";

describe("project URL normalization", () => {
  it("removes query strings and hashes while preserving the path", () => {
    expect(
      normalizeProjectUrl(" https://example.com/booking?service=10#payment "),
    ).toBe("https://example.com/booking");
  });
});

describe("project input validation", () => {
  it("requires a name and a complete HTTP(S) URL", () => {
    expect(validateProjectInput({ name: "", baseUrl: "example.com" })).toEqual({
      name: "Numele proiectului este obligatoriu.",
      baseUrl: "Introdu un URL complet și valid.",
    });
  });

  it("rejects unsupported schemes and credentials in URLs", () => {
    expect(
      validateProjectInput({
        name: "Demo",
        baseUrl: "file:///tmp/demo.html",
      }).baseUrl,
    ).toBe("URL-ul trebuie să folosească HTTP sau HTTPS.");
    expect(
      validateProjectInput({
        name: "Demo",
        baseUrl: "https://user:secret@example.com",
      }).baseUrl,
    ).toBe("Credentialele nu pot fi incluse în URL.");
  });

  it("accepts a trimmed project name and HTTPS URL", () => {
    expect(
      hasProjectInputErrors(
        validateProjectInput({
          name: " Magazin demo ",
          baseUrl: "https://example.com/app?preview=1",
        }),
      ),
    ).toBe(false);
  });
});
