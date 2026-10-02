import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import { BillsTable } from "./BillsTable";

const bill = (poRef?: string | null) => ({
  id: "b1", billNo: "BILL-1", vendor: "Acme", poRef, amount: "100000", submittedDate: "2026-04-01",
  threeWayMatch: "matched", status: "pending",
});

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
