import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import BillingInvoicesPage from "./page";

describe("BillingInvoicesPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders a list of invoices", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        {
          id: "inv-1",
          periodMonth: "2026-07",
          status: "issued",
          totalMinor: "500000",
          paidMinor: "0",
          outstandingMinor: "500000",
          currency: "INR",
          issuedAt: "2026-07-01",
          paidAt: null,
          cancelledAt: null,
        },
      ],
      source: "api",
    });

    const ui = await BillingInvoicesPage();
    render(ui);

    expect(screen.getByText("inv-1")).toBeInTheDocument();
    expect(screen.getByText("2026-07")).toBeInTheDocument();
  });

  it("renders the empty state when there are no invoices", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "api" });

    const ui = await BillingInvoicesPage();
    render(ui);

    expect(screen.getByText("No invoices yet")).toBeInTheDocument();
  });

  it("shows the data-source badge when the loader falls back on error", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });

    const ui = await BillingInvoicesPage();
    render(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
