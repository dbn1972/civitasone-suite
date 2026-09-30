import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { EmployeesTable, type EmpRow } from "./EmployeesTable";

function renderTable(employees: EmpRow[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <EmployeesTable employees={employees} />
    </NextIntlClientProvider>,
  );
}

describe("EmployeesTable", () => {
  it("renders the roster with a Joining Date column", () => {
    renderTable([{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", status: "confirmed", dateOfJoining: "2020-04-01" }]);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Joining Date" })).toBeInTheDocument();
  });

  // GAP-HR-EMPLOYEES-06 (partial): the backend doesn't return dateOfJoining
  // on origin/main yet (lands via a separate, already-open PR) -- this
  // column must degrade to a dash, not blow up or show "undefined".
  it("shows a dash for Joining Date when the backend hasn't supplied it yet", () => {
    renderTable([{ id: "e1", employeeNo: "EMP001", name: "Asha Rao", department: "Finance", status: "confirmed" }]);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("shows the honest empty state for a genuinely empty roster", () => {
    renderTable([]);
    expect(screen.getByText("Your team starts here")).toBeInTheDocument();
  });
});
