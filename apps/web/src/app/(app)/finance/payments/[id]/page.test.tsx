import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getByIdMock = vi.fn();
const getContextMock = vi.fn();
const getNamesMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getFinancePaymentById: (...a: unknown[]) => getByIdMock(...a),
  getFinancePaymentContext: (...a: unknown[]) => getContextMock(...a),
  getFinanceActorNames: (...a: unknown[]) => getNamesMock(...a),
}));
const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_components/RaiseEOfficeNote", () => ({
  RaiseEOfficeNote: () => <button type="button">Raise for approval</button>,
}));

import PaymentDetailPage from "./page";

const ID = "5b1c2d3e-0000-4000-8000-00000000abcd";
function payment(over: Record<string, unknown> = {}) {
  return {
    data: {
      id: ID,
      billId: "b1b1b1b1-0000-4000-8000-000000000001",
      amountMinor: "1000000000",
      mode: "NEFT",
      status: "initiated",
      currency: "INR",
      createdBy: "u1",
      createdAt: "2026-07-04T12:00:00.000Z",
      eftRef: null,
      utr: null,
      ...over,
    },
    source: "api",
  };
}

describe("PaymentDetailPage", () => {
  beforeEach(() => {
    getByIdMock.mockReset();
    notFoundMock.mockClear();
    getContextMock.mockReset();
    getNamesMock.mockReset();
    getContextMock.mockResolvedValue({ data: { beneficiary: null, bill: null, approvedBy: null, events: [] }, source: "api" });
    getNamesMock.mockResolvedValue({});
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-03
  it.each(["released", "failed", "pending_approval"])("does not offer 'Raise for approval' for a %s payment", async (status) => {
    getByIdMock.mockResolvedValue(payment({ status }));
    render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.queryByText("Raise for approval")).not.toBeInTheDocument();
  });

  it("offers 'Raise for approval' for an open (initiated) payment", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "initiated" }));
    render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.getByText("Raise for approval")).toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-04
  it("shows the status once, plus the bill link and created date", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "released" }));
    const { container } = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.getAllByText("Released")).toHaveLength(1);
    expect(screen.getByRole("link", { name: "View bill" })).toHaveAttribute(
      "href",
      "/finance/expenditure/bills/b1b1b1b1-0000-4000-8000-000000000001",
    );
    expect(container.textContent).toContain("04 Jul 2026");
    expect(screen.getAllByText("₹1,00,00,000.00").length).toBeGreaterThan(0);
  });

  it("renders a dash for a missing bill / date", async () => {
    getByIdMock.mockResolvedValue(payment({ billId: undefined, createdAt: undefined }));
    render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.queryByRole("link", { name: "View bill" })).not.toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-07
  it("colours a released payment's header pill green", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "released" }));
    const { container } = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(container.querySelector(".pill.good")?.textContent).toBe("Released");
  });

  it("colours pending_approval amber", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "pending_approval" }));
    const { container } = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(container.querySelector(".pill.warn")?.textContent).toBe("Pending Approval");
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-06
  it("shows the same reference the register shows (eftRef), else the PAY- fragment", async () => {
    getByIdMock.mockResolvedValue(payment({ eftRef: "EFT-2026-0042" }));
    const a = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(a.container.querySelector(".mono")?.textContent).toBe("EFT-2026-0042");
    a.unmount();

    getByIdMock.mockResolvedValue(payment({ eftRef: null }));
    const b = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(b.container.querySelector(".mono")?.textContent).toBe("PAY-00ABCD");
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-05
  it("hands a real 404 to the route-level not-found page", async () => {
    getByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(PaymentDetailPage({ params: { id: ID } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("a failed load (500) is an error state, not 'not found'", async () => {
    getByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await PaymentDetailPage({ params: { id: ID } }));
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();
  });

  // GAP-FINANCE-PAYMENTS-DETAIL-04: beneficiary, bill, approver and the status history.
  it("shows the beneficiary, bill number, approver and a status timeline with names, never raw ids", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "released", createdBy: "11111111-1111-4111-8111-111111111111" }));
    getContextMock.mockResolvedValue({
      source: "api",
      data: {
        beneficiary: { vendorId: "v-9", name: "M/s Acme Traders" },
        bill: { id: "b1b1b1b1-0000-4000-8000-000000000001", billNo: "BILL/2026/17" },
        approvedBy: "22222222-2222-4222-8222-222222222222",
        events: [
          { status: "initiated", actorId: "11111111-1111-4111-8111-111111111111", note: null, at: "2026-07-04T12:00:00.000Z" },
          { status: "pending_approval", actorId: "11111111-1111-4111-8111-111111111111", note: null, at: "2026-07-05T09:00:00.000Z" },
          { status: "released", actorId: "22222222-2222-4222-8222-222222222222", note: null, at: "2026-07-06T09:00:00.000Z" },
        ],
      },
    });
    getNamesMock.mockResolvedValue({ "11111111-1111-4111-8111-111111111111": "Asha Rao", "22222222-2222-4222-8222-222222222222": "Dev Menon" });
    const { container } = render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.getByRole("link", { name: "M/s Acme Traders" })).toHaveAttribute("href", "/finance/vendors/v-9");
    expect(screen.getByRole("link", { name: "BILL/2026/17" })).toHaveAttribute("href", "/finance/expenditure/bills/b1b1b1b1-0000-4000-8000-000000000001");
    const timeline = screen.getByRole("list", { name: "Payment status history" });
    expect(timeline.querySelectorAll("li")).toHaveLength(3);
    expect(timeline.textContent).toContain("Dev Menon");
    expect(screen.getAllByText("Dev Menon").length).toBeGreaterThan(1); // approver field + timeline row
    expect(screen.getAllByText("Asha Rao").length).toBeGreaterThan(1); // created-by field + timeline rows
    expect(container.textContent).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-4/);
    // The header pill still shows the status exactly once outside the history list.
    expect(container.querySelectorAll(".page-head .pill, header .pill").length).toBeLessThanOrEqual(1);
  });

  it("missing beneficiary / bill / approver show a dash, and an empty history is its own empty state", async () => {
    getByIdMock.mockResolvedValue(payment({ billId: undefined }));
    render(await PaymentDetailPage({ params: { id: ID } }));
    const beneficiary = screen.getByText("Beneficiary").closest(".field")!;
    expect(beneficiary).toHaveTextContent("—");
    expect(screen.getByText("Approved by").closest(".field")).toHaveTextContent("—");
    expect(screen.getByText("No history recorded")).toBeInTheDocument();
  });

  it("a failed context lookup is a load error for the history only; the payment itself still renders", async () => {
    getByIdMock.mockResolvedValue(payment({ status: "initiated" }));
    getContextMock.mockResolvedValue({ data: null, source: "error", status: 503 });
    render(await PaymentDetailPage({ params: { id: ID } }));
    expect(screen.getByText(/couldn't load payment history/i)).toBeInTheDocument();
    expect(screen.queryByText("No history recorded")).not.toBeInTheDocument();
    expect(screen.getAllByText("₹1,00,00,000.00").length).toBeGreaterThan(0);
  });
});
