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

  it("shows the data-source badge when a loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "error" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await BillsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });
});
