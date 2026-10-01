import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock, refresh: vi.fn() }),
}));

const EMP_ID = "11111111-1111-4111-8111-111111111111";
const searchEmployeesMock = vi.fn();
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: (...a: unknown[]) => searchEmployeesMock(...a),
  resolveEmployees: vi.fn(async () => []),
}));

import { LoanSearchForm } from "./LoanSearchForm";

function renderForm(props: Partial<React.ComponentProps<typeof LoanSearchForm>> = {}) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <LoanSearchForm initialEmpId="" {...props} />
    </NextIntlClientProvider>,
  );
}

describe("LoanSearchForm (GAP-PAYROLL-LOANS-01)", () => {
  beforeEach(() => {
    pushMock.mockReset();
    searchEmployeesMock.mockReset();
    searchEmployeesMock.mockResolvedValue([{ id: EMP_ID, label: "Asha Rao (EMP-001)", sublabel: "Finance" }]);
  });

  it("has no UUID field -- it is a name/code search", () => {
    renderForm();
    expect(screen.queryByLabelText(/UUID/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Employee")).toHaveAttribute("role", "combobox");
  });

  it("lists matches for a typed name and pushes ?empId=<uuid> on selection", async () => {
    renderForm();
    fireEvent.change(screen.getByLabelText("Employee"), { target: { value: "Asha" } });

    await waitFor(() => expect(searchEmployeesMock).toHaveBeenCalledWith("Asha", expect.any(AbortSignal)));
    fireEvent.mouseDown(await screen.findByText("Asha Rao (EMP-001)"));

    expect(pushMock).toHaveBeenCalledWith(`/hr/payroll/loans?empId=${EMP_ID}`);
  });

  it("clearing the selection navigates back to the unfiltered page", () => {
    renderForm({ initialEmpId: EMP_ID, initialEmployee: { id: EMP_ID, label: "Asha Rao (EMP-001)" } });
    fireEvent.click(screen.getByRole("button", { name: "Clear selected employee" }));
    expect(pushMock).toHaveBeenCalledWith("/hr/payroll/loans");
    expect(screen.queryByRole("button", { name: "Clear selected employee" })).not.toBeInTheDocument();
  });

  it("offers no Clear button when nobody is selected", () => {
    renderForm();
    expect(screen.queryByRole("button", { name: "Clear selected employee" })).not.toBeInTheDocument();
  });

  it("shows the already-searched employee by name, not by id", () => {
    renderForm({ initialEmpId: EMP_ID, initialEmployee: { id: EMP_ID, label: "Asha Rao (EMP-001)" } });
    expect(screen.getByLabelText("Employee")).toHaveValue("Asha Rao (EMP-001)");
  });
});
