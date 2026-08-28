import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { FetchJsonOptions, LoaderResult } from "@/app/_data/apiClient";

// Stub only the network/env-dependent parts of fetchJson (base URL, auth
// cookie, the actual fetch() call) while still running the REAL
// mapResponse callback getDealById passes in — that closure (and the real
// mapDealSummaries it now delegates to) is exactly what this regression
// test needs to exercise, since that is where the CRITICAL bug lived. A
// naive mock that returns a canned {data, source} pair would bypass
// mapResponse entirely and prove nothing.
const rawPayload = vi.fn<() => unknown>();
vi.mock("@/app/_data/apiClient", async (orig) => {
  const actual = await orig<typeof import("@/app/_data/apiClient")>();
  return {
    ...actual,
    fetchJson: async <TApi, TOutput>(
      _path: string,
      empty: TOutput,
      options: FetchJsonOptions<TApi, TOutput>,
    ): Promise<LoaderResult<TOutput>> => {
      const raw = rawPayload();
      if (raw === undefined) return { data: empty, source: "error" };
      const mapped = options.mapResponse(raw as TApi);
      return mapped === null ? { data: empty, source: "error" } : { data: mapped, source: "api" };
    },
  };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import DealDetailPage from "./page";

// This is the RAW shape services/crm-service actually returns from
// GET /v1/crm/deals/:id — Capitalized stage, a numeric version, no
// wrapping {data: ...} envelope (route.ts: `return reply.send(deal)`).
const RAW_DEAL = {
  id: "45a216ec-a498-42b8-aabd-ac1bd4b5b1c5",
  dealName: "Municipal Waste Contract",
  contactId: "c1",
  contactName: "Ward 12 Office",
  stage: "Proposal",
  valueMinor: 50000000,
  owner: "R. Iyer",
  closeDate: "2026-09-01",
  probability: 40,
  status: "active",
  version: 3,
};

describe("Deal detail page (getDealById regression)", () => {
  beforeEach(() => {
    rawPayload.mockReset();
  });

  // Regression test for the CRITICAL bug: getDealById used
  // `responseSchema: DealSummarySchema`, whose stage/status enums
  // ("prospecting"|... lowercase-snake) never match what the backend
  // actually returns (Capitalized "Lead"/"Proposal"/"Won"/"Lost"), so the
  // schema parse failed for every real deal and the page always rendered
  // "Deal not found" — regardless of which id was requested.
  it("renders a real deal instead of a false 'not found', normalizing the backend's Capitalized stage", async () => {
    rawPayload.mockReturnValue(RAW_DEAL);

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    expect(screen.queryByText("Deal not found")).not.toBeInTheDocument();
    expect(screen.getByText(`Deal ${RAW_DEAL.dealName}`)).toBeInTheDocument();
    // The Workflow timeline's "current step" must resolve against the
    // normalized stage — Capitalized "Proposal" in, canonical "proposal" out.
    const current = document.querySelector('li[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current).toHaveTextContent("Proposal");
    // The Stage field's pill must show the normalized value too, not the
    // raw "Proposal" the backend sent (proves mapDealSummaries actually ran).
    expect(screen.getByText("proposal")).toBeInTheDocument();
  });

  it("still shows a real not-found for a genuinely missing deal", async () => {
    rawPayload.mockReturnValue(null);

    const ui = await DealDetailPage({ params: { id: "00000000-0000-0000-0000-000000000000" } });
    render(ui);

    expect(screen.getByText("Deal not found")).toBeInTheDocument();
  });
});
