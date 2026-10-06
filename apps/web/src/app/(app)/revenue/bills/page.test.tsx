import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BillsPage from "./page";

const assesseesPage = {
  data: [{ id: "a1", ownerName: "Ravi Kumar", identifierNo: "P-001", assesseeType: "property" }],
  source: "api" as const,
};

describe("BillsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts to choose an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage);

    const ui = await BillsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders demands and bills for the selected assessee", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({
        data: [
          {
            id: "d1",
            assessmentId: "asmt-1",
            financialYear: "2025-2026",
            dueDate: "2026-03-31",
            principalMinor: "500000",
            rebateMinor: "0",
            penaltyMinor: "0",
            interestMinor: "0",
            netMinor: "500000",
            status: "raised",
          },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "b1",
            billNo: "BILL-0001",
            billDate: "2026-04-01",
            dueDate: "2026-04-30",
            totalMinor: "500000",
            status: "issued",
          },
        ],
        source: "api",
      });

    const ui = await BillsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("2025-2026")).toBeInTheDocument();
    expect(screen.getByText("BILL-0001")).toBeInTheDocument();
  });

  it("renders empty states when there are no demands or bills", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await BillsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("No demands raised")).toBeInTheDocument();
    expect(screen.getByText("No bills issued")).toBeInTheDocument();
  });

  it("renders a retry state and hides Generate Bill when a loader fails (GAP-REVENUE-BILLS-02)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await BillsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    // A real retry affordance replaces the stats/tables, not a silent "0".
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    // Generate Bill must not render against an unknown demand list.
    expect(screen.queryByText("Generate Bill")).not.toBeInTheDocument();
    // The misleading all-zero stats must not appear.
    expect(screen.queryByText("Outstanding Demands")).not.toBeInTheDocument();
  });

  it("renders '—' for a demand with a missing status (GAP-REVENUE-BILLS-03)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({
        data: [
          {
            id: "d1",
            assessmentId: "asmt-1",
            financialYear: "2030-2031",
            dueDate: "2031-03-31",
            principalMinor: "500000",
            rebateMinor: "0",
            penaltyMinor: "0",
            interestMinor: "0",
            netMinor: "500000",
            // no status field
          },
        ],
        source: "api",
      })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await BillsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    // The raw lowercase "unknown" string must never be shown.
    expect(screen.queryByText("unknown")).not.toBeInTheDocument();
    expect(screen.getByText("2030-2031")).toBeInTheDocument();
  });

  it("humanizes the assessee type in the picker option (GAP-REVENUE-BILLS-04)", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [{ id: "a1", ownerName: "Sharma", identifierNo: "PT-1023", assesseeType: "residential" }],
      source: "api" as const,
    });

    const ui = await BillsPage({ searchParams: {} });
    render(ui);

    const option = screen.getByRole("option", { name: /Sharma — PT-1023 \(Residential\)/ });
    expect(option).toBeInTheDocument();
    // The raw lowercase enum must not be shown.
    expect(screen.queryByRole("option", { name: /\(residential\)/ })).not.toBeInTheDocument();
  });
});
