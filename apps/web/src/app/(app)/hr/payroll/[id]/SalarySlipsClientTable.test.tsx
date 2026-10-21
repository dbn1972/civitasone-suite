import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SalarySlipsClientTable } from "./SalarySlipsClientTable";

// UX-017: SalarySlipsClientTable now reads its copy through next-intl
// (useTranslations("salarySlipsClientTable")), so every render needs a real
// provider in the tree -- same pattern as off-cycle/CreateOffCycleForm.test.tsx.
function renderTable(props: React.ComponentProps<typeof SalarySlipsClientTable>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SalarySlipsClientTable {...props} />
    </NextIntlClientProvider>,
  );
}

const SLIPS = [
  { id: "s1", employeeId: "E1", employeeName: "Asha Rao", gross: 80000, deductions: 12000, net: 68000, status: "generated" },
  { id: "s2", employeeId: "E2", employeeName: "Vikram Shah", gross: 95000, deductions: 15000, net: 80000, status: "generated" },
];

// UX-008 tranche 2: "Run Payroll" (ad hoc inline styling with a hand-rolled
// disabled/grey treatment), "Preview Slip" (a `btnBase` object spread) and
// the Previous/Next pager (bare `className="btn"`, no variant) were all
// converted onto the shared Button component. The modal close (×) button
// stayed a raw <button> -- it's icon-only, which Button's own doc comment
// explicitly excludes. No prior test existed for this file, so this covers
// the converted controls' behavior.
describe("SalarySlipsClientTable", () => {
  it("opens the salary slip preview modal and closes it via the (icon-only) close button", () => {
    renderTable({ slips: SLIPS, payPeriod: "2026-09" });
    fireEvent.click(screen.getAllByRole("button", { name: "Preview Slip" })[0]);
    const dialog = screen.getByRole("dialog");
    // "Asha Rao" also appears in the table row behind the modal -- scope to
    // the dialog rather than asserting on the ambiguous whole-document text.
    expect(within(dialog).getByText("Asha Rao")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Close pay slip preview" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("filters rows and paginates with Previous/Next once there are more than 50 matches", () => {
    const manySlips = Array.from({ length: 60 }, (_, i) => ({
      id: `s${i}`,
      employeeId: `E${i}`,
      employeeName: `Employee ${i}`,
      gross: 50000,
      deductions: 5000,
      net: 45000,
      status: "generated",
    }));
    renderTable({ slips: manySlips, payPeriod: "2026-09" });

    const nextBtn = screen.getByRole("button", { name: /Next/ });
    const prevBtn = screen.getByRole("button", { name: /Previous/ });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);
    expect(screen.getByText("Employee 50")).toBeInTheDocument();
    expect(prevBtn).toBeEnabled();
  });
});

// GAP-PAYROLL-RUNS-01: per-slip money is exact paise (the API's *Minor strings), with the
// rupee float only as a legacy fallback, and the footing check is exact integer arithmetic.
describe("SalarySlipsClientTable — exact paise", () => {
  it("renders the paise strings through formatMoney, in preference to the rupee floats", () => {
    renderTable({
      slips: [{ id: "s1", employeeId: "E1", employeeName: "Asha Rao", gross: 1, deductions: 1, net: 1, grossMinor: "12345678", deductionsMinor: "345678", netMinor: "12000000", status: "generated" }],
      payPeriod: "2026-09",
    });
    expect(screen.getByText("₹1,23,456.78")).toBeInTheDocument();
    expect(screen.getByText("₹3,456.78")).toBeInTheDocument();
    expect(screen.getByText("₹1,20,000.00")).toBeInTheDocument();
  });

  it("falls back to the legacy rupee floats for an older payroll-service", () => {
    renderTable({ slips: SLIPS, payPeriod: "2026-09" });
    // s1 gross (80,000) is also s2's net, so assert on the first slip's distinct figures.
    expect(screen.getByText("₹68,000.00")).toBeInTheDocument();
    expect(screen.getByText("₹12,000.00")).toBeInTheDocument();
    expect(screen.getAllByText("₹80,000.00")).toHaveLength(2);
  });

  it("does not raise a false float mismatch for a slip that foots exactly (1234.56 - 100.10 = 1134.46)", () => {
    // In IEEE-754, 1234.56 - 100.1 !== 1134.46 -- the old float check would have cried wolf here.
    renderTable({
      slips: [{ id: "s1", employeeId: "E1", employeeName: "Asha Rao", gross: 1234.56, deductions: 100.1, net: 1134.46, status: "generated" }],
      payPeriod: "2026-09",
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Slip" }));
    expect(within(screen.getByRole("dialog")).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns when gross - deductions does not equal net by even one paisa", () => {
    renderTable({
      slips: [{ id: "s1", employeeId: "E1", employeeName: "Asha Rao", gross: 0, deductions: 0, net: 0, grossMinor: "100000", deductionsMinor: "10000", netMinor: "90001", status: "generated" }],
      payPeriod: "2026-09",
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Slip" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeInTheDocument();
  });
});
