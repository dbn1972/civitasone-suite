import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
let sessionRoles: string[] = ["payroll_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => sessionRoles,
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));
const profileMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getMyProfile: () => profileMock() }));
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async () => []),
}));

import ReimbursementsPage from "./page";

const E1 = "aaaaaaaa-1111-4111-8111-111111111101";
const ME = "aaaaaaaa-1111-4111-8111-1111111111ee";

function withData(claims: { data: unknown; source: string }, names: unknown[] = []) {
  fetchJsonMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/hrms/employees") ? { data: names, source: "api" } : claims),
  );
}

async function renderPage() {
  const ui = await ReimbursementsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

const CLAIMS = [
  { id: "r1", employee_id: E1, category: "lta", amount_minor: 250000, bill_date: "2026-07-01", bill_ref: "BILL-1", period: "2026-07", status: "submitted" },
  { id: "r2", employee_id: E1, category: "medical", amount_minor: 100000, bill_date: null, bill_ref: null, period: "2026-06", status: "rejected" },
];

describe("ReimbursementsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    profileMock.mockReset();
    sessionRoles = ["payroll_admin"];
  });

  it("staff: names, translated categories, bill date, real month (GAP-PAYROLL-REIMBURSEMENTS-01/03/04)", async () => {
    withData({ data: CLAIMS, source: "api" }, [[E1, { name: "Farah Khan", employeeNo: "EMP-31" }]]);
    await renderPage();
    expect(screen.getAllByText("Farah Khan (EMP-31)").length).toBeGreaterThan(0);
    expect(screen.queryByText(E1)).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "LTA" })).toBeInTheDocument();
    expect(screen.queryByText("lta")).not.toBeInTheDocument();
    expect(screen.getByText("Jul 2026")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Bill Date/ })).toBeInTheDocument();
  });

  it("GAP-PAYROLL-REIMBURSEMENTS-02: the claimed total excludes rejected claims; submitted rows offer Approve/Reject", async () => {
    withData({ data: CLAIMS, source: "api" });
    await renderPage();
    expect(screen.getByText("₹2,500.00", { selector: "*:not(td)" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^Approve claim/ })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /^Reject claim/ })).toHaveLength(1);
  });

  it("GAP-PAYROLL-REIMBURSEMENTS-01/05: an employee files only for themselves and has no decision buttons", async () => {
    sessionRoles = ["employee"];
    profileMock.mockResolvedValue({ data: { id: ME, name: "Self User", employeeNo: "EMP-9", department: "", status: "active", designation: "" }, source: "api" });
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByDisplayValue("Self User (EMP-9)")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Approve claim/ })).not.toBeInTheDocument();
    // No directory lookup for a self-service list.
    expect(fetchJsonMock.mock.calls.some(([p]) => String(p).startsWith("/api/v1/hrms/employees"))).toBe(false);
  });

  it("b3 review: a finance_officer+employee user is treated as self-service (own profile, no decisions, no directory lookup)", async () => {
    sessionRoles = ["finance_officer", "employee"];
    profileMock.mockResolvedValue({ data: { id: ME, name: "Self User", employeeNo: "EMP-9", department: "", status: "active", designation: "" }, source: "api" });
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByDisplayValue("Self User (EMP-9)")).toHaveAttribute("readonly");
    expect(screen.queryByRole("button", { name: /Approve claim/ })).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([p]) => String(p).startsWith("/api/v1/hrms/employees"))).toBe(false);
  });

  it("an employee with no linked record is told so instead of getting a form", async () => {
    sessionRoles = ["employee"];
    profileMock.mockResolvedValue({ data: null, source: "api", status: 404 });
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No employee record linked")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Submit Claim" })).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-REIMBURSEMENTS-05: a manager-only account gets Access restricted and no fetch", async () => {
    sessionRoles = ["manager"];
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders an empty state when there are no claims", async () => {
    withData({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No reimbursement claims yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    withData({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });
});
