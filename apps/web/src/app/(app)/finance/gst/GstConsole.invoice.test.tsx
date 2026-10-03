import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
import { GstConsole, invoiceHref } from "./GstConsole";

const row = (over: Record<string, unknown>) => ({
  id: "1", invoice_id: "bill-1", invoice_no: "INV-001", invoice_date: "2026-06-05", party_gstin: "27AAAAA0000A1Z5", party_name: "Vendor Co",
  gst_type: "CGST", direction: "input", taxable_minor: 10000, tax_minor: 900, rate_pct: 9, hsn_code: "9954", period: "2026-06", status: "posted", created_at: "2026-06-05T00:00:00Z", ...over,
});

describe("GST ledger invoice link (GAP-FINANCE-GST-05)", () => {
  it("links only when the server confirmed the invoice id is a real bill", () => {
    expect(invoiceHref({ invoice_id: "bill-1", invoice_is_bill: true })).toBe("/finance/expenditure/bills/bill-1");
    expect(invoiceHref({ invoice_id: "bill-1", invoice_is_bill: false })).toBeNull();
    expect(invoiceHref({ invoice_id: "bill-1" })).toBeNull();
    expect(invoiceHref({ invoice_id: "", invoice_is_bill: true })).toBeNull();
  });

  it("renders the invoice number as a link to the bill, and as plain text when there is no source bill", () => {
    render(<GstConsole period="2026-06" summary={[]} itc={[]} ledger={[row({ invoice_is_bill: true }), row({ id: "2", invoice_no: "INV-002", invoice_id: "x", invoice_is_bill: false })]} />);
    fireEvent.click(screen.getByText("GST Ledger"));
    expect(screen.getByText("INV-001").closest("a")?.getAttribute("href")).toBe("/finance/expenditure/bills/bill-1");
    expect(screen.getByText("INV-002").closest("a")).toBeNull();
  });
});
