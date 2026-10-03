import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSanctions = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceSanctions: () => getSanctions() }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const sessionRoles = vi.fn<() => string[]>(() => ["finance_officer"]);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => sessionRoles() }));

import SanctionsPage from "./page";

describe("SanctionsPage (GAP-FINANCE-BUDGET-SANCTIONS-01/-02)", () => {
  beforeEach(() => getSanctions.mockReset());

  it("failed fetch: — cards + retry state, no ₹0.00 or zero counts", async () => {
    getSanctions.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await SanctionsPage());
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load the sanctions because of a problem on our side.")).toBeInTheDocument();
  });

  it("healthy empty list: zeros, no error", async () => {
    getSanctions.mockResolvedValue({ data: [], source: "api" });
    render(await SanctionsPage());
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
    expect(screen.queryByText(/We couldn't load/)).not.toBeInTheDocument();
  });

  it("+ New Sanction links to the real form", async () => {
    getSanctions.mockResolvedValue({ data: [], source: "api" });
    render(await SanctionsPage());
    expect(screen.getByRole("link", { name: "+ New Sanction" })).toHaveAttribute("href", "/finance/budget/sanctions/new");
  });
});

const sanction = (id: string, status: string, amount: string) => ({
  id, sanctionNo: `S-${id}`, subject: `Subj ${id}`, amount, sanctionedBy: "Officer", date: "2026-04-01", status, majorHead: "2202",
});

// GAP-FINANCE-BUDGET-SANCTIONS-03/-05
describe("SanctionsPage headline numbers and vocabulary", () => {
  beforeEach(() => { getSanctions.mockReset(); sessionRoles.mockReturnValue(["finance_officer"]); });
  const card = (label: string) => screen.getAllByText(label).find((e) => !e.closest("table") && e.className !== "pill")!.parentElement!.textContent ?? "";

  it("Sanctioned value counts approved money only (approved 100, pending 50, rejected 25 -> ₹1.00)", async () => {
    getSanctions.mockResolvedValue({
      data: [sanction("a", "approved", "100"), sanction("b", "pending", "50"), sanction("c", "rejected", "25")], source: "api",
    });
    render(await SanctionsPage());
    expect(card("Sanctioned Value (approved)")).toContain("₹1.00");
    expect(screen.queryByText("Sanctioned (FY)")).not.toBeInTheDocument(); // no FY filter exists
    expect(card("Active Sanctions")).toContain("2"); // rejected excluded
  });

  it("tab, card and pill use the same word: Approved", async () => {
    getSanctions.mockResolvedValue({ data: [sanction("a", "approved", "100")], source: "api" });
    render(await SanctionsPage());
    expect(screen.queryByText("Sanctioned")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Approved" })).toBeInTheDocument(); // tab
    expect(screen.getAllByText("Approved").length).toBeGreaterThanOrEqual(3); // tab + card + pill
  });
});

// GAP-FINANCE-BUDGET-SANCTIONS-04
describe("SanctionsPage create-button gating", () => {
  beforeEach(() => getSanctions.mockReset().mockResolvedValue({ data: [], source: "api" }));
  it("hides + New Sanction for a read-only budget role (the API would 403 it)", async () => {
    sessionRoles.mockReturnValue(["audit_officer"]);
    render(await SanctionsPage());
    expect(screen.queryByRole("link", { name: "+ New Sanction" })).not.toBeInTheDocument();
  });
  it("hides it when roles are unknown (deny by default)", async () => {
    sessionRoles.mockReturnValue([]);
    render(await SanctionsPage());
    expect(screen.queryByRole("link", { name: "+ New Sanction" })).not.toBeInTheDocument();
  });
  it("shows it to finance roles", async () => {
    for (const roles of [["finance_officer"], ["finance_admin"], ["super_admin"]]) {
      sessionRoles.mockReturnValue(roles);
      const { unmount } = render(await SanctionsPage());
      expect(screen.getByRole("link", { name: "+ New Sanction" })).toBeInTheDocument();
      unmount();
    }
  });
});

