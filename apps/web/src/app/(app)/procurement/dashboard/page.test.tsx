import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createTranslator } from "next-intl";
import en from "@/messages/en.json";
import { procurementTiles } from "../tiles";
import {
  PENDING_INDENT_STATUSES, PENDING_INDENTS_HREF, ACTIVE_PO_STATUS, ACTIVE_POS_HREF,
  CONTRACTS_REGISTER_HREF, parseIndentStatusFilter, parsePoStatusParam,
} from "../drillThrough";

// Server component: resolve namespaced keys against the real en messages.
vi.mock("next-intl/server", () => ({
  getTranslations: async (ns: string) => createTranslator({ locale: "en", messages: en as never, namespace: ns as never }),
}));

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
    expect(screen.getByText("Pending Indents").closest("a")).toHaveAttribute("href", PENDING_INDENTS_HREF);
    expect(screen.getByText("Active POs").closest("a")).toHaveAttribute("href", ACTIVE_POS_HREF);
    expect(screen.getByText("GRNs (MTD)").closest("a")).toHaveAttribute("href", "/procurement/grn");
    expect(screen.getByText("Contract Renewals Due").closest("a")).toHaveAttribute("href", CONTRACTS_REGISTER_HREF);
  });

  it("GAP-PROCUREMENT-DASHBOARD-02: each filtered drill-through link is understood by the page it opens", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());

    // Pending Indents counts draft + pending: the link's filter must parse back to exactly that set
    // (the list page matches on the mapped status, where raw `pending` is `pending_approval`).
    const indentsHref = screen.getByText("Pending Indents").closest("a")!.getAttribute("href")!;
    const indentsUrl = new URL(indentsHref, "http://localhost");
    expect(indentsUrl.pathname).toBe("/procurement/indents");
    expect(parseIndentStatusFilter(indentsUrl.searchParams.get("status") ?? undefined)).toEqual([...PENDING_INDENT_STATUSES]);

    // Active POs counts status=approved: the orders page must accept that value as a real status.
    const ordersHref = screen.getByText("Active POs").closest("a")!.getAttribute("href")!;
    const ordersUrl = new URL(ordersHref, "http://localhost");
    expect(ordersUrl.pathname).toBe("/procurement/orders");
    expect(parsePoStatusParam(ordersUrl.searchParams.get("status") ?? undefined)).toBe(ACTIVE_PO_STATUS);

    // Contract Renewals opens the contracts register directly: /procurement/contracts only
    // redirects there and drops any query string, so no filter is promised that is then lost.
    const renewalsHref = screen.getByText("Contract Renewals Due").closest("a")!.getAttribute("href")!;
    expect(renewalsHref).toBe("/contracts/list");
    expect(renewalsHref).not.toContain("?");
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

  it("GAP-PROCUREMENT-DASHBOARD-05: a null contractRenewalsDue renders a dash and an honest note, never a false zero", async () => {
    mockProcurementLoader({
      data: { pendingIndents: 5, activePOs: 18, grnsThisMonth: 9, contractRenewalsDue: null },
      source: "api",
    });
    render(await ProcurementDashboardPage());
    const card = screen.getByText("Contract Renewals Due").closest(".stat");
    expect(card).toHaveTextContent("—");
    expect(card).not.toHaveTextContent("0");
    expect(screen.getByRole("note")).toHaveTextContent(/contract service/i);
  });

  it("GAP-PROCUREMENT-DASHBOARD-05: a real renewals count is shown and the GRN card labels its window", async () => {
    mockProcurementLoader({ data: MOCK_DASHBOARD, source: "api" });
    render(await ProcurementDashboardPage());
    expect(screen.getByText("Contract Renewals Due").closest(".stat")).toHaveTextContent("2");
    expect(screen.queryByRole("note")).toBeNull();
    expect(screen.getByText("GRNs (MTD)").closest(".stat")).toHaveAttribute("title", expect.stringMatching(/accepted/i));
  });
});
