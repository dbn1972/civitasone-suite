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
// GAP-CRM-DEALS-DETAIL-02: the page now branches on the LoaderResult.status to
// tell a genuine not-found (404 / 200-null) apart from a transient outage
// (5xx / network). This lets a test drive that status; raw===undefined keeps
// the previous behaviour (source:"error" with whatever status is set here).
let nextStatus: number | undefined;
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
      if (raw === undefined) return { data: empty, source: "error", status: nextStatus };
      const mapped = options.mapResponse(raw as TApi);
      return mapped === null
        ? { data: empty, source: "error", status: nextStatus }
        : { data: mapped, source: "api" };
    },
  };
});
let sessionRoles: string[] = ["crm_admin"];
vi.mock("@/lib/auth/roleGuard", async (orig) => {
  const actual = await orig<typeof import("@/lib/auth/roleGuard")>();
  return { ...actual, getSessionRoles: () => sessionRoles };
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
    nextStatus = undefined;
    sessionRoles = ["crm_admin"];
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

  // The server close endpoint is admin-only; the UI must not offer Won/Lost to crm_user.
  it("offers Mark Won / Mark Lost to CRM admins", async () => {
    rawPayload.mockReturnValue(RAW_DEAL);
    render(await DealDetailPage({ params: { id: RAW_DEAL.id } }));
    expect(screen.getByRole("button", { name: /mark won/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /mark lost/i })).toBeInTheDocument();
  });

  it("hides Mark Won / Mark Lost from a plain crm_user", async () => {
    sessionRoles = ["crm_user"];
    rawPayload.mockReturnValue(RAW_DEAL);
    render(await DealDetailPage({ params: { id: RAW_DEAL.id } }));
    expect(screen.queryByRole("button", { name: /mark won/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark lost/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /log activity/i })).toBeInTheDocument();
  });

  it("still shows a real not-found for a genuinely missing deal", async () => {
    rawPayload.mockReturnValue(null);
    nextStatus = 404; // backend's own 404 for a missing deal

    const ui = await DealDetailPage({ params: { id: "00000000-0000-0000-0000-000000000000" } });
    render(ui);

    expect(screen.getByText("Deal not found")).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-DETAIL-02: a 200 that carried no such deal (mapped to null)
  // also reads as a genuine not-found, not an outage.
  it("shows not-found when a 200 response carried no deal", async () => {
    rawPayload.mockReturnValue(null);
    nextStatus = 200;

    const ui = await DealDetailPage({ params: { id: "00000000-0000-0000-0000-000000000000" } });
    render(ui);

    expect(screen.getByText("Deal not found")).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-DETAIL-02: a 5xx must NOT read as a deletion — it is a
  // transient outage, so the page shows the retriable error state (Try again),
  // never "This deal does not exist or has been removed".
  it("shows a retriable error (not 'not found') on a 500 outage", async () => {
    rawPayload.mockReturnValue(undefined);
    nextStatus = 500;

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    expect(screen.queryByText("Deal not found")).not.toBeInTheDocument();
    expect(screen.queryByText("This deal does not exist or has been removed.")).not.toBeInTheDocument();
    // RefreshErrorState offers a "Try again" retry affordance.
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  // A thrown network failure (no status at all) is likewise an outage, not a
  // deletion.
  it("shows a retriable error on a network failure with no status", async () => {
    rawPayload.mockReturnValue(undefined);
    nextStatus = undefined;

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    expect(screen.queryByText("Deal not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/i })).toBeInTheDocument();
  });

  // GAP-CRM-DEALS-DETAIL-01: a LOST deal must show the open path complete, 'Closed
  // Lost' as the current step, and NEVER a 'Closed Won' entry — the old index-based
  // list rendered both terminals and showed Won as "done" for a lost deal.
  it("a lost deal shows Closed Lost as current with no Closed Won entry", async () => {
    rawPayload.mockReturnValue({ ...RAW_DEAL, stage: "Lost", status: "lost", probability: 0 });

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    // No 'Closed Won' step must exist at all.
    expect(screen.queryByText("Closed Won")).not.toBeInTheDocument();

    const current = document.querySelector('li[aria-current="step"]');
    expect(current).not.toBeNull();
    expect(current).toHaveTextContent("Closed Lost");

    // The open-path stages precede it and are marked done.
    const steps = Array.from(document.querySelectorAll("ul.tl li"));
    const labels = steps.map((li) => li.querySelector(".t")?.textContent ?? "");
    expect(labels.some((l) => l.includes("Prospecting"))).toBe(true);
    expect(labels.some((l) => l.includes("Proposal"))).toBe(true);
    expect(labels.some((l) => l.includes("Negotiation"))).toBe(true);
    const openSteps = steps.slice(0, 3);
    for (const li of openSteps) expect(li).toHaveClass("done");
  });

  // Symmetrical: a WON deal shows Closed Won current and no Closed Lost entry.
  it("a won deal shows Closed Won as current with no Closed Lost entry", async () => {
    rawPayload.mockReturnValue({ ...RAW_DEAL, stage: "Won", status: "won", probability: 100 });

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    expect(screen.queryByText("Closed Lost")).not.toBeInTheDocument();
    const current = document.querySelector('li[aria-current="step"]');
    expect(current).toHaveTextContent("Closed Won");
  });

  // An open deal is unaffected: current step is the open stage, terminal is a neutral
  // 'Closed' todo with neither Won nor Lost shown.
  it("an open deal keeps its open stage current and shows a neutral Closed step", async () => {
    rawPayload.mockReturnValue({ ...RAW_DEAL, stage: "Negotiation", status: "active" });

    const ui = await DealDetailPage({ params: { id: RAW_DEAL.id } });
    render(ui);

    expect(screen.queryByText("Closed Won")).not.toBeInTheDocument();
    expect(screen.queryByText("Closed Lost")).not.toBeInTheDocument();
    expect(screen.getByText("Closed")).toBeInTheDocument();
    const current = document.querySelector('li[aria-current="step"]');
    expect(current).toHaveTextContent("Negotiation");
  });
});
