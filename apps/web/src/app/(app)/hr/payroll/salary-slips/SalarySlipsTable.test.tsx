import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import type { SalarySlipSummary } from "@civitasone/types";
import { SalarySlipsTable } from "./SalarySlipsTable";

function makeSlip(overrides: Partial<SalarySlipSummary> = {}): SalarySlipSummary {
  return {
    id: "s1", employeeId: "e1", employeeName: "Asha Verma", department: "Finance",
    payPeriod: "2026-08", gross: 100000, deductions: 20000, net: 80000,
    status: "finalized",
    ...overrides,
  };
}

function renderTable(slips: SalarySlipSummary[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SalarySlipsTable slips={slips} />
    </NextIntlClientProvider>,
  );
}

describe("SalarySlipsTable", () => {
  // GAP-PAYROLL-SALARY-SLIPS-05: a draft/computed slip has not been through
  // finalisation and may still change -- it must not be printable.
  it("disables the print link for a draft row and keeps it enabled for a finalized one", () => {
    renderTable([makeSlip({ id: "d1", employeeName: "Draft Employee", status: "draft" }), makeSlip({ id: "f1", employeeName: "Final Employee", status: "finalized" })]);

    const printLinks = screen.getAllByText("Print");
    expect(printLinks[0].closest("a")).toBeNull(); // draft row: no real link
    expect(printLinks[0].closest("span")).toHaveAttribute("aria-disabled", "true");
    expect(printLinks[1].closest("a")).toHaveAttribute("href", expect.stringContaining("/pdf"));
  });

  // GAP-PAYROLL-SALARY-SLIPS-03: payPeriod used to print the raw backend
  // string ("2026-08") verbatim.
  it("formats payPeriod for display", () => {
    renderTable([makeSlip({ payPeriod: "2026-08" })]);
    expect(screen.getByText("August 2026")).toBeInTheDocument();
    expect(screen.queryByText("2026-08")).not.toBeInTheDocument();
  });
});
