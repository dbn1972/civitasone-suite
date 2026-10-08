import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceDeposits = vi.hoisted(() => vi.fn());
const getFinanceDepositsSummary = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/loaders", () => ({
  getFinanceDeposits: (...a: unknown[]) => getFinanceDeposits(...a),
  getFinanceDepositsSummary: (...a: unknown[]) => getFinanceDepositsSummary(...a),
}));
vi.mock("./DepositsTable", () => ({ DepositsTable: () => <div>deposits-table</div> }));

import DepositsPage from "./page";

const dep = (status: string, balanceMinor: string) => ({
  id: status + balanceMinor, pdNo: "PD1", type: "pd", administrator: "A", balanceMinor, currency: "INR", status,
  createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", version: 1,
});
const summary = (over: Partial<{ total: number; active: number; refunded: number; forfeited: number; activeBalanceMinor: string }> = {}) =>
  ({ data: { total: 0, active: 0, refunded: 0, forfeited: 0, activeBalanceMinor: "0", ...over }, source: "api" as const });

describe("DepositsPage (GAP-FINANCE-TREASURY-DEPOSITS-01 / -02 / -05)", () => {
  it("titles and describes what the register actually holds (not 'Fixed Deposits with maturity tracking')", async () => {
    getFinanceDeposits.mockResolvedValue({ data: [], source: "api" });
    getFinanceDepositsSummary.mockResolvedValue(summary());
    render(await DepositsPage());
    expect(screen.getByRole("heading", { name: "Deposits Register" })).toBeInTheDocument();
    expect(screen.queryByText(/maturity tracking/i)).not.toBeInTheDocument();
  });

  // GAP2-FINANCE-TREASURY-DEPOSITS-TOTALS-06: cards come from the server-side
  // aggregate (active-only balance ₹3.50; counts over ALL deposits), not a page.
  it("shows the active-only balance (₹3.50) and Refunded / Forfeited cards that sum to the total", async () => {
    getFinanceDeposits.mockResolvedValue({
      data: [dep("active", "100"), dep("active", "250"), dep("refunded", "99900"), dep("forfeited", "500")],
      source: "api",
    });
    getFinanceDepositsSummary.mockResolvedValue(summary({ total: 4, active: 2, refunded: 1, forfeited: 1, activeBalanceMinor: "350" }));
    render(await DepositsPage());
    expect(screen.getByText("₹3.50")).toBeInTheDocument();
    expect(screen.getByText("Refunded").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Forfeited").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Total Deposits").closest(".stat")).toHaveTextContent("4");
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
    expect(screen.queryByText("Matured")).not.toBeInTheDocument();
  });

  it("does not show zeros as real figures when the summary load failed", async () => {
    getFinanceDeposits.mockResolvedValue({ data: [], source: "api" });
    getFinanceDepositsSummary.mockResolvedValue({ ...summary(), source: "error" });
    render(await DepositsPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });
});
