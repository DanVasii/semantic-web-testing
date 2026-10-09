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

  it("chooses the only visible and enabled result from responsive duplicates", async () => {
    const hidden = {
      isVisible: vi.fn().mockResolvedValue(false),
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const visible = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
    };
    const duplicate = locatorStub(2);
    Object.assign(duplicate, {
      nth: vi.fn((index: number) => (index === 0 ? hidden : visible)),
    });
    const page = {
      locator: vi.fn().mockReturnValue(duplicate),
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(page, {
        type: "css",
        operator: "equals",
        value: ".responsive-buy",
      }),
    ).resolves.toBe(visible);
  });

  it("accepts visible duplicate links only when their behavior is identical", async () => {
    const sameLinkFingerprint = {
      kind: "link",
      action: "https://shop.test/cart",
      attributes: { download: "", onclick: "", rel: "", target: "" },
    };
    const first = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue(sameLinkFingerprint),
    };
    const second = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue(sameLinkFingerprint),
    };
    const duplicate = locatorStub(2);
    Object.assign(duplicate, {
      nth: vi.fn((index: number) => (index === 0 ? first : second)),
    });
    const page = {
      locator: vi.fn().mockReturnValue(duplicate),
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(page, {
        type: "css",
        operator: "equals",
        value: ".cart-link",
      }),
    ).resolves.toBe(first);

    second.evaluate.mockResolvedValue({
      ...sameLinkFingerprint,
      action: "https://shop.test/account",
    });
    await expect(
      resolveUniqueLocator(page, {
        type: "css",
        operator: "equals",
        value: ".cart-link",
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<LocatorResolutionError>>({
        code: "locator_ambiguous",
        count: 2,
      }),
    );
  });

  it("accepts duplicate submit buttons only when they submit the same value to the same form", async () => {
    const submitFingerprint = {
      kind: "submit",
      action: "https://shop.test/cart",
      attributes: {
        formMethod: "post",
        formTarget: "",
        name: "add-to-cart",
        onclick: "",
        type: "submit",
        value: "586",
      },
    };
    const buttons = [0, 1].map(() => ({
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue(submitFingerprint),
    }));
    const duplicate = locatorStub(2);
    Object.assign(duplicate, {
      nth: vi.fn((index: number) => buttons[index]),
    });
    const page = {
      locator: vi.fn().mockReturnValue(duplicate),
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(page, {
        type: "css",
        operator: "equals",
        value: 'button[name="add-to-cart"]',
      }),
    ).resolves.toBe(buttons[0]);
  });

  it("prefers the only interactive match when text also matches its heading", async () => {
    const heading = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue(undefined),
    };
    const productLink = {
      isVisible: vi.fn().mockResolvedValue(true),
      isEnabled: vi.fn().mockResolvedValue(true),
      evaluate: vi.fn().mockResolvedValue({
        kind: "link",
        action: "https://shop.test/produs/tricou-gros/",
        attributes: { download: "", onclick: "", rel: "", target: "" },
      }),
    };
    const textMatches = locatorStub(2);
    Object.assign(textMatches, {
      nth: vi.fn((index: number) => (index === 0 ? heading : productLink)),
    });
    const page = {
      getByText: vi.fn().mockReturnValue(textMatches),
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(
        page,
        {
          type: "text",
          operator: "equals",
          value: "Tricou gros — Ediție neagră",
        },
        { preferInteractive: true },
      ),
    ).resolves.toBe(productLink);
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

  it("polls matching cross-origin frames until a delayed input appears", async () => {
    const mainLocator = locatorStub(0);
    const stripeLocator = locatorStub(0);
    stripeLocator.count
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValue(1);
    const mainFrame = {
      url: vi.fn().mockReturnValue("https://shop.test/checkout"),
      locator: vi.fn().mockReturnValue(mainLocator),
    };
    const stripeFrameLocator = vi.fn().mockReturnValue(stripeLocator);
    const stripeFrame = {
      url: vi
        .fn()
        .mockReturnValue("https://js.stripe.com/v3/elements-inner-payment"),
      locator: stripeFrameLocator,
    };
    const pageWaitForTimeout = vi.fn().mockResolvedValue(undefined);
    const page = {
      frames: vi.fn().mockReturnValue([mainFrame, stripeFrame]),
      mainFrame: vi.fn().mockReturnValue(mainFrame),
      waitForTimeout: pageWaitForTimeout,
    } as unknown as Page;

    await expect(
      resolveUniqueLocator(
        page,
        {
          type: "css",
          operator: "equals",
          value: "#payment-numberInput",
        },
        {
          frame: { origin: "https://js.stripe.com" },
          searchAllFrames: true,
          waitForMs: 1_000,
          pollIntervalMs: 250,
        },
      ),
    ).resolves.toBe(stripeLocator);
    expect(stripeFrameLocator).toHaveBeenCalledWith("#payment-numberInput");
    expect(mainFrame.locator).not.toHaveBeenCalled();
    expect(pageWaitForTimeout).toHaveBeenCalledTimes(2);
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
