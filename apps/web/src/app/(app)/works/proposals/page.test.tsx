import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

/**
 * GAP-WORKS-PROPOSALS-02/03/04 and the earlier L3 dead-tab fix.
 *
 * - Stats, tab counts and the card title are all derived from the SAME client
 *   `data` the table renders (02/03) — never a separate server read that can
 *   disagree offline.
 * - The active tab carries aria-current="page" and an unknown ?status= shows
 *   the full "All" list, not an empty "All (0)" (04).
 * - Only the two reachable statuses (Draft, DAO Finalized) are offered.
 */

const getProposalsMock = vi.fn();
const getWorkTypeNameMapMock = vi.fn();
vi.mock("../_data/loaders", () => ({
  getProposals: (...args: unknown[]) => getProposalsMock(...args),
  getWorkTypeNameMap: (...args: unknown[]) => getWorkTypeNameMapMock(...args),
}));
// Render the real server data through the view: the hook returns initialData
// as live (cacheHit false) when source==="api".
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_key: string, initialData: unknown[], source: "api" | "error") => ({
    data: initialData,
    fromCache: false,
    offline: false,
    cachedAt: null,
    provenance: source === "error" && (initialData as unknown[]).length === 0 ? "error-no-data" : "live",
  }),
}));

import ProposalsPage from "./page";

const rows = [
  { id: "p1", workNumber: "WRK/2026/001", description: "Culvert", category: "Regular", workTypeId: "wt1", type: "—", estimatedCost: "5000000", status: "draft", office: "—" },
  { id: "p2", workNumber: "WRK/2026/002", description: "Road", category: "Regular", workTypeId: "wt1", type: "—", estimatedCost: "9000000", status: "dao_finalized", office: "—" },
  { id: "p3", workNumber: "WRK/2026/003", description: "Drain", category: "Regular", workTypeId: "wt1", type: "—", estimatedCost: "3000000", status: "draft", office: "—" },
];

describe("ProposalsPage", () => {
  beforeEach(() => {
    getProposalsMock.mockReset();
    getWorkTypeNameMapMock.mockReset();
    getProposalsMock.mockResolvedValue({ data: rows, source: "api" });
    getWorkTypeNameMapMock.mockResolvedValue({ data: { wt1: "Road Works" }, source: "api" });
  });

  it("resolves the work-type id to a readable name in the Type column (01)", async () => {
    render(await ProposalsPage({ searchParams: {} }));
    expect(screen.getAllByText("Road Works").length).toBeGreaterThan(0);
  });

  it("computes stat/tab counts from the client data (02/03)", async () => {
    render(await ProposalsPage({ searchParams: {} }));
    expect(screen.getByRole("link", { name: "Draft (2)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "DAO Finalized (1)" })).toBeInTheDocument();
    expect(screen.getByText("All Proposals (3)")).toBeInTheDocument();
  });

  it("marks the active tab with aria-current='page' (04)", async () => {
    render(await ProposalsPage({ searchParams: { status: "draft" } }));
    expect(screen.getByRole("link", { name: "Draft (2)" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "DAO Finalized (1)" })).not.toHaveAttribute("aria-current");
  });

  it("normalises an unknown status to All with the full list (04)", async () => {
    render(await ProposalsPage({ searchParams: { status: "foo" } }));
    // Title shows the full list, not "All (0)".
    expect(screen.getByText("All Proposals (3)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "All (3)" })).toHaveAttribute("aria-current", "page");
  });

  it("does not offer dead 'Submitted' / 'TS Eligible' tabs or stat card", async () => {
    render(await ProposalsPage({ searchParams: {} }));
    expect(screen.queryByRole("link", { name: /^Submitted/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^TS Eligible/i })).not.toBeInTheDocument();
    expect(screen.queryByText("TS Eligible")).not.toBeInTheDocument();
  });

  it("filters rows to the active tab (03)", async () => {
    render(await ProposalsPage({ searchParams: { status: "dao_finalized" } }));
    expect(screen.getByText("WRK/2026/002")).toBeInTheDocument();
    expect(screen.queryByText("WRK/2026/001")).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "DAO Finalized (1)" })).toHaveAttribute("aria-current", "page");
  });

  it("shows an honest error state when the load fails with no cache (02)", async () => {
    getProposalsMock.mockResolvedValue({ data: [], source: "error" });
    render(await ProposalsPage({ searchParams: {} }));
    expect(screen.getByText(/couldn't load work proposals/i)).toBeInTheDocument();
  });
});
