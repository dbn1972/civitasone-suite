import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { StatementsTable } from "./StatementsTable";

function seed(data: unknown) {
  vi.mocked(useSeededResource).mockReturnValue({
    data: data as never, fromCache: false, offline: false, cachedAt: null, provenance: "live",
  } as never);
}
const ROW = (o: Record<string, unknown>) => ({
  id: "r", head: "Cash", type: "asset", openingBalance: 0, receipts: 0, payments: 0, closingBalance: -1000, ...o,
});

describe("StatementsTable invalid figures (GAP-FINANCE-ACCOUNTING-FINANCIAL-STATEMENTS-03)", () => {
  beforeEach(() => vi.mocked(useSeededResource).mockReset());

  it("shows a dash and a data-error notice, never a fabricated 0", () => {
    seed([ROW({ receipts: "1e5", payments: null }), ROW({ id: "r2", head: "Bank", closingBalance: 5 })]);
    render(<StatementsTable statements={[]} source="api" />);
    expect(screen.getByRole("alert")).toHaveTextContent(/Data error: 2 figures/);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("a clean ledger shows no data-error notice", () => {
    seed([ROW({})]);
    render(<StatementsTable statements={[]} source="api" />);
    expect(screen.queryByText(/Data error/)).not.toBeInTheDocument();
  });
});
