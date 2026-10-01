import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { IncomeTaxTable } from "./IncomeTaxTable";

const base = {
  department: "Revenue",
  grossIncome: "1200000",
  otherDeductions: "0",
  taxableIncome: "1125000",
  taxPayable: "60000",
  status: "submitted",
};

/** GAP-PAYROLL-INCOME-TAX-05 */
describe("IncomeTaxTable — regime", () => {
  it("shows each row's regime and '—' (not ₹0) for 80C/other deductions under the new regime", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <IncomeTaxTable
          items={[
            { ...base, id: "1", employee: "Asha New", deductions80C: "0", regime: "new" },
            { ...base, id: "2", employee: "Ravi Old", deductions80C: "150000", otherDeductions: "25000", regime: "old" },
          ]}
        />
      </NextIntlClientProvider>,
    );
    const newRow = screen.getByText("Asha New").closest("tr")!;
    expect(within(newRow).getByText("New")).toBeInTheDocument();
    expect(within(newRow).getAllByText("—").length).toBeGreaterThanOrEqual(2);

    const oldRow = screen.getByText("Ravi Old").closest("tr")!;
    expect(within(oldRow).getByText("Old")).toBeInTheDocument();
    expect(within(oldRow).getByText("₹1,50,000.00")).toBeInTheDocument();
  });
});
