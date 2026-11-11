import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ReimbursementsTable, type ClaimRow } from "./ReimbursementsTable";

const base = {
  employee_label: "Farah Khan (EMP-31)", category_label: "LTA", amount_minor: "250000", period_display: "Jul 2026",
  bill_date_display: "01 Jul 2026", bill_ref: "BILL-1", status: "submitted",
};
const ROWS: ClaimRow[] = [
  { ...base, id: "a", receipt_count: 1, receipt_basis: "receipt" },
  { ...base, id: "b", receipt_count: 0, receipt_basis: "self_declaration", employee_label: "Gita Menon (EMP-55)" },
  { ...base, id: "c", receipt_count: 0, receipt_basis: "not_required", employee_label: "Ravi Iyer (EMP-70)" },
  { ...base, id: "d", receipt_count: 0, employee_label: "Old Row (EMP-1)" },
];

describe("ReimbursementsTable: how each claim was supported", () => {
  it("shows a receipt link, a self-declaration badge, 'Not required', or the legacy dash", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ReimbursementsTable rows={ROWS} canDecide showEmployee /></NextIntlClientProvider>);
    expect(screen.getByRole("button", { name: /View 1 receipt\(s\) for Farah Khan/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/Self-declaration signed instead of a receipt, for Gita Menon/)).toHaveTextContent("Self-declaration");
    expect(screen.getByText("Not required")).toBeInTheDocument();
  });

  it("the approve dialog tells the approver there is no receipt, only a self-declaration", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ReimbursementsTable rows={[ROWS[1]!]} canDecide showEmployee /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^Approve claim of/ }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("No receipt: the claimant signed a self-declaration instead.");
  });

  it("the approve dialog points to the receipt when one is attached", () => {
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ReimbursementsTable rows={[ROWS[0]!]} canDecide showEmployee /></NextIntlClientProvider>);
    fireEvent.click(screen.getByRole("button", { name: /^Approve claim of/ }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("Supported by a receipt");
  });

  it("marks a self-declaration signed on the employee's behalf, in the column and in the approve dialog", () => {
    const row: ClaimRow = { ...ROWS[1]!, id: "e", self_declared_on_behalf: true };
    render(<NextIntlClientProvider locale="en" messages={enMessages}><ReimbursementsTable rows={[row]} canDecide showEmployee /></NextIntlClientProvider>);
    expect(screen.getByLabelText(/Self-declaration signed on behalf of Gita Menon/)).toHaveTextContent("Self-declaration (on behalf)");
    fireEvent.click(screen.getByRole("button", { name: /^Approve claim of/ }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("signed a self-declaration on the employee's behalf");
  });
});
