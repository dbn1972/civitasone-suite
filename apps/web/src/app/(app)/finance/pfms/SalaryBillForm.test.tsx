import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { SalaryBillForm } from "./SalaryBillForm";

const VALID_DEPT = "11111111-1111-1111-1111-111111111111";

describe("SalaryBillForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("requires all core fields before opening the confirm dialog", () => {
    render(<SalaryBillForm />);
    fireEvent.click(screen.getByRole("button", { name: "Generate Salary Bill" }));
    expect(screen.getByText(/Month \(YYYY-MM\), department ID \(UUID\)/)).toBeInTheDocument();
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

    render(<SalaryBillForm />);
    fireEvent.change(screen.getByLabelText(/Month \(YYYY-MM\)/), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText(/Department ID/), { target: { value: VALID_DEPT } });
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

    render(<SalaryBillForm />);
    fireEvent.change(screen.getByLabelText(/Month \(YYYY-MM\)/), { target: { value: "2026-08" } });
    fireEvent.change(screen.getByLabelText(/Department ID/), { target: { value: VALID_DEPT } });
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
});
