import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GstConsolePage from "./page";

describe("GstConsolePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders GST summary, ledger, and ITC data for the selected period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/summary")) {
        return Promise.resolve({
          data: [
            { gst_type: "CGST", direction: "output", total_taxable: 100000, total_tax: 9000, transaction_count: 3 },
            { gst_type: "CGST", direction: "input", total_taxable: 40000, total_tax: 3600, transaction_count: 2 },
          ],
          source: "api",
        });
      }
      if (path.includes("/itc-reconciliation")) {
        return Promise.resolve({
          data: [{ gst_type: "CGST", itc_available: 3600, output_liability: 9000, net_payable: 5400 }],
          source: "api",
        });
      }
      return Promise.resolve({
        data: [
          {
            id: "1", invoice_id: "inv-1", invoice_no: "INV-001", invoice_date: "2026-06-05",
            party_gstin: "27AAAAA0000A1Z5", party_name: "Vendor Co", gst_type: "CGST", direction: "output",
            taxable_minor: 10000000, tax_minor: 900000, rate_pct: 9, hsn_code: "9954", period: "2026-06", status: "posted", created_at: "2026-06-05T00:00:00Z",
          },
        ],
        source: "api",
      });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("GST / ITC Console")).toBeInTheDocument();
    fireEvent.click(screen.getByText("GST Ledger"));
    expect(screen.getByText("INV-001")).toBeInTheDocument();
  });

  it("renders empty states when there is no GST data for the period", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/summary")) return Promise.resolve({ data: [], source: "api" });
      if (path.includes("/itc-reconciliation")) return Promise.resolve({ data: [], source: "api" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("No GST summary for this period")).toBeInTheDocument();
  });

  it("shows the data-source badge when any GST endpoint errors", async () => {
    fetchJsonMock.mockImplementation((path: string) => {
      if (path.includes("/summary")) return Promise.resolve({ data: [], source: "error" });
      return Promise.resolve({ data: [], source: "api" });
    });

    const ui = await GstConsolePage({ searchParams: { period: "2026-06" } });
    render(ui);
    expect(screen.getByText("Showing saved information")).toBeInTheDocument();
  });
});
