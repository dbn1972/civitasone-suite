import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
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

/** GAP-PAYROLL-INCOME-TAX-03 */
describe("IncomeTaxTable -- row links", () => {
  const wrap = (items: React.ComponentProps<typeof IncomeTaxTable>["items"]) =>
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <IncomeTaxTable items={items} />
      </NextIntlClientProvider>,
    );

  it("links a row to /hr/employees/{employeeId} and URL-encodes the id", () => {
    wrap([{ ...base, id: "dec-1", employeeId: "emp/with space", employee: "Asha Rao", deductions80C: "0", regime: "new" }]);
    expect(screen.getByRole("link", { name: "Open Asha Rao" })).toHaveAttribute("href", "/hr/employees/emp%2Fwith%20space");
  });

  it("renders no link (and no 'undefined' target) for a row without an employeeId", () => {
    wrap([{ ...base, id: "dec-1", employee: "Asha Rao", deductions80C: "0", regime: "new" }]);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });
});

/** GAP-PAYROLL-INCOME-TAX-04 */
describe("IncomeTaxTable -- status pills are translated", () => {
  const rows = [
    { ...base, id: "1", employee: "Row One", deductions80C: "0", regime: "new", status: "submitted" },
    { ...base, id: "2", employee: "Row Two", deductions80C: "0", regime: "new", status: "verified" },
    { ...base, id: "3", employee: "Row Three", deductions80C: "0", regime: "new", status: "approved" },
    { ...base, id: "4", employee: "Row Four", deductions80C: "0", regime: "new", status: "a-status-from-the-future" },
  ];
  const pillOf = (name: string) => screen.getByText(name).closest("tr")!.querySelector(".pill")!.textContent;

  it("shows Hindi labels for submitted / verified / approved in the hi locale", () => {
    render(
      <NextIntlClientProvider locale="hi" messages={hiMessages}>
        <IncomeTaxTable items={rows} />
      </NextIntlClientProvider>,
    );
    expect(pillOf("Row One")).toBe(hiMessages.incomeTax.status.submitted);
    expect(pillOf("Row Two")).toBe(hiMessages.incomeTax.status.verified);
    expect(pillOf("Row Three")).toBe(hiMessages.incomeTax.status.approved);
    // none of them may leak the English enum
    for (const n of ["Row One", "Row Two", "Row Three"]) expect(pillOf(n)).not.toMatch(/^[a-z]+$/i);
  });

  it("translates verified / approved in en and keeps an unknown status visible rather than blank", () => {
    render(
      <NextIntlClientProvider locale="en" messages={enMessages}>
        <IncomeTaxTable items={rows} />
      </NextIntlClientProvider>,
    );
    expect(pillOf("Row Two")).toBe("Verified");
    expect(pillOf("Row Three")).toBe("Approved");
    expect(pillOf("Row Four")).toBe("a-status-from-the-future");
  });
});
