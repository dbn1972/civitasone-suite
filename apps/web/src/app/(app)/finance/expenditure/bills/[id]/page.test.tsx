import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const render = (ui: React.ReactElement) => rtlRender(<ToastProvider>{ui}</ToastProvider>);

const rolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock() }));
const loaderMock = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceBillById: () => loaderMock() }));
vi.mock("./BillLineItemsTable", () => ({ BillLineItemsTable: () => null }));
// Async server component with its own loader + tests (scannedDocuments.test.ts / ScannedDocumentsSection.test.tsx).
vi.mock("../../../_components/scanned/ScannedDocumentsSection", () => ({ ScannedDocumentsSection: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import BillDetailPage from "./page";

const BILL = {
  id: "b1", billNo: "BILL-77", vendor: "Acme Traders", amount: "250000", submittedDate: "2026-04-01",
  dueDate: "2026-05-01", status: "pending", threeWayMatch: "matched", poRef: "procurement_po:5b1c2d3e-0000-4000-8000-000000000000",
  grnRef: undefined, invoiceNo: "INV-9", paymentRef: undefined, lineItems: [],
};

describe("BillDetailPage", () => {
  beforeEach(() => {
    rolesMock.mockReset();
    loaderMock.mockResolvedValue({ data: BILL, source: "api" });
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-05: AppShell already renders the breadcrumb.
  it("renders no hand-rolled breadcrumb of its own", async () => {
    rolesMock.mockReturnValue(["accounts_officer"]);
    const { container } = render(await BillDetailPage({ params: { id: "b1" } }));
    expect(container.querySelector("nav.crumbs")).toBeNull();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-06: each datum appears once.
  it("shows vendor, amount, bill number and status once each", async () => {
    rolesMock.mockReturnValue(["accounts_officer"]);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getAllByText("Acme Traders")).toHaveLength(1);
    expect(screen.getAllByText("₹2,500.00")).toHaveLength(1);
    expect(screen.getAllByText("BILL-77")).toHaveLength(1);
    expect(screen.getAllByText("Pending")).toHaveLength(1);
    expect(screen.getByText("PO 5b1c2d3e")).toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03: Pass bill is APPROVER_ROLES-only on the server.
  it("offers Pass bill to an approver but not to a plain finance_officer", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    const { unmount } = render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("button", { name: /pass bill/i })).not.toBeInTheDocument();
    unmount();
    rolesMock.mockReturnValue(["accounts_officer"]);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByRole("button", { name: /pass bill/i })).toBeInTheDocument();
  });
});
