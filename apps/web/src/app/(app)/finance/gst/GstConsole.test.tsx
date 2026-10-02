import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { GstConsole } from "./GstConsole";

describe("GstConsole", () => {
  const summary = [
    { gst_type: "CGST", direction: "output" as const, total_taxable: 100000, total_tax: 9000, transaction_count: 3 },
  ];
  const ledger = [
    {
      id: "1", invoice_id: "inv-1", invoice_no: "INV-001", invoice_date: "2026-06-05",
      party_gstin: "27AAAAA0000A1Z5", party_name: "Vendor Co", gst_type: "CGST", direction: "output",
      taxable_minor: 10000000, tax_minor: 900000, rate_pct: 9, hsn_code: "9954", period: "2026-06", status: "posted", created_at: "2026-06-05T00:00:00Z",
    },
  ];
  const itc = [{ gst_type: "CGST", itc_available: 3600, output_liability: 9000, net_payable: 5400 }];

  it("renders the Summary tab by default", () => {
    render(<GstConsole period="2026-06" summary={summary} ledger={ledger} itc={itc} />);
    expect(screen.getByText("CGST")).toBeInTheDocument();
  });

  it("switches to the GST Ledger tab and shows ledger rows", () => {
    render(<GstConsole period="2026-06" summary={summary} ledger={ledger} itc={itc} />);
    fireEvent.click(screen.getByText("GST Ledger"));
    expect(screen.getByText("INV-001")).toBeInTheDocument();
  });

  it("switches to the ITC Reconciliation tab and shows reconciliation rows", () => {
    render(<GstConsole period="2026-06" summary={summary} ledger={ledger} itc={itc} />);
    fireEvent.click(screen.getByText("ITC Reconciliation"));
    expect(screen.getByText("₹54.00")).toBeInTheDocument();
  });

  it("shows an empty state when the ledger has no rows", () => {
    render(<GstConsole period="2026-06" summary={[]} ledger={[]} itc={[]} />);
    expect(screen.getByText("No GST summary for this period")).toBeInTheDocument();
    fireEvent.click(screen.getByText("GST Ledger"));
    expect(screen.getByText("No GST ledger entries for this period")).toBeInTheDocument();
  });
});

// GAP-FINANCE-GST-01: a failed source is not an empty period.
describe("GstConsole failed sources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("an ITC load failure shows a retryable error in the ITC tab, not 'No ITC reconciliation'", () => {
    render(<GstConsole period="2026-06" summary={[]} ledger={[]} itc={[]} errors={{ itc: true }} />);
    fireEvent.click(screen.getByText(/ITC Reconciliation/));
    expect(screen.queryByText("No ITC reconciliation for this period")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("marks only the failed tab with a warning cue", () => {
    render(<GstConsole period="2026-06" summary={[]} ledger={[]} itc={[]} errors={{ ledger: true }} />);
    expect(screen.getByText("GST Ledger ⚠")).toBeInTheDocument();
    expect(screen.getByText("Summary")).toBeInTheDocument();
  });

  it("a genuinely empty period (no errors) still shows the empty states", () => {
    render(<GstConsole period="2026-06" summary={[]} ledger={[]} itc={[]} />);
    expect(screen.getByText("No GST summary for this period")).toBeInTheDocument();
  });
});
