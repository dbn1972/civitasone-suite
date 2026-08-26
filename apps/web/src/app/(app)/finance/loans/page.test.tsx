import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import LoansPage from "./page";

const SAMPLE_LOANS = [
  {
    id: "LOAN-001",
    employeeName: "Kavita Singh",
    employeeCode: "EMP-401",
    loanType: "hba",
    sanctionedAmount: 2000000,
    outstandingBalance: 1500000,
    emiAmount: 20000,
    interestRate: 8.5,
    nextDueDate: "2026-09-01",
    totalInterestPayable: 320000,
    tenureMonths: 120,
    paidMonths: 24,
    status: "active",
    currency: "INR",
  },
  {
    id: "LOAN-002",
    employeeName: "Ramesh Gupta",
    employeeCode: "EMP-402",
    loanType: "vehicle",
    sanctionedAmount: 125000,
    outstandingBalance: 80000,
    emiAmount: 3500,
    interestRate: 6.0,
    nextDueDate: "2026-09-05",
    totalInterestPayable: 15000,
    tenureMonths: 36,
    paidMonths: 10,
    status: "active",
    currency: "INR",
  },
  {
    id: "LOAN-003",
    employeeName: "Deepika Rao",
    employeeCode: "EMP-403",
    loanType: "festival",
    sanctionedAmount: 10000,
    outstandingBalance: 5000,
    emiAmount: 1000,
    interestRate: 0,
    nextDueDate: "2026-09-01",
    totalInterestPayable: 0,
    tenureMonths: 10,
    paidMonths: 5,
    status: "overdue",
    currency: "INR",
  },
];

describe("LoansPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it("renders the page title", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_LOANS, source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("Loans & Advances")).toBeInTheDocument();
  });

  it("shows correct stat cards", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_LOANS, source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("Active Loans")).toBeInTheDocument();
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    expect(screen.getByText("Total Outstanding")).toBeInTheDocument();
  });

  it("renders loan summary cards for up to 4 records", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_LOANS, source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("Kavita Singh")).toBeInTheDocument();
  });

  it("renders the all-loans table", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_LOANS, source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("All Loans & Advances")).toBeInTheDocument();
  });

  it("shows GFR reference section", async () => {
    fetchJsonMock.mockResolvedValue({ data: SAMPLE_LOANS, source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText(/GFR 2017 Chapter 23/)).toBeInTheDocument();
  });

  it("shows empty table when no loans", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("No loans on record")).toBeInTheDocument();
  });

  it("shows DataSourceBadge on error source", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    const ui = await LoansPage();
    render(ui);
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
