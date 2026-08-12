import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";

import {
  LocatorResolutionError,
  createMatchPattern,
  resolveLocator,
  resolveUniqueLocator,
} from "./locator-resolver.js";

const locatorStub = (count = 1) => {
  const locator = {
    count: vi.fn().mockResolvedValue(count),
    waitFor: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn(),
    filter: vi.fn(),
    and: vi.fn(),
  };
  locator.locator.mockReturnValue(locator);
  locator.filter.mockReturnValue(locator);
  locator.and.mockReturnValue(locator);
  return locator;
};

describe("locator resolver", () => {
  it("resolves simple locators and builds match operators", async () => {
    const role = locatorStub();
    const getByRole = vi.fn().mockReturnValue(role);
    const page = {
      getByRole,
    } as unknown as Page;

    const resolved = await resolveUniqueLocator(page, {
      type: "role",
      role: "button",
      operator: "contains_all_keywords",
      value: ["adaugă", "coș"],
    });

    expect(resolved).toBe(role);
    const options = getByRole.mock.calls[0]?.[1] as
      { name?: string | RegExp } | undefined;
    expect(options?.name).toBeInstanceOf(RegExp);
    expect((options?.name as RegExp).test("Adaugă în coș")).toBe(true);
    expect(createMatchPattern("checkout", "starts_with").test("Checkout")).toBe(
      true,
    );
  });

  it("detects zero and multiple results", async () => {
    const missing = locatorStub(0);
    const ambiguous = locatorStub(3);
    const missingPage = {
      locator: vi.fn().mockReturnValue(missing),
    } as unknown as Page;
    const ambiguousPage = {
      locator: vi.fn().mockReturnValue(ambiguous),
    } as unknown as Page;
    const definition = {
      type: "css" as const,
      operator: "equals" as const,
      value: ".buy",
    };

    await expect(resolveUniqueLocator(missingPage, definition)).rejects.toEqual(
      expect.objectContaining<Partial<LocatorResolutionError>>({
        code: "locator_not_found",
        count: 0,
      }),
    );
    await expect(
      resolveUniqueLocator(ambiguousPage, definition),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocatorResolutionError>>({
        code: "locator_ambiguous",
        count: 3,
      }),
    );
  });

  it("waits for a delayed element before checking locator uniqueness", async () => {
    const delayed = locatorStub(1);
    const page = {
      locator: vi.fn().mockReturnValue(delayed),
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(
        page,
        {
          type: "css",
          operator: "equals",
          value: ".loaded-later",
        },
        { waitForMs: 5_000 },
      ),
    ).resolves.toBe(delayed);
    expect(delayed.waitFor).toHaveBeenCalledWith({
      state: "attached",
      timeout: 5_000,
    });
    expect(delayed.count).toHaveBeenCalledAfter(delayed.waitFor);
  });

  it("resolves relative and repeated component locators", () => {
    const target = locatorStub();
    const anchor = locatorStub();
    anchor.locator.mockImplementation((selector: string) =>
      selector === ".target" ? target : anchor,
    );
    const container = locatorStub();
    const matchingField = locatorStub();
    const filteredContainer = locatorStub();
    const repeatedTarget = locatorStub();
    container.locator.mockReturnValue(matchingField);
    container.filter.mockReturnValue(filteredContainer);
    filteredContainer.locator.mockReturnValue(repeatedTarget);
    const page = {
      locator: vi.fn((selector: string) =>
        selector === ".anchor" ? anchor : container,
      ),
    } as unknown as Page;

    expect(
      resolveLocator(page, {
        type: "relative",
        relation: "inside",
        anchor: {
          type: "css",
          operator: "equals",
          value: ".anchor",
        },
        target: {
          type: "css",
          operator: "equals",
          value: ".target",
        },
      }),
    ).toBe(target);

    expect(
      resolveLocator(page, {
        type: "repeated_component",
        container: {
          type: "css",
          operator: "equals",
          value: ".card",
        },
        filters: [
          {
            field: {
              type: "css",
              operator: "equals",
              value: ".name",
            },
            operator: "contains",
            value: "Produs",
          },
        ],
        targetInsideContainer: {
          type: "css",
          operator: "equals",
          value: ".buy",
        },
      }),
    ).toBe(repeatedTarget);
    expect(container.filter).toHaveBeenCalledWith({ has: matchingField });
  });
});
