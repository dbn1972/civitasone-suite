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

// GAP-PAYROLL-HOME-01: amounts are integer-paise strings (Rs 80,000.00 gross etc.).
const SLIPS = [
  { id: "s1", employeeId: "E1", employeeName: "Asha Rao", grossMinor: "8000000", deductionsMinor: "1200000", netMinor: "6800000", status: "generated" },
  { id: "s2", employeeId: "E2", employeeName: "Vikram Shah", grossMinor: "9500000", deductionsMinor: "1500000", netMinor: "8000000", status: "generated" },
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
      grossMinor: "5000000",
      deductionsMinor: "500000",
      netMinor: "4500000",
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

  // GAP-PAYROLL-HOME-01: the table and the slip preview render from paise, exactly.
  it("renders gross / deductions / net from the paise strings in the table and the preview", () => {
    renderTable({ slips: SLIPS, payPeriod: "2026-09" });
    const row = screen.getByText("Asha Rao").closest("tr")!;
    expect(within(row).getByText("₹80,000.00")).toBeInTheDocument();
    expect(within(row).getByText("₹12,000.00")).toBeInTheDocument();
    expect(within(row).getByText("₹68,000.00")).toBeInTheDocument();
    // never the 100x-smaller reading of the same paise
    expect(screen.queryByText("₹800.00")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: "Preview Slip" })[0]);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("₹80,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("₹12,000.00")).toBeInTheDocument();
    expect(within(dialog).getByText("₹68,000.00")).toBeInTheDocument();
    expect(within(dialog).queryByRole("alert")).not.toBeInTheDocument();
  });

  it("warns, exactly to the paisa, when gross minus deductions does not foot to net", () => {
    // 80,000.00 - 12,000.00 = 68,000.00, but the slip says 68,000.01
    renderTable({
      slips: [{ id: "s9", employeeId: "E9", employeeName: "Meena Das", grossMinor: "8000000", deductionsMinor: "1200000", netMinor: "6800001", status: "generated" }],
      payPeriod: "2026-09",
    });
    fireEvent.click(screen.getByRole("button", { name: "Preview Slip" }));
    expect(within(screen.getByRole("dialog")).getByRole("alert")).toBeInTheDocument();
  });

  it("shows a dash, not ₹0.00, for an amount the payload did not carry", () => {
    renderTable({ slips: [{ id: "s8", employeeId: "E8", employeeName: "Ravi Kumar", status: "generated" }], payPeriod: "2026-09" });
    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });
});
