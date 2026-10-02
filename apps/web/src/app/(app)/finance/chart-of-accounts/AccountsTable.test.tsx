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
import { AccountsTable } from "./AccountsTable";

describe("AccountsTable (GAP-FINANCE-CHART-OF-ACCOUNTS-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("failed load with no cache shows retry and NO 'Add your first head' CTA", () => {
    seed([], "error-no-data");
    render(<AccountsTable accounts={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText(/No accounts set up yet/)).not.toBeInTheDocument();
    expect(screen.queryByText("+ Add Head")).not.toBeInTheDocument();
  });

  it("a genuinely empty live chart still shows the first-run CTA", () => {
    seed([], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText(/No accounts set up yet/)).toBeInTheDocument();
  });
});

// ── GAP-FINANCE-CHART-OF-ACCOUNTS-02/-03/-04 ───────────────────────────────
import { fireEvent } from "@testing-library/react";

const ROW = (i: number, type: "asset" | "liability" | "equity" | "income" | "expense", balanceDisplay = "0.00") => ({
  id: `h${i}`, code: String(1000 + i), name: `Head ${i}`, type, currency: "INR", balanceDisplay, status: "active" as const,
});

describe("AccountsTable stat cards, equity filter, balance sign, paging", () => {
  beforeEach(() => mockedHook.mockReset());

  it("Income / Expense counts only income+expense; equity has its own card (2 asset, 1 equity, 3 income)", () => {
    seed([ROW(1, "asset"), ROW(2, "asset"), ROW(3, "equity"), ROW(4, "income"), ROW(5, "income"), ROW(6, "income")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Income / Expense").closest(".stat")).toHaveTextContent("3");
    expect(screen.getByText("Asset / Liability").closest(".stat")).toHaveTextContent("2");
    expect(screen.getByText("Equity", { selector: ".lab" }).closest(".stat")).toHaveTextContent("1");
  });

  it("the Equity segment shows equity heads", () => {
    seed([ROW(1, "asset"), ROW(3, "equity")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Head 1")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Equity" }));
    expect(screen.queryByText("Head 1")).not.toBeInTheDocument();
    expect(screen.getByText("Head 3")).toBeInTheDocument();
  });

  it("a negative balance puts the sign before the rupee symbol", () => {
    seed([ROW(1, "asset", "-12,345.67")], "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("-₹12,345.67")).toBeInTheDocument();
    expect(screen.queryByText("₹-12,345.67")).not.toBeInTheDocument();
  });

  it("500 rows render 20 per page with a pager and a CSV export", () => {
    seed(Array.from({ length: 500 }, (_, i) => ROW(i, "asset")), "live");
    render(<AccountsTable accounts={[]} source="api" />);
    expect(screen.getByText("Head 0")).toBeInTheDocument();
    expect(screen.queryByText("Head 20")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /csv/i })).toBeInTheDocument();
    expect(screen.getByText(/Page 1 of 25/)).toBeInTheDocument();
  });
});
