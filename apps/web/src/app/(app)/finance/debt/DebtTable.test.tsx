import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";
import { DebtTable, debtSourceLabel, type DebtLabels } from "./DebtTable";

const mockedHook = vi.mocked(useSeededResource);
function seed(data: unknown, provenance: "live" | "cached" | "error-no-data") {
  mockedHook.mockReturnValue({
    data: data as never, fromCache: provenance === "cached", offline: false,
    cachedAt: provenance === "cached" ? "2026-09-01T00:00:00.000Z" : null, provenance,
  } as never);
}

const labels: DebtLabels = {
  totalLoans: "Total Loans", active: "Active", closed: "Closed", totalPrincipal: "Total principal", mixedCurrency: "mixed",
  portfolio: "Loan Portfolio", instrument: "Instrument", source: "Source", principal: "Principal amount",
  maturity: "Maturity", status: "Status", search: "Search loans…", emptyTitle: "No loans",
  emptyMessage: "No loan or debt records found.", loadArea: "the debt register",
  sources: { rbi: "RBI", market: "Market", central_govt: "Central Govt" },
};
const LOAN = (over: Record<string, unknown>) => ({
  id: "d1", instrument: "Term loan", source: "central_govt", amountMinor: "100000", currency: "INR",
  maturity: "2030-03-31", status: "active", createdAt: "", updatedAt: "", version: 1, ...over,
});

describe("DebtTable (GAP-FINANCE-DEBT-02/-03/-04/-05)", () => {
  beforeEach(() => mockedHook.mockReset());

  it("failed load with nothing cached: all four cards read a dash and a retry state shows, never zeros or 'No loans'", () => {
    seed([], "error-no-data");
    render(<DebtTable loans={[]} source="error" errorStatus={500} labels={labels} />);
    for (const label of ["Total Loans", "Active", "Closed", "Total principal"]) {
      expect(screen.getByText(label).closest(".stat")).toHaveTextContent("—");
    }
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    expect(screen.queryByText("No loans")).not.toBeInTheDocument();
  });

  it("a genuinely empty live list shows real zeros", () => {
    seed([], "live");
    render(<DebtTable loans={[]} labels={labels} />);
    expect(screen.getByText("Total Loans").closest(".stat")).toHaveTextContent("0");
    expect(screen.getByText("No loans")).toBeInTheDocument();
  });

  it("formats maturity and source, labels the amount column, and the principal card equals the row sum; no 'Sources' count card", () => {
    seed([LOAN({}), LOAN({ id: "d2", source: "RBI", amountMinor: "250050", status: "closed", maturity: "2028-01-05" })], "live");
    render(<DebtTable loans={[]} labels={labels} />);
    expect(screen.getByText("31 Mar 2030")).toBeInTheDocument();
    expect(screen.getByText("Central Govt")).toBeInTheDocument();
    expect(screen.queryByText("central_govt")).not.toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Principal amount/ })).toBeInTheDocument();
    expect(screen.getByText("Total principal").closest(".stat")).toHaveTextContent("₹3,500.50");
    expect(screen.queryByText("Sources")).not.toBeInTheDocument();
  });

  it("Closed tile is no longer on the amber warning background", () => {
    seed([LOAN({})], "live");
    const { container } = render(<DebtTable loans={[]} labels={labels} />);
    const closedIcon = screen.getByText("Closed").closest(".stat")!.querySelector(".ic") as HTMLElement;
    expect(closedIcon.style.background).toContain("--goodbg");
    expect(container.innerHTML).not.toContain("#fffaeb");
  });
});

describe("debtSourceLabel", () => {
  it("maps known codes, humanises unknown ones, dashes empty", () => {
    expect(debtSourceLabel("central_govt", labels.sources)).toBe("Central Govt");
    expect(debtSourceLabel("MARKET", labels.sources)).toBe("Market");
    expect(debtSourceLabel("world_bank", labels.sources)).toBe("World Bank");
    expect(debtSourceLabel("", labels.sources)).toBe("—");
  });

  it("a non-INR row hides the total (dash) and shows a note (review D4)", () => {
    seed([LOAN({}), LOAN({ id: "d2", currency: "USD" })], "live");
    render(<DebtTable loans={[]} labels={{ ...labels, mixedCurrency: "Total not shown: mixed currencies." }} />);
    expect(screen.getByText("Total principal").closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("Total not shown: mixed currencies.")).toBeInTheDocument();
  });
});
