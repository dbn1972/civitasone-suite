import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getDebt = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceDebt: () => getDebt() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => ({
    subtitle: "Loans and debt instruments by source and lender, with outstanding principal and repayment schedules.",
    title: "Debt Management", newLoan: "+ New loan",
  } as Record<string, string>)[key] ?? key,
}));
vi.mock("./DebtTable", () => ({ DebtTable: () => <div>debt-table</div> }));

import DebtPage from "./page";

describe("DebtPage (GAP-FINANCE-DEBT-01)", () => {
  beforeEach(() => getDebt.mockReset());
  it("subtitle promises exactly what the screen now shows (lender, outstanding, schedules) and links to the new-loan form", async () => {
    getDebt.mockResolvedValue({ data: [], source: "api" });
    render(await DebtPage());
    expect(screen.getByText(/by source and lender, with outstanding principal and repayment schedules/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "+ New loan" })).toHaveAttribute("href", "/finance/debt/new");
  });
});
