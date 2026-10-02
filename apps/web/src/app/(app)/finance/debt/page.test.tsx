import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getDebt = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceDebt: () => getDebt() }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => ({ subtitle: "Loan and debt instruments by source.", title: "Debt Management" } as Record<string, string>)[key] ?? key,
}));
vi.mock("./DebtTable", () => ({ DebtTable: () => <div>debt-table</div> }));

import DebtPage from "./page";

describe("DebtPage (GAP-FINANCE-DEBT-01)", () => {
  beforeEach(() => getDebt.mockReset());
  it("subtitle names only what the screen shows: no EMI or lender-wise promise", async () => {
    getDebt.mockResolvedValue({ data: [], source: "api" });
    const { container } = render(await DebtPage());
    expect(screen.getByText("Loan and debt instruments by source.")).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/EMI|lender/i);
  });
});
