import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SalaryBillForm } from "./SalaryBillForm";

const VALID_DEPT = "11111111-1111-1111-1111-111111111111";
const DEPARTMENTS = [{ id: VALID_DEPT, name: "Finance Department" }];

describe("SalaryBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires all core fields before opening the confirm dialog, with field-specific messages", () => {
    render(<SalaryBillForm departments={DEPARTMENTS} />);
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

    render(<SalaryBillForm departments={DEPARTMENTS} />);
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

    render(<SalaryBillForm departments={DEPARTMENTS} />);
    fireEvent.change(screen.getByLabelText(/Month \(YYYY-MM\)/), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText(/Department/), { target: { value: VALID_DEPT } });
    fireEvent.change(screen.getByLabelText(/Total Amount, in paise/), { target: { value: "1000000" } });
    fireEvent.change(screen.getByLabelText(/Employee Count/), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText(/DDO Code/), { target: { value: "DDO01" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate Salary Bill" }));

    await waitFor(() => expect(screen.getByText("Submit this salary bill to treasury?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Submit salary bill"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });

  it("shows a fallback message and disables the select when no departments are available", () => {
    render(<SalaryBillForm departments={[]} />);
    const select = screen.getByLabelText(/Department/) as HTMLSelectElement;
    expect(select).toBeDisabled();
    expect(
      screen.getByText("Unable to load departments. Contact an administrator if this persists."),
    ).toBeInTheDocument();
  });
});
