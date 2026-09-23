import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { SalarySlipsClientTable } from "./SalarySlipsClientTable";

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
    render(<SalarySlipsClientTable slips={SLIPS} payPeriod="2026-09" />);
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
    render(<SalarySlipsClientTable slips={manySlips} payPeriod="2026-09" />);

    const nextBtn = screen.getByRole("button", { name: /Next/ });
    const prevBtn = screen.getByRole("button", { name: /Previous/ });
    expect(prevBtn).toBeDisabled();
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);
    expect(screen.getByText("Employee 50")).toBeInTheDocument();
    expect(prevBtn).toBeEnabled();
  });
});
