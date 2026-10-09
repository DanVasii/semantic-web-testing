import { describe, expect, it } from "vitest";

import { SessionVariableContext } from "./session-variable-context.js";

const clock = () => new Date("2026-09-17T10:00:00.000Z");

describe("SessionVariableContext", () => {
  it("resolves typed values in stage URL templates", () => {
    const context = new SessionVariableContext(clock);
    context.seed("baseUrl", "https://shop.test/", "url", "system");
    context.publish([
      {
        output: {
          name: "orderId",
          type: "number",
          required: true,
          overwritePolicy: "deny",
        },
        value: 42,
        source: "mysql",
      },
    ]);
    expect(context.resolveUrlTemplate("{{baseUrl}}/order/{{orderId}}")).toBe(
      "https://shop.test/order/42",
    );
  });

  it("uses a complete URL stored in one variable", () => {
    const context = new SessionVariableContext(clock);
    context.publish([
      {
        output: {
          name: "payment_url",
          type: "url",
          required: true,
          overwritePolicy: "deny",
        },
        value: "https://pay.shop.test/session/abc?source=email",
        source: "imap",
      },
    ]);

    expect(context.resolveUrlTemplate("{{payment_url}}")).toBe(
      "https://pay.shop.test/session/abc?source=email",
    );
  });

  it("publishes atomically when one value is invalid", () => {
    const context = new SessionVariableContext(clock);
    expect(() =>
      context.publish([
        {
          output: {
            name: "orderId",
            type: "number",
            required: true,
            overwritePolicy: "deny",
          },
          value: 42,
          source: "mysql",
        },
        {
          output: {
            name: "paymentLink",
            type: "url",
            required: true,
            overwritePolicy: "deny",
          },
          value: "javascript:alert(1)",
          source: "imap",
        },
      ]),
    ).toThrow();
    expect(context.has("orderId")).toBe(false);
  });

  it("supports a validated manual replacement", () => {
    const context = new SessionVariableContext(clock);
    const [value] = context.publish([
      {
        output: {
          name: "paymentLink",
          type: "url",
          required: true,
          overwritePolicy: "deny",
        },
        value: "https://shop.test/pay/token",
        source: "manual",
        manual: true,
      },
    ]);
    expect(value).toMatchObject({ manual: true, type: "url" });
    expect(context.variableUrl("paymentLink")).toBe(
      "https://shop.test/pay/token",
    );
  });
});
