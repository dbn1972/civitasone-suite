import { describe, it, expect } from "vitest";
import { render, screen, within } from "@/test-utils/intl-render";
import { InvoiceList, type InvoiceRow } from "./InvoiceList";

const ROW: InvoiceRow = {
  id: "11111111-1111-4111-8111-111111111111",
  invoiceNumber: "INV-202609-11111111",
  periodMonth: "2026-09",
  status: "issued",
  totalMinor: "11800",
  supplierGstin: "07AAACN1234A1Z5",
  recipientGstin: "07AABCD5678B1Z2",
  placeOfSupply: "07",
  cgstMinor: "900",
  sgstMinor: "900",
  igstMinor: "0",
};

describe("InvoiceList - GAP-TENANT-ADMIN-PLANS-04 / owner decision #26 GST columns", () => {
  it("shows invoice number, supplier + recipient GSTIN, place of supply and the CGST/SGST/IGST split in INR", () => {
    render(<InvoiceList invoices={[ROW]} />);
    const table = screen.getByRole("table", { name: /invoices/i });
    const row = within(table).getAllByRole("row")[1]!;
    expect(row.textContent).toContain("INV-202609-11111111");
    expect(row.textContent).toContain("07AAACN1234A1Z5");
    expect(row.textContent).toContain("07AABCD5678B1Z2");
    expect(row.textContent).toContain("07");
    expect(row.textContent).toContain("₹9.00"); // CGST and SGST
    expect(row.textContent).toContain("₹0.00"); // IGST
    expect(row.textContent).toContain("₹118.00"); // total
    for (const h of ["Invoice no.", "Supplier GSTIN", "Recipient GSTIN", "Place of supply", "CGST", "SGST", "IGST"]) {
      expect(within(table).getByRole("columnheader", { name: h })).toBeInTheDocument();
    }
  });

  it("a legacy invoice with no GST detail shows a dash, never a made-up value", () => {
    render(<InvoiceList invoices={[{ ...ROW, supplierGstin: null, recipientGstin: null, placeOfSupply: null, cgstMinor: "0", sgstMinor: "0", igstMinor: "0" }]} />);
    const row = within(screen.getByRole("table")).getAllByRole("row")[1]!;
    expect(row.textContent).not.toContain("07AAACN");
    expect(row.textContent).toContain("—");
  });

  it("an empty list is an empty state, not a blank table", () => {
    render(<InvoiceList invoices={[]} />);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByText(/no invoices yet/i)).toBeInTheDocument();
  });
});
