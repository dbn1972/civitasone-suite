import { describe, it, expect, vi, beforeEach } from "vitest";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getDebtById = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getFinanceDebtById: (...a: unknown[]) => getDebtById(...a) }));
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => ["finance_admin"] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/", useSearchParams: () => new URLSearchParams() }));

import DebtDetailPage from "./page";

const render = (ui: React.ReactElement) =>
  rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

const DEBT = {
  id: "d1", instrument: "State Development Loan 2031", source: "market", lender: "NABARD", principalMinor: "120000000", currency: "INR",
  interestRateBps: 850, tenureMonths: 12, firstEmiDate: "2031-05-31", maturity: "2032-04-30", status: "active", outstandingMinor: "90000000",
  schedule: [{ installmentNo: 1, dueDate: "2031-05-31", principalMinor: "10000000", interestMinor: "850000", totalMinor: "10850000", status: "due", paidOn: null, paymentRef: null }],
};

describe("DebtDetailPage (GAP-FINANCE-DEBT-01)", () => {
  beforeEach(() => getDebtById.mockReset());

  it("shows the lender, principal, outstanding, rate, maturity and the schedule", async () => {
    getDebtById.mockResolvedValue({ data: DEBT, source: "api" });
    render(await DebtDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("NABARD")).toBeInTheDocument();
    expect(screen.getByText("Principal", { selector: ".lab" }).closest(".stat")).toHaveTextContent("₹12,00,000.00");
    expect(screen.getByText("Outstanding principal", { selector: ".lab" }).closest(".stat")).toHaveTextContent("₹9,00,000.00");
    expect(screen.getByText("Rate p.a.", { selector: ".lab" }).closest(".stat")).toHaveTextContent("8.50%");
    expect(screen.getByText("Final instalment", { selector: ".lab" }).closest(".stat")).toHaveTextContent("30 Apr 2032");
    expect(screen.getByRole("button", { name: "Record payment" })).toBeInTheDocument();
  });

  it("a loan with no repayment position shows a dash for outstanding, not ₹0.00", async () => {
    getDebtById.mockResolvedValue({ data: { ...DEBT, outstandingMinor: null, schedule: [] }, source: "api" });
    render(await DebtDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("Outstanding principal", { selector: ".lab" }).closest(".stat")).toHaveTextContent("—");
    expect(screen.getByText("No repayment schedule")).toBeInTheDocument();
  });

  it("only a real 404 is 'not found'", async () => {
    getDebtById.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await DebtDetailPage({ params: { id: "nope" } }));
    expect(screen.getByText("Loan not found")).toBeInTheDocument();
  });

  it("a failed load (500) is a retry state, never 'not found'", async () => {
    getDebtById.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await DebtDetailPage({ params: { id: "d1" } }));
    expect(screen.queryByText("Loan not found")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again|retry|refresh/i })).toBeInTheDocument();
  });

  it("shows whether the loan receipt journal is posted or still awaiting posting", async () => {
    getDebtById.mockResolvedValue({ data: { ...DEBT, receiptGlStatus: "pending" }, source: "api" });
    render(await DebtDetailPage({ params: { id: "d1" } }));
    expect(screen.getByText("The loan receipt journal is awaiting posting.")).toBeInTheDocument();
  });
});
