import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { InvoiceDetail, type InvoiceDetailState } from "./InvoiceDetail";
import { mapInvoiceDetail, type AdminInvoiceDetail } from "@/app/_data/loaders";

const inv: AdminInvoiceDetail = {
  id: "5e7e1000-0000-4000-8000-000000000001", periodMonth: "2026-09", status: "issued", currency: "INR",
  totalMinor: "250050", taxMinor: "38145", chargesMinor: "0", paidMinor: "50000", outstandingMinor: "200050",
  issuedAt: "2026-09-30T00:00:00.000Z", paidAt: null, cancelledAt: null, cancelReason: null,
  items: [{ id: "i1", description: "Platform fee", kind: "line", quantity: "1", amountMinor: "211905" }],
  approvals: [{ id: "a1", action: "issue", status: "approved", amountMinor: "250050", decidedAt: "2026-09-30T01:00:00.000Z", reason: "ok to issue" }],
};
const ui = (state: InvoiceDetailState, locale: "en" | "hi" = "en") => (
  <NextIntlClientProvider locale={locale} messages={locale === "hi" ? hiMessages : enMessages}><InvoiceDetail state={state} /></NextIntlClientProvider>
);

// GAP-ADMIN-INVOICES-06
describe("InvoiceDetail", () => {
  it("shows the amounts from paise with lakh grouping, the line items and the approval history", () => {
    render(ui({ kind: "ready", invoice: inv }));
    expect(screen.getByText("Invoice for 2026-09")).toBeInTheDocument();
    expect(screen.getByText("Total", { selector: ".lab" }).parentElement).toHaveTextContent("₹2,500.50");
    expect(screen.getByText("Outstanding", { selector: ".lab" }).parentElement).toHaveTextContent("₹2,000.50");
    expect(screen.getByText("Platform fee")).toBeInTheDocument();
    expect(screen.getByText("ok to issue")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /mark paid|reminder/i })).not.toBeInTheDocument();
  });

  it("prints through the browser", () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {});
    render(ui({ kind: "ready", invoice: inv }));
    fireEvent.click(screen.getByRole("button", { name: "Print or save as PDF" }));
    expect(print).toHaveBeenCalledTimes(1);
  });

  it("a cancelled invoice shows its date and reason; an invoice with no items or approvals says so", () => {
    render(ui({ kind: "ready", invoice: { ...inv, status: "cancelled", cancelledAt: "2026-10-01T00:00:00.000Z", cancelReason: "duplicate bill", items: [], approvals: [] } }));
    expect(screen.getByText(/duplicate bill/)).toBeInTheDocument();
    expect(screen.getByText("No line items")).toBeInTheDocument();
    expect(screen.getByText("No approvals")).toBeInTheDocument();
  });

  it("not found and failed-to-load are different screens", () => {
    const { unmount } = render(ui({ kind: "not-found" }));
    expect(screen.getByText("Invoice not found")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    unmount();
    render(ui({ kind: "error", status: 500 }));
    expect(screen.queryByText("Invoice not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("renders in Hindi", () => {
    render(ui({ kind: "ready", invoice: inv }, "hi"));
    expect(screen.getByText("2026-09 का चालान")).toBeInTheDocument();
  });

  it("mapInvoiceDetail keeps paise as strings and rejects a body that is not an invoice", () => {
    const m = mapInvoiceDetail({ id: "x", periodMonth: "2026-09", status: "paid", totalMinor: "123456789012", outstandingMinor: 0, items: [{ id: "i", description: "d", quantity: "2", amountMinor: "5" }], approvals: [] });
    expect(m).toMatchObject({ totalMinor: "123456789012", outstandingMinor: "0", items: [{ quantity: "2", amountMinor: "5" }] });
    expect(mapInvoiceDetail({})).toBeNull();
    expect(mapInvoiceDetail([])).toBeNull();
  });
});
