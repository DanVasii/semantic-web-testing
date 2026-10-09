// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import type { AiRunCost } from "../../shared/runner.js";
import { AiRunCostDetails } from "./AiRunCostDetails.js";

afterEach(cleanup);

describe("AiRunCostDetails", () => {
  it("expands every AI request with its reason, cost, payload and response", async () => {
    const user = userEvent.setup();
    const cost: AiRunCost = {
      requestCount: 1,
      inputTokens: 120,
      outputTokens: 30,
      totalTokens: 150,
      estimatedUsd: 0.00042,
      unpricedRequests: 0,
      localOnly: false,
      requests: [
        {
          id: "request-1",
          reason: "Verificarea vizuală pentru pasul Calendar.",
          provider: "gemini",
          model: "gemini-flash",
          inputTokens: 120,
          outputTokens: 30,
          totalTokens: 150,
          estimatedUsd: 0.00042,
          local: false,
          payload: { prompt: "Selectează data disponibilă" },
          response: { status: "done", observation: "Data este selectată" },
          createdAt: "2026-09-18T10:00:00.000Z",
        },
      ],
    };

    render(<AiRunCostDetails cost={cost} />);
    await user.click(
      screen.getByRole("button", { name: "Explică requesturile" }),
    );

    expect(screen.getByText(/Request 1 \(Verificarea vizuală/u)).not.toBeNull();
    expect(screen.getAllByText(/\$0\.000420/u)).toHaveLength(2);
    expect(screen.getByText("Payload trimis")).not.toBeNull();
    expect(screen.getByText("Răspuns primit")).not.toBeNull();
  });
});
