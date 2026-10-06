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

  it("renders a retry state (not an all-zero KPI) when receipts fail to load (GAP-REVENUE-RECEIPTS-03)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await ReceiptsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
    // The misleading "₹0.00" Total Collected must not be shown.
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
  });

  it("excludes reversed receipts from Total Collected and humanizes the channel (GAP-REVENUE-RECEIPTS-02/04)", async () => {
    fetchJsonMock
      .mockResolvedValueOnce(assesseesPage)
      .mockResolvedValueOnce({ data: [], source: "api" })
      .mockResolvedValueOnce({
        data: [
          {
            id: "r1",
            receiptNo: "RCPT-0001",
            demandId: "d1",
            amountMinor: "10000",
            channel: "dd",
            reference: "DD-1",
            status: "captured",
            createdAt: "2026-04-01T10:00:00.000Z",
          },
          {
            id: "r2",
            receiptNo: "RCPT-0002",
            demandId: "d1",
            amountMinor: "5000",
            channel: "online",
            reference: "UTR-2",
            status: "reversed",
            createdAt: "2026-04-02T10:00:00.000Z",
          },
        ],
        source: "api",
      });

    const ui = await ReceiptsPage({ searchParams: { assesseeId: "a1" } });
    render(ui);

    // Only the ₹100.00 captured receipt counts, not the ₹50.00 reversed one.
    // ₹100.00 appears in both the amount cell and the Total Collected KPI.
    expect(screen.getAllByText("₹100.00").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("₹150.00")).not.toBeInTheDocument();
    // Channel code "dd" is rendered as its human label (in the row + the select option).
    expect(screen.getAllByText("Demand draft").length).toBeGreaterThanOrEqual(1);
  });
});
