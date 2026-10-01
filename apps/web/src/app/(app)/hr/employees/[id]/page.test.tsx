import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({
  getEmployeeById: (...args: unknown[]) => getEmployeeByIdMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import EmployeeDetailPage from "./page";

const BASE_EMPLOYEE = {
  id: "e1",
  employeeId: "EMP001",
  name: "Priya Sharma",
  department: "Finance",
  designation: "Section Officer",
  joiningDate: "2020-01-15",
  status: "confirmed",
  bankAccountNo: null,
  bankIfsc: null,
  pan: null,
};

describe("EmployeeDetailPage", () => {
  beforeEach(() => {
    getEmployeeByIdMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  // The flagship case for this fix: GET /v1/hrms/employees/:id
  // (services/hrms-service/src/modules/employee/routes.ts) 403s a manager
  // who asks for an employee id that isn't one of their own direct
  // reports, with the specific reason "managers may only view their own
  // direct reports' records". This is a PER-RECORD ownership check, not a
  // static role gate -- the same manager IS allowed for other employee
  // ids -- so there is no fixed requiredRoles list this page could ever
  // hardcode; only the live response can say why. Before this fix, this
  // 403 rendered identically to a real outage, telling the manager to
  // retry a request that can never succeed.
  it("shows an honest 'Access restricted' message with the backend's own reason for a 403 (never the generic retry message)", async () => {
    getEmployeeByIdMock.mockResolvedValue({
      data: null,
      source: "error",
      status: 403,
      errorMessage: "managers may only view their own direct reports' records",
    });

    const ui = await EmployeeDetailPage({ params: { id: "emp-not-mine" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
    expect(
      screen.getByText("Managers may only view their own direct reports' records."),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  it("still shows the generic 'couldn't load, try again' message for a genuine transient failure (no status -- e.g. a network error)", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: null, source: "error" });

    const ui = await EmployeeDetailPage({ params: { id: "emp-1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Access restricted" })).not.toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-DETAIL-07: a real 404 used to fall into the same
   * "couldn't load, try again" branch as a transient failure -- misleading
   * for an id that will never succeed.
   */
  it("shows an honest not-found message (no Try again) for a real 404", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });

    const ui = await EmployeeDetailPage({ params: { id: "emp-gone" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByText("Employee not found.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });

  /** GAP-HR-EMPLOYEES-DETAIL-02: manager sees no admin actions. */
  it("hides Edit and Transfer/Promotion for a manager, shows Apply Leave/Attendance/Service Book", async () => {
    mockRoles = ["manager"];
    getEmployeeByIdMock.mockResolvedValue({ data: BASE_EMPLOYEE, source: "api" });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-07: Edit is now a plain Link to
    // /edit, not an inline-toggle Button.
    expect(screen.queryByRole("link", { name: /edit/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /initiate transfer/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /initiate promotion/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /initiate separation/i })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /apply leave/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view attendance/i })).toBeInTheDocument();
  });

  it("shows all admin actions, separated into their own Lifecycle (HR only) card, for hr_admin", async () => {
    mockRoles = ["hr_admin"];
    getEmployeeByIdMock.mockResolvedValue({ data: BASE_EMPLOYEE, source: "api" });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    // GAP-HR-EMPLOYEES-DETAIL-EDIT-07: Edit is now a plain Link to the
    // already role-gated /edit route, not an inline-toggle Button that
    // mounted the whole form inside PageHeader's actions slot.
    const editLink = screen.getByRole("link", { name: /edit/i });
    expect(editLink).toHaveAttribute("href", "/hr/employees/e1/edit");
    expect(screen.getByRole("link", { name: /initiate transfer/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Lifecycle (HR only)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /initiate separation/i })).toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-DETAIL-06: deputation is a real, currently-serving
   * status (employee/status.ts's SERVING_STATUSES) -- this used to check
   * for a nonexistent "active" status plus probation/confirmed only, so a
   * deputed employee's profile silently lost the whole Quick Actions card.
   */
  it("still shows the Quick Actions card for a deputation employee", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: { ...BASE_EMPLOYEE, status: "deputation" }, source: "api" });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByRole("heading", { name: "Quick Actions" })).toBeInTheDocument();
    expect(screen.getByText("Deputation")).toBeInTheDocument();
    expect(screen.queryByText(/has left the organisation/i)).not.toBeInTheDocument();
  });

  it("shows a muted explanation, no Quick Actions card, for an exited employee", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: { ...BASE_EMPLOYEE, status: "separated" }, source: "api" });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.queryByRole("heading", { name: "Quick Actions" })).not.toBeInTheDocument();
    expect(screen.getByText(/has left the organisation/i)).toBeInTheDocument();
  });

  it("never renders a status with a visible underscore (StatusPill's own humanizer, no manual override)", async () => {
    getEmployeeByIdMock.mockResolvedValue({ data: { ...BASE_EMPLOYEE, status: "on_leave" }, source: "api" });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.queryByText(/on_leave/i)).not.toBeInTheDocument();
    expect(screen.getByText("On Leave")).toBeInTheDocument();
  });

  /** GAP-HR-EMPLOYEES-DETAIL-05 */
  it("shows a masked Statutory & Bank card for hr_admin when the API returns masked values, and links Reports To", async () => {
    mockRoles = ["hr_admin"];
    getEmployeeByIdMock.mockResolvedValue({
      data: { ...BASE_EMPLOYEE, pan: "******123F", bankAccountNo: "******7890", bankIfsc: "SBIN0001234", reportingTo: "Ramesh Gupta", managerId: "mgr-1" },
      source: "api",
    });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.getByRole("heading", { name: "Statutory & Bank" })).toBeInTheDocument();
    expect(screen.getByText("******123F")).toBeInTheDocument();
    const managerLink = screen.getByRole("link", { name: "Ramesh Gupta" });
    expect(managerLink).toHaveAttribute("href", "/hr/employees/mgr-1");
  });

  it("hides the Statutory & Bank card for a manager even when bank fields are present", async () => {
    mockRoles = ["manager"];
    getEmployeeByIdMock.mockResolvedValue({
      data: { ...BASE_EMPLOYEE, pan: "******123F" },
      source: "api",
    });

    const ui = await EmployeeDetailPage({ params: { id: "e1" } });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);

    expect(screen.queryByRole("heading", { name: "Statutory & Bank" })).not.toBeInTheDocument();
    expect(screen.queryByText("******123F")).not.toBeInTheDocument();
  });
});
