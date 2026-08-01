import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import ReceiptsPage from "./page";

const assesseesPage = {
  data: [{ id: "a1", ownerName: "Ravi Kumar", identifierNo: "P-001", assesseeType: "property" }],
  source: "api" as const,
};

describe("ReceiptsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("prompts to choose an assessee when none is selected", async () => {
    fetchJsonMock.mockResolvedValueOnce(assesseesPage);

    const ui = await ReceiptsPage({ searchParams: {} });
    render(ui);

    expect(screen.getByText("Choose an assessee")).toBeInTheDocument();
  });

  it("renders receipts for the selected assessee", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({
        data: [{ id: "d1", financialYear: "2025-2026", netMinor: "500000", status: "raised" }],
        source: "api",
      })
      .mockResolvedValueOnce({
        data: [
          {
            id: "r1",
            receiptNo: "RCPT-0001",
            demandId: "d1",
            amountMinor: "500000",
            channel: "online",
            reference: "UTR123",
            status: "captured",
            createdAt: "2026-04-01T10:00:00.000Z",
          },
        ],
        source: "api",
      });

    const ui = await ReceiptsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("RCPT-0001")).toBeInTheDocument();
  });

  it("renders an empty state when there are no receipts", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await ReceiptsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByText("No receipts recorded")).toBeInTheDocument();
  });

  it("shows the data-source badge when a loader falls back on error", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await ReceiptsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getAllByText("Showing saved information").length).toBeGreaterThan(0);
  });
});
