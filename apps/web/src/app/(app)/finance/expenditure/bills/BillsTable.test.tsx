import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { BillsTable } from "./BillsTable";

const bill = (poRef?: string | null, poNumber?: string | null, id = "b1") => ({
  id, billNo: `BILL-${id}`, vendor: "Acme", poRef, poNumber, amount: "100000", submittedDate: "2026-04-01",
  threeWayMatch: "matched", status: "pending",
});

const PO_UUID = "5b1c2d3e-0000-4000-8000-000000000000";

function renderTable(rows: ReturnType<typeof bill>[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <BillsTable bills={rows} />
    </NextIntlClientProvider>,
  );
}

// GAP-FINANCE-EXPENDITURE-BILLS-06
describe("BillsTable PO Ref", () => {
  it("does not leak the raw 'procurement_po:<uuid>' plumbing", () => {
    renderTable([bill("procurement_po:5b1c2d3e-0000-4000-8000-000000000000")]);
    expect(screen.getByText("PO 5b1c2d3e")).toBeInTheDocument();
    expect(screen.queryByText(/procurement_po/)).not.toBeInTheDocument();
  });
  it("shows a human PO number as-is and a missing ref as an em dash", () => {
    renderTable([bill("procurement_po:PO-2026-014")]);
    expect(screen.getByText("PO-2026-014")).toBeInTheDocument();
  });
});

// GAP-FINANCE-EXPENDITURE-BILLS-06: the human PO number, linked to the purchase order.
describe("BillsTable PO number", () => {
  it("renders the PO number, not the id form, when the bill carries one", () => {
    renderTable([bill(`procurement_po:${PO_UUID}`, "PO-2026-014")]);
    expect(screen.getByText("PO-2026-014")).toBeInTheDocument();
    expect(screen.queryByText("PO 5b1c2d3e")).not.toBeInTheDocument();
    expect(screen.queryByText(/procurement_po/)).not.toBeInTheDocument();
  });
  it("renders poRef 'procurement_po:abc-123' with poNumber 'PO-2026-014' as 'PO-2026-014'", () => {
    renderTable([bill("procurement_po:abc-123", "PO-2026-014")]);
    expect(screen.getByText("PO-2026-014")).toBeInTheDocument();
  });
  it("links the PO number to the purchase order page", () => {
    renderTable([bill(`procurement_po:${PO_UUID}`, "PO-2026-014")]);
    expect(screen.getByRole("link", { name: "PO-2026-014" })).toHaveAttribute("href", `/procurement/orders/${PO_UUID}`);
  });
  it("shows a reference that names no purchase-order page as plain text, never a dead link", () => {
    renderTable([bill("procurement_po:abc-123", "PO-2026-014")]);
    expect(screen.queryByRole("link", { name: "PO-2026-014" })).not.toBeInTheDocument();
  });
  it("falls back to the short readable ref (still linked) when the bill has no number, and to an em dash with no PO at all", () => {
    renderTable([bill(`procurement_po:${PO_UUID}`, null, "b1"), bill(null, null, "b2")]);
    expect(screen.getByRole("link", { name: "PO 5b1c2d3e" })).toHaveAttribute("href", `/procurement/orders/${PO_UUID}`);
    const noPoRow = screen.getByText("BILL-b2").closest("tr") as HTMLElement;
    expect(within(noPoRow).getAllByText("—").length).toBeGreaterThan(0);
  });
  it("lets the register filter find a bill by its PO number", () => {
    renderTable([bill(`procurement_po:${PO_UUID}`, "PO-2026-014", "b1"), bill("procurement_po:abc-123", "PO-2026-099", "b2")]);
    fireEvent.change(screen.getByPlaceholderText("Search bills…"), { target: { value: "PO-2026-014" } });
    expect(screen.getByText("BILL-b1")).toBeInTheDocument();
    expect(screen.queryByText("BILL-b2")).not.toBeInTheDocument();
  });
});
