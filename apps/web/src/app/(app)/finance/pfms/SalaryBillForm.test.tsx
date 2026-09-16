import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { SalaryBillForm } from "./SalaryBillForm";
import type { PfmsDepartment } from "./types";

const VALID_DEPT = "11111111-1111-1111-1111-111111111111";
const DEPARTMENTS = [{ id: VALID_DEPT, name: "Finance Department" }];

// UX-017: SalaryBillForm now reads its copy through next-intl
// (useTranslations), so it needs a real provider in the tree -- same
// pattern as hr/leave/apply/ApplyLeaveForm.test.tsx.
function renderForm(departments: PfmsDepartment[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <SalaryBillForm departments={departments} />
    </NextIntlClientProvider>,
  );
}

describe("SalaryBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires all core fields before opening the confirm dialog, with field-specific messages", () => {
    renderForm(DEPARTMENTS);
    fireEvent.click(screen.getByRole("button", { name: "Generate Salary Bill" }));

    const monthInput = screen.getByLabelText(/Month \(YYYY-MM\)/);
    expect(screen.getByText("Month must be in YYYY-MM format.")).toBeInTheDocument();
    expect(monthInput).toHaveAttribute("aria-invalid", "true");
    expect(monthInput).toHaveFocus();
    expect(screen.getByText("Please select a department.")).toBeInTheDocument();
    expect(screen.getByText("DDO code is required.")).toBeInTheDocument();
    expect(
      screen.queryByText(/Month \(YYYY-MM\), department ID \(UUID\), total amount \(paise\)/),
    ).not.toBeInTheDocument();
  });

  it("generates a salary bill on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            billRef: "r1", pfmsBillNo: "SAL-2026-08-DDO01-ABCDEF", month: "2026-08",
            departmentId: VALID_DEPT, totalAmountMinor: 1000000, employeeCount: 10,
            status: "submitted_to_treasury", submittedAt: "2026-08-01T00:00:00Z",
          },
        }),
        { status: 201 },
      ),
    );

    renderForm(DEPARTMENTS);
    fireEvent.change(screen.getByLabelText(/Month \(YYYY-MM\)/), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: VALID_DEPT } });
    fireEvent.change(screen.getByLabelText(/Total Amount, in paise/), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText(/Employee Count/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Salary Bill" }));

    await waitFor(() => expect(screen.getByText("Submit this salary bill to treasury?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit salary bill"));

    await waitFor(() => {
      expect(screen.getByText(/Salary bill SAL-2026-08-DDO01-ABCDEF submitted/)).toBeInTheDocument();
    });
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    renderForm(DEPARTMENTS);
    fireEvent.change(screen.getByLabelText(/Month \(YYYY-MM\)/), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: VALID_DEPT } });
    fireEvent.change(screen.getByLabelText(/Total Amount, in paise/), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText(/Employee Count/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Salary Bill" }));

    await waitFor(() => expect(screen.getByText("Submit this salary bill to treasury?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit salary bill"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR/)).not.toBeInTheDocument();
  });

  it("shows a fallback message and disables the select when no departments are available", () => {
    renderForm([]);
    const select = screen.getByLabelText(/Department/) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(
      screen.getByText("Unable to load departments. Contact an administrator if this persists."),
    ).toBeInTheDocument();
  });
});
