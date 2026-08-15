import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { LoanSummaryCard, type LoanRecord } from "./LoanSummaryCard";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const BASE_LOAN: LoanRecord = {
  id: "LOAN-001",
  employeeName: "Suresh Patel",
  employeeCode: "EMP-301",
  loanType: "hba",
  sanctionedAmount: 2500000,
  outstandingBalance: 1800000,
  emiAmount: 25000,
  interestRate: 8.5,
  nextDueDate: "2026-09-01",
  totalInterestPayable: 380000,
  tenureMonths: 120,
  paidMonths: 24,
  status: "active",
  currency: "INR",
};

describe("LoanSummaryCard", () => {
  it("renders employee name and code", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    expect(screen.getByText("Suresh Patel")).toBeInTheDocument();
    expect(screen.getByText(/EMP-301/)).toBeInTheDocument();
  });

  it("renders House Building Advance title", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    expect(screen.getByText(/House Building Advance/)).toBeInTheDocument();
  });

  it("renders outstanding balance", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    expect(screen.getByText("Outstanding")).toBeInTheDocument();
  });

  it("renders EMI amount", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    expect(screen.getByText("Monthly EMI")).toBeInTheDocument();
  });

  it("renders interest rate", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    expect(screen.getByText("8.5% p.a.")).toBeInTheDocument();
  });

  it("renders progress bar with correct aria attributes", () => {
    render(<LoanSummaryCard loan={BASE_LOAN} />);
    const progressBar = screen.getByRole("progressbar");
    expect(progressBar).toBeInTheDocument();
    expect(progressBar).toHaveAttribute("aria-valuenow", "20");
    expect(progressBar).toHaveAttribute("aria-valuemax", "100");
  });

  it("renders festival advance without progress bar when tenure is 0", () => {
    const festivalLoan: LoanRecord = {
      ...BASE_LOAN,
      loanType: "festival",
      tenureMonths: 0,
      paidMonths: 0,
      interestRate: 0,
    };
    render(<LoanSummaryCard loan={festivalLoan} />);
    expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
  });

  it("shows overdue status pill", () => {
    const overdueLoan = { ...BASE_LOAN, status: "overdue" as const };
    render(<LoanSummaryCard loan={overdueLoan} />);
    expect(screen.getByText("overdue")).toBeInTheDocument();
  });
});
