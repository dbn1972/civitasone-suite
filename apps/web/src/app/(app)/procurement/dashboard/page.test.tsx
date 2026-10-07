import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { procurementTiles } from "../tiles";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});

import ProcurementDashboardPage from "./page";

const MOCK_DASHBOARD = { pendingIndents: 5, activePOs: 18, grnsThisMonth: 9, contractRenewalsDue: 2 };

function mockProcurementLoader(result: { data: unknown; source: "api" | "error" }) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/procurement/dashboard")) return Promise.resolve(result);
    return Promise.resolve({ data: null, source: "api" });
  });
}

describe("ProcurementDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders real stat counts when the loader succeeds", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Pending Indents").closest(".stat")).toHaveTextContent("5");
    expect(screen.getByText("Active POs").closest(".stat")).toHaveTextContent("18");
  });

  it("renders — for every stat, not a fabricated zero, when the loader fails", async () => {
    // Bug A / UX-013: `source` was already fetched here but only wired to a
    // DataSourceBadge whose own copy claims "Couldn't load — showing
    // nothing" -- contradicted by the stat grid actually showing "0" for
    // every card. Gate every stat on it instead.
    mockProcurementLoader({
      data: { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
      source: "error",
    });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Pending Indents").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Active POs").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("GRNs (MTD)").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Contract Renewals Due").closest(".stat")).toHaveTextContent("—");
  });

  it("GAP-PROCUREMENT-DASHBOARD-03: drops the misleading 'Real-time' copy and stamps a 'Data as of' time", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());
    // Old copy claimed a real-time feed; the loader actually revalidates on a
    // 60s window, so this is a point-in-time snapshot. The word "Real-time"
    // must be gone and a freshness stamp present.
    expect(screen.queryByText(/Real-time/i)).toBeNull();
    expect(screen.getByText(/Data as of/i)).toBeInTheDocument();
  });

  it("GAP-PROCUREMENT-DASHBOARD-03: shows no 'Data as of' stamp when the load errored", async () => {
    mockProcurementLoader({
      data: { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
      source: "error",
    });
    render(await ProcurementDashboardPage());
    expect(screen.queryByText(/Data as of/i)).toBeNull();
  });

  it("GAP-PROCUREMENT-DASHBOARD-02: counters are actionable, drilling into the filtered list each one counts", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());
    // Each counter tile is a snapshot of a pending-action queue, so the whole
    // tile must be a link into that queue. Previously they were plain divs.
    expect(screen.getByText("Pending Indents").closest("a")).toHaveAttribute("href", "/procurement/indents?status=pending");
    expect(screen.getByText("Active POs").closest("a")).toHaveAttribute("href", "/procurement/orders?status=active");
    expect(screen.getByText("GRNs (MTD)").closest("a")).toHaveAttribute("href", "/procurement/grn");
    expect(screen.getByText("Contract Renewals Due").closest("a")).toHaveAttribute("href", "/procurement/contracts?status=renewal_due");
  });

  it("GAP-PROCUREMENT-DASHBOARD-02: counters are NOT links when the load errored (nothing to act on)", async () => {
    mockProcurementLoader({
      data: { pendingIndents: 0, activePOs: 0, grnsThisMonth: 0, contractRenewalsDue: 0 },
      source: "error",
    });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Pending Indents").closest("a")).toBeNull();
    expect(screen.getByText("Contract Renewals Due").closest("a")).toBeNull();
  });

  it("GAP-PROCUREMENT-DASHBOARD-04: every hub module (except Dashboard itself) is reachable from the dashboard, with a 'View all modules' link", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());

    // The dashboard renders the SAME shared tiles the hub does — previously it
    // hard-coded a separate 8-entry list that orphaned eight modules
    // (incl. GeM, EMD & BG, Empanelment). Assert each non-Dashboard tile is
    // linked here.
    const expected = procurementTiles.filter((t) => t.href !== "/procurement/dashboard");
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    for (const tile of expected) {
      expect(hrefs).toContain(tile.href);
    }
    // Specifically the three modules reviewed in this batch were previously
    // unreachable from the dashboard.
    expect(hrefs).toContain("/procurement/gem");
    expect(hrefs).toContain("/procurement/emd-bg");
    expect(hrefs).toContain("/procurement/empanelment");
    // And a direct link to the full hub.
    expect(hrefs).toContain("/procurement");
  });
});
