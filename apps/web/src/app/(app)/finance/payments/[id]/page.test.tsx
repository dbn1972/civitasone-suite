import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getByIdMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinancePaymentById: (...a: unknown[]) => getByIdMock(...a) }));
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
});
