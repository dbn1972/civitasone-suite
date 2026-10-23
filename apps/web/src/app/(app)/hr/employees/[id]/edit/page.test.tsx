import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import EditEmployeePage from "./page";

const MOCK_EMPLOYEE = {
  id: "emp-1",
  employeeId: "EMP-001",
  name: "Test Employee",
  department: "Finance",
  designation: "Clerk",
  joiningDate: "2020-01-01",
  status: "active",
};

async function renderPage(id = "emp-1") {
  const page = await EditEmployeePage({ params: Promise.resolve({ id }) });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("EditEmployeePage — role gating (Problem A)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    // getEmployeeById() -> fetchJson(`/api/v1/hrms/employees/${id}`, ...)
    fetchJsonMock.mockResolvedValue({ data: MOCK_EMPLOYEE, source: "api" });
  });

  it("shows an honest permission-denied state for 'employee' and never fetches the employee record", async () => {
    // Regression: PATCH /v1/hrms/employees/:id requires hr_admin/hr_officer/
    // super_admin (employee/routes.ts) -- confirmed live for the sibling
    // /hr/employees/new page; this edit page has the identical shape.
    mockRoles = ["employee"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders the real Edit Employee form for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
    expect(screen.getByText("Edit Employee")).toBeInTheDocument();
  });

  // GAP-HR-EMPLOYEES-DETAIL-EDIT-06: the form's diff-to-patch compares against what it was seeded
  // with, so the seed must be the current record, not a copy cached up to 60 s ago.
  it("reads the employee with no data cache (fresh) for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    await renderPage();
    expect(fetchJsonMock).toHaveBeenCalledTimes(1);
    const [url, , opts] = fetchJsonMock.mock.calls[0]!;
    expect(url).toBe("/api/v1/hrms/employees/emp-1");
    expect(opts.revalidateSeconds).toBeUndefined();
  });

  it("denies a manager (READER_ROLES can view, but PATCH's HR_ROLES excludes manager)", async () => {
    mockRoles = ["manager"];
    await renderPage();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });
});
