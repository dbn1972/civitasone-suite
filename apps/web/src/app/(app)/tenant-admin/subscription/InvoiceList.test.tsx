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

describe("InvoiceList - owner decision #27 PDF download", () => {
  it("each downloadable invoice links to its PDF through the authenticated proxy, labelled with the invoice number", () => {
    render(<InvoiceList invoices={[ROW]} pdfBasePath="/api/proxy/v1/billing/invoices" />);
    const link = screen.getByRole("link", { name: "Download invoice INV-202609-11111111 as PDF" });
    expect(link).toHaveAttribute("href", `/api/proxy/v1/billing/invoices/${ROW.id}/pdf`);
    expect(link).toHaveAttribute("download");
  });

  it("a draft or cancelled invoice has no PDF yet, so no dead link is shown", () => {
    render(<InvoiceList invoices={[{ ...ROW, status: "draft" }, { ...ROW, id: "22222222-2222-4222-8222-222222222222", status: "cancelled" }]} pdfBasePath="/api/proxy/v1/billing/invoices" />);
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("without a pdfBasePath no PDF column is rendered", () => {
    render(<InvoiceList invoices={[ROW]} />);
    expect(screen.queryByRole("columnheader", { name: "PDF" })).toBeNull();
  });
});
