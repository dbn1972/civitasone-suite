import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}
import { StatementsTable } from "./StatementsTable";
import { fireEvent } from "@testing-library/react";

const ROWS = [
  { id: "a", head: "Cash", type: "asset", openingBalance: 0, receipts: 0, payments: 1000, closingBalance: -1000 },
  { id: "l", head: "Creditors", type: "liability", openingBalance: 0, receipts: 700, payments: 0, closingBalance: 700 },
  { id: "i", head: "Fees", type: "income", openingBalance: 0, receipts: 500, payments: 0, closingBalance: 500 },
  { id: "e", head: "Rent", type: "expenditure", openingBalance: 0, receipts: 0, payments: 200, closingBalance: -200 },
];

describe("StatementsTable", () => {
  beforeEach(() => mockedHook.mockReset());

  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-01
  it("failed load with no cache shows a retry state and no Rs 0.00", () => {
    seed([], "error-no-data");
    const { container } = render(<StatementsTable statements={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(container.textContent).not.toContain("₹0.00");
    expect(screen.queryByText("No data for this statement type")).not.toBeInTheDocument();
  });

  // The feed is rupee floats; table cells must convert to paise before formatMoney
  // (the old code showed 100x too small: Rs 500 as Rs 5.00).
  it("row cells show the true rupee amounts, matching the totals", () => {
    seed(ROWS, "live");
    render(<StatementsTable statements={ROWS as never} />);
    fireEvent.click(screen.getByRole("tab", { name: "I&E" }));
    const fees = screen.getByText("Fees").closest("tr")!;
    expect(fees.textContent).toContain("₹500.00");
    expect(fees.textContent).not.toContain("₹5.00");
    const rent = screen.getByText("Rent").closest("tr")!;
    expect(rent.textContent).toContain("₹200.00");
    expect(screen.getByLabelText("Receipts ₹500.00")).toBeInTheDocument();
    expect(screen.getByText("Total Income").closest(".stat")).toHaveTextContent("₹500.00");
  });

  it("states that the figures are cumulative, with no FY claim", () => {
    seed(ROWS, "live");
    const { container } = render(<StatementsTable statements={ROWS as never} />);
    expect(container.textContent).toContain("cumulative, all periods");
    expect(container.textContent).not.toMatch(/FY \d{4}/);
  });

  it("cached data still shows figures with the stale badge", () => {
    seed(ROWS, "cached");
    render(<StatementsTable statements={[]} source="error" />);
    expect(screen.getByText("Cash")).toBeInTheDocument();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-02
  it("I&E shows income, expenditure and surplus (never a cross-class grand total)", () => {
    seed(ROWS, "live");
    render(<StatementsTable statements={ROWS as never} />);
    fireEvent.click(screen.getByRole("tab", { name: "I&E" }));
    expect(screen.getByText("Total Income")).toBeInTheDocument();
    expect(screen.getByText("Total Expenditure")).toBeInTheDocument();
    expect(screen.getAllByText("Surplus").length).toBeGreaterThan(0);
    expect(screen.getByText("₹300.00")).toBeInTheDocument(); // 500 - 200
    expect(screen.queryByText(/Total — Opening/)).not.toBeInTheDocument();
  });

  it("Balance Sheet shows a balanced / unbalanced indicator", () => {
    seed(ROWS, "live");
    render(<StatementsTable statements={ROWS as never} />);
    fireEvent.click(screen.getByRole("tab", { name: "Balance Sheet" }));
    // assets 1000 = liabilities 700 + surplus 300
    expect(screen.getByText("Balanced")).toBeInTheDocument();
    seed(ROWS.map((r) => (r.id === "l" ? { ...r, closingBalance: 600 } : r)), "live");
    render(<StatementsTable statements={ROWS as never} />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Balance Sheet" })[1]!);
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
  });
});
