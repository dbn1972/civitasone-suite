import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { ExpenseClaimRow, type ExpenseClaim } from "./ExpenseClaimRow";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const BASE_CLAIM: ExpenseClaim = {
  id: "EXP-001",
  employeeName: "Amit Sharma",
  employeeCode: "EMP-100",
  category: "office_supplies",
  description: "Printer paper and toner",
  amount: 3200,
  currency: "INR",
  receiptAttached: true,
  ddoCountersigned: false,
  status: "pending",
  submittedDate: "2026-08-10",
};

describe("ExpenseClaimRow", () => {
  it("renders employee name and code", () => {
    render(
      <table><tbody><ExpenseClaimRow claim={BASE_CLAIM} /></tbody></table>
    );
    expect(screen.getByText("Amit Sharma")).toBeInTheDocument();
    expect(screen.getByText("EMP-100")).toBeInTheDocument();
  });

  it("renders category label for office_supplies", () => {
    render(
      <table><tbody><ExpenseClaimRow claim={BASE_CLAIM} /></tbody></table>
    );
    expect(screen.getByText("Office Supplies")).toBeInTheDocument();
  });

  it("shows receipt attached status correctly", () => {
    render(
      <table><tbody><ExpenseClaimRow claim={BASE_CLAIM} /></tbody></table>
    );
    expect(screen.getByLabelText("Receipt attached")).toBeInTheDocument();
  });

  it("shows DDO pending when not countersigned", () => {
    render(
      <table><tbody><ExpenseClaimRow claim={BASE_CLAIM} /></tbody></table>
    );
    expect(screen.getByLabelText("Pending DDO countersignature")).toBeInTheDocument();
  });

  it("shows DDO countersigned when true", () => {
    const claim = { ...BASE_CLAIM, ddoCountersigned: true };
    render(
      <table><tbody><ExpenseClaimRow claim={claim} /></tbody></table>
    );
    expect(screen.getByLabelText("DDO countersigned")).toBeInTheDocument();
  });
});
