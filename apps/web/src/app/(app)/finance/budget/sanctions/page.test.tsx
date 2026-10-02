import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getSanctions = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getFinanceSanctions: () => getSanctions() }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, initial: unknown) => ({ data: initial, fromCache: false, offline: false, cachedAt: null }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import SanctionsPage from "./page";

describe("SanctionsPage (GAP-FINANCE-BUDGET-SANCTIONS-01/-02)", () => {
  beforeEach(() => getSanctions.mockReset());

  it("failed fetch: — cards + retry state, no ₹0.00 or zero counts", async () => {
    getSanctions.mockResolvedValue({ data: [], source: "error", status: 500 });
    render(await SanctionsPage());
    expect(screen.getAllByText("—").length).toBe(4);
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getByText("We couldn't load sanctions.")).toBeInTheDocument();
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
