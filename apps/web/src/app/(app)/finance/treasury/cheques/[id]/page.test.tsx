import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getFinanceChequeByIdMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/app/_data/loaders", () => ({
  getFinanceChequeById: (...args: unknown[]) => getFinanceChequeByIdMock(...args),
}));

import ChequeDetailPage from "./page";

const CHEQUE = {
  id: "i1",
  instrumentType: "cheque",
  instrumentNo: "004512",
  bankAccountId: null,
  bankName: "State Bank of India",
  payee: "M/s Sharma Traders",
  amountMinor: "2500000",
  currency: "INR",
  issueDate: "2026-06-01",
  status: "bounced",
  presentedAt: "2026-06-03T00:00:00.000Z",
  clearedAt: null,
  bouncedAt: "2026-06-05T00:00:00.000Z",
  cancelledAt: null,
  bounceReason: "Insufficient funds",
};

describe("ChequeDetailPage", () => {
  beforeEach(() => getFinanceChequeByIdMock.mockReset());

  it("renders the typed instrument", async () => {
    getFinanceChequeByIdMock.mockResolvedValue({ data: CHEQUE, source: "api" });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.getAllByText(/004512/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("₹25,000.00").length).toBeGreaterThan(0);
    expect(screen.getByText(/Bounced — Insufficient funds/)).toBeInTheDocument();
  });

  // GAP-FINANCE-TREASURY-CHEQUES-DETAIL-01: a bank account number must never be
  // printed in clear, even if a payload ever carries one.
  it("never renders a bank account number, even when the payload carries one", async () => {
    getFinanceChequeByIdMock.mockResolvedValue({
      data: { ...CHEQUE, accountNo: "123456789012", bankAccountNumber: "123456789012" },
      source: "api",
    });
    const { container } = render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(container.textContent).not.toContain("123456789012");
    expect(screen.queryByText("Account No")).not.toBeInTheDocument();
  });

  // GAP-FINANCE-TREASURY-CHEQUES-DETAIL-02
  it("shows a retry state, not 'Cheque not found', on a 5xx", async () => {
    getFinanceChequeByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByText("Cheque not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry/i })).toBeInTheDocument();
  });

  it("shows the access-restricted state on a 403 (no retry)", async () => {
    getFinanceChequeByIdMock.mockResolvedValue({ data: null, source: "error", status: 403 });
    render(await ChequeDetailPage({ params: { id: "i1" } }));
    expect(screen.queryByText("Cheque not found")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again|retry/i })).not.toBeInTheDocument();
  });

  it("keeps 'Cheque not found' for a genuine 404", async () => {
    getFinanceChequeByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await ChequeDetailPage({ params: { id: "zzz" } }));
    expect(screen.getByText("Cheque not found")).toBeInTheDocument();
  });
});
