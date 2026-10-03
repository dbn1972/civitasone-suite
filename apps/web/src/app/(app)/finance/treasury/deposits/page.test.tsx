import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceDeposits = vi.hoisted(() => vi.fn());
vi.mock("@/app/_data/loaders", () => ({ getFinanceDeposits: (...a: unknown[]) => getFinanceDeposits(...a) }));
vi.mock("./DepositsTable", () => ({ DepositsTable: () => <div>deposits-table</div> }));

import DepositsPage from "./page";

const dep = (status: string, balanceMinor: string) => ({
  id: status + balanceMinor, pdNo: "PD1", type: "pd", administrator: "A", balanceMinor, currency: "INR", status,
  createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", version: 1,
});

describe("DepositsPage (GAP-FINANCE-TREASURY-DEPOSITS-01 / -02 / -05)", () => {
  it("titles and describes what the register actually holds (not 'Fixed Deposits with maturity tracking')", async () => {
    getFinanceDeposits.mockResolvedValue({ data: [], source: "api" });
    render(await DepositsPage());
    expect(screen.getByRole("heading", { name: "Deposits Register" })).toBeInTheDocument();
    expect(screen.queryByText(/maturity tracking/i)).not.toBeInTheDocument();
  });

  it("shows the active-only balance (100 + 250 paise = ₹3.50) and Refunded / Forfeited cards that sum to the total", async () => {
    getFinanceDeposits.mockResolvedValue({
      data: [dep("active", "100"), dep("active", "250"), dep("refunded", "99900"), dep("forfeited", "500")],
      source: "api",
    });
    render(await DepositsPage());
    expect(screen.getByText("₹3.50")).toBeInTheDocument();
    expect(screen.getByText("Refunded").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Forfeited").closest(".stat")).toHaveTextContent("1");
    expect(screen.getByText("Total Deposits").closest(".stat")).toHaveTextContent("4");
    expect(screen.queryByText("Closed")).not.toBeInTheDocument();
    expect(screen.queryByText("Matured")).not.toBeInTheDocument();
  });

  it("does not show zeros as real figures when the load failed", async () => {
    getFinanceDeposits.mockResolvedValue({ data: [], source: "error" });
    render(await DepositsPage());
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });
});
