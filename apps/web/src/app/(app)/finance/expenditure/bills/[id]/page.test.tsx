import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds/Toast";

const render = (ui: React.ReactElement) => rtlRender(
  <NextIntlClientProvider locale="en" messages={enMessages}><ToastProvider>{ui}</ToastProvider></NextIntlClientProvider>,
);

const rolesMock = vi.fn<() => string[]>();
const viewerMock = vi.fn<() => string | null>(() => null);
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => rolesMock(), getSessionUserId: () => viewerMock() }));
const loaderMock = vi.fn();
vi.mock("../../../../../_data/loaders", () => ({ getFinanceBillById: () => loaderMock() }));
vi.mock("./BillLineItemsTable", () => ({ BillLineItemsTable: () => null }));
// Async server component with its own loader + tests (scannedDocuments.test.ts / ScannedDocumentsSection.test.tsx).
vi.mock("../../../_components/scanned/ScannedDocumentsSection", () => ({ ScannedDocumentsSection: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import BillDetailPage from "./page";

const PO_UUID = "5b1c2d3e-0000-4000-8000-000000000000";
const LODGER = "00000000-aaaa-4000-8000-000000000001";
const PASSER = "00000000-bbbb-4000-8000-000000000002";
const OTHER = "00000000-cccc-4000-8000-000000000003";

const BILL = {
  id: "b1", billNo: "BILL-77", vendor: "Acme Traders", amount: "250000", submittedDate: "2026-04-01",
  dueDate: "2026-05-01", status: "pending", threeWayMatch: "matched", poRef: `procurement_po:${PO_UUID}`,
  grnRef: undefined, invoiceNo: "INV-9", paymentRef: undefined, lineItems: [], createdBy: LODGER,
};

describe("BillDetailPage", () => {
  beforeEach(() => {
    rolesMock.mockReset();
    viewerMock.mockReset();
    viewerMock.mockReturnValue(OTHER);
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

  // GAP-FINANCE-EXPENDITURE-BILLS-06: the PO is the human number, linked to the purchase order.
  it("shows the PO number as a link to the purchase order", async () => {
    rolesMock.mockReturnValue(["accounts_officer"]);
    loaderMock.mockResolvedValue({ data: { ...BILL, poNumber: "PO-2026-014" }, source: "api" });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByRole("link", { name: "PO-2026-014" })).toHaveAttribute("href", `/procurement/orders/${PO_UUID}`);
    expect(screen.queryByText("PO 5b1c2d3e")).not.toBeInTheDocument();
  });
  it("shows a PO reference that names no page as plain text, and a bill with no PO as an em dash", async () => {
    rolesMock.mockReturnValue(["accounts_officer"]);
    loaderMock.mockResolvedValue({ data: { ...BILL, poRef: "procurement_po:abc-123", poNumber: "PO-2026-014" }, source: "api" });
    const { unmount } = render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByText("PO-2026-014")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "PO-2026-014" })).not.toBeInTheDocument();
    unmount();
    loaderMock.mockResolvedValue({ data: { ...BILL, poRef: undefined }, source: "api" });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("link", { name: /^PO/ })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-EXPENDITURE-BILLS-DETAIL-03: maker-checker. The server refuses the lodger passing their own bill and the
  // lodger / passer releasing its payment; the page must not invite either.
  it("does not offer Pass bill to the officer who lodged the bill", async () => {
    rolesMock.mockReturnValue(["accounts_officer"]);
    viewerMock.mockReturnValue(LODGER);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("button", { name: /pass bill/i })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/another officer must pass it/i);
  });
  it("offers Release payment on a passed bill to finance staff other than its lodger and passer", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    loaderMock.mockResolvedValue({ data: { ...BILL, status: "passed", passedBy: PASSER }, source: "api" });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByRole("link", { name: "Release payment" })).toBeInTheDocument();
  });
  it("does not offer Release payment to the officer who passed the bill", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    viewerMock.mockReturnValue(PASSER);
    loaderMock.mockResolvedValue({ data: { ...BILL, status: "passed", passedBy: PASSER }, source: "api" });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.getByRole("note")).toHaveTextContent(/you passed this bill/i);
  });
  it("does not offer Release payment to a read-only role (the payments route is finance staff only)", async () => {
    rolesMock.mockReturnValue(["audit_officer"]);
    loaderMock.mockResolvedValue({ data: { ...BILL, status: "passed", passedBy: PASSER }, source: "api" });
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
  });
});

// GAP-FINANCE-PAYMENTS-01: finance-service refuses a payment released by the bill's creator or passer
// (MAKER_CHECKER_VIOLATION / PAYER_IS_PASSER), so the UI must not offer "Release payment" to them.
describe("BillDetailPage release-payment segregation of duties", () => {
  const MAKER = "aaaaaaaa-0000-4000-8000-00000000000a";
  const PASSER = "bbbbbbbb-0000-4000-8000-00000000000b";
  const OTHER = "cccccccc-0000-4000-8000-00000000000c";
  const PASSED = { ...BILL, status: "passed", createdBy: MAKER, passedBy: PASSER };

  beforeEach(() => {
    rolesMock.mockReturnValue(["finance_officer"]);
    loaderMock.mockResolvedValue({ data: PASSED, source: "api" });
  });

  it("shows Release payment to an officer who neither created nor passed the bill", async () => {
    viewerMock.mockReturnValue(OTHER);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.getByRole("link", { name: "Release payment" })).toBeInTheDocument();
    expect(screen.queryByText(/another officer must release/i)).not.toBeInTheDocument();
  });

  it("hides Release payment from the bill's creator and says why", async () => {
    viewerMock.mockReturnValue(MAKER);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.getByText("You lodged this bill, so another officer must release its payment.")).toBeInTheDocument();
  });

  it("hides Release payment from the officer who passed the bill and says why", async () => {
    viewerMock.mockReturnValue(PASSER);
    render(await BillDetailPage({ params: { id: "b1" } }));
    expect(screen.queryByRole("link", { name: "Release payment" })).not.toBeInTheDocument();
    expect(screen.getByText("You passed this bill, so another officer must release its payment.")).toBeInTheDocument();
  });
});
