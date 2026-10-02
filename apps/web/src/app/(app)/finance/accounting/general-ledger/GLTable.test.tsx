import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
import { GLTable } from "./GLTable";

const ENTRY = (over: Record<string, unknown> = {}) => ({
  id: "j1:1", voucherNo: "JV-1", date: "2026-06-01", accountCode: "1000", accountName: "Cash",
  narration: null, referenceNo: null, type: "journal", debit: "50000", credit: "0", ...over,
});

describe("GLTable (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-01)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("failed load with no cache shows a retry state, never zeros or 'Balanced'", () => {
    seed([], "error-no-data");
    render(<GLTable entries={[]} source="error" />);
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
    expect(screen.queryByText("Unbalanced")).not.toBeInTheDocument();
    expect(screen.queryByText("No entries for this filter")).not.toBeInTheDocument();
    expect(screen.queryByText("Ledger Total Debit")).not.toBeInTheDocument();
  });

  it("an empty live ledger is 'no entries', not 'Balanced'", () => {
    seed([], "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.queryByText("Balanced")).not.toBeInTheDocument();
    expect(screen.getByText("Ledger Total Debit")).toBeInTheDocument();
  });

  it("loaded data with debit != credit shows 'Unbalanced'", () => {
    seed([ENTRY(), ENTRY({ id: "j1:2", accountCode: "2000", debit: "0", credit: "30000" })], "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.getByText("Unbalanced")).toBeInTheDocument();
  });

  it("loaded data with debit == credit shows 'Balanced'", () => {
    seed([ENTRY(), ENTRY({ id: "j1:2", accountCode: "2000", debit: "0", credit: "50000" })], "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.getByText("Balanced")).toBeInTheDocument();
  });
});

describe("GLTable totals labelling (GAP-FINANCE-ACCOUNTING-GENERAL-LEDGER-02/03/04)", () => {
  const two = () => [
    ENTRY(),
    ENTRY({ id: "j1:2", accountCode: "2000", debit: "0", credit: "50000" }),
    ENTRY({ id: "j2:1", voucherNo: "PV-1", type: "payment", debit: "7000", credit: "0" }),
  ];

  it("counts vouchers (journals), not lines, and shows the line count separately", () => {
    seed(two(), "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.getByText("Vouchers").parentElement).toHaveTextContent("2");
    expect(screen.getByText("Entry lines").parentElement).toHaveTextContent("3");
  });

  it("footer says 'Filtered total' only when a tab or search is active; cards stay ledger-wide", () => {
    seed(two(), "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.queryByText(/Filtered total/)).not.toBeInTheDocument();
    expect(screen.getByText(/^Total \(3 entries\)/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search general ledger"), { target: { value: "PV-1" } });
    expect(screen.getByText(/Filtered total \(1 of 3 entries\)/)).toBeInTheDocument();
    expect(screen.getByText("Ledger Total Debit")).toBeInTheDocument();
  });

  it("warns when the loaded ledger hit the journal limit", () => {
    const many = Array.from({ length: 500 }, (_, i) => ENTRY({ id: `j${i}:1` }));
    seed(many, "live");
    render(<GLTable entries={[]} source="api" />);
    expect(screen.getByRole("status")).toHaveTextContent(/first 500 vouchers/);
  });
});
