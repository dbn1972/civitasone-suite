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

// The feed is MINOR units (paise) as integer strings: "100000" = Rs 1,000.00.
const ROWS = [
  { id: "a", head: "Cash", type: "asset", openingBalance: "0", receipts: "0", payments: "100000", closingBalance: "-100000" },
  { id: "l", head: "Creditors", type: "liability", openingBalance: "0", receipts: "70000", payments: "0", closingBalance: "70000" },
  { id: "i", head: "Fees", type: "income", openingBalance: "0", receipts: "50000", payments: "0", closingBalance: "50000" },
  { id: "e", head: "Rent", type: "expenditure", openingBalance: "0", receipts: "0", payments: "20000", closingBalance: "-20000" },
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

  // The feed is paise strings; the cells hand them to formatMoney unchanged
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
    expect(screen.getByLabelText("Credits ₹500.00")).toBeInTheDocument();
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
    seed(ROWS.map((r) => (r.id === "l" ? { ...r, closingBalance: "60000" } : r)), "live");
    render(<StatementsTable statements={ROWS as never} />);
    fireEvent.click(screen.getAllByRole("tab", { name: "Balance Sheet" })[1]!);
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
  });

  // GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03
  it("an amount above 2^53 paise is shown exactly, not rounded through a double", () => {
    const big = [{ id: "i", head: "Grant", type: "income", openingBalance: "0", receipts: "9007199254740993", payments: "0", closingBalance: "9007199254740993" }];
    seed(big, "live");
    render(<StatementsTable statements={big as never} />);
    // every one of the 16 paise digits survives (a double would print ...992 or ...994)
    const cell = screen.getAllByLabelText(/^Credits ₹/)[0]!;
    expect(cell.getAttribute("aria-label")!.replace(/\D/g, "")).toBe("9007199254740993");
  });

  // UAT Phase 1B (recon D11): UUID heads, credits shown as "receipts" for cash heads, and
  // closing balances negative for every debit-balance head.
  it("shows head code · name (never the UUID), Debits/Credits columns and Dr/Cr closing balances", () => {
    const UUID = "75736d77-f140-4a00-97ac-be4878934248";
    const rows = [{ id: UUID, head: UUID, type: "asset", openingBalance: "0", receipts: "250000", payments: "500000", closingBalance: "-250000" }];
    seed(rows, "live");
    const { container } = render(<StatementsTable statements={rows as never} heads={{ [UUID]: { code: "1100", name: "Bank" } }} />);
    expect(screen.getByText("1100 · Bank")).toBeInTheDocument();
    expect(container.textContent).not.toContain(UUID);
    // Bank: Rs 5,000 debited (money in), Rs 2,500 credited (money out) -> Rs 2,500 debit balance.
    expect(screen.getByLabelText("Debits ₹5,000.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Credits ₹2,500.00")).toBeInTheDocument();
    expect(screen.getByLabelText("Closing ₹2,500.00 Dr")).toBeInTheDocument();
    expect(screen.queryByText("Receipts")).not.toBeInTheDocument();
  });

  it("a credit-balance head reads Cr and an unknown UUID head reads 'Unknown head'", () => {
    const rows = [{ id: "x", head: "c0f46ca3-0339-422e-842f-8d0eb882b378", type: "liability", openingBalance: "0", receipts: "70000", payments: "0", closingBalance: "70000" }];
    seed(rows, "live");
    render(<StatementsTable statements={rows as never} />);
    expect(screen.getByText("Unknown head")).toBeInTheDocument();
    expect(screen.getByLabelText("Closing ₹700.00 Cr")).toBeInTheDocument();
  });
});

