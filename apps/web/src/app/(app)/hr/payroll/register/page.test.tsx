import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const runsMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getPayrollRunDetails: (...args: unknown[]) => runsMock(...args),
}));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));

import PayrollRegisterPage from "./page";
import { formatMoney } from "@/lib/formatters";

const line = (over: Record<string, unknown>) => ({
  id: "r1",
  department_name: "Revenue",
  employee_count: 42,
  total_gross_minor: "50000000",
  total_deductions_minor: "5000000",
  total_net_minor: "45000000",
  total_pf_minor: "1000000",
  total_esi_minor: "200000",
  total_tds_minor: "800000",
  total_pt_minor: "100000",
  period: "2025-06",
  ...over,
});

describe("PayrollRegisterPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    runsMock.mockReset();
    runsMock.mockResolvedValue({ data: [{ id: "11111111-1111-4111-8111-111111111111", payPeriod: "2025-06", employeeCount: 42 }], source: "api" });
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders register lines with an 'Other deductions' remainder (REGISTER-04)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [line({})], source: "api" });
    render(await PayrollRegisterPage({ searchParams: { period: "2025-06" } }));
    expect(screen.getByText("Revenue")).toBeInTheDocument();
    expect(screen.getAllByText("2025-06").length).toBeGreaterThan(0);
    // 5000000 - (1000000+200000+800000+100000) = 2900000 paise
    expect(screen.getByText("₹29,000.00")).toBeInTheDocument();
  });

  it("sums totals exactly in bigint paise (REGISTER-01)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [line({ id: "a", total_gross_minor: "9007199254740993" }), line({ id: "b", department_name: "Health", total_gross_minor: "9007199254740993" })],
      source: "api",
    });
    render(await PayrollRegisterPage({ searchParams: { period: "2025-06" } }));
    // Exact bigint sum; Number() addition would print a different (rounded) figure.
    expect(screen.getByText(formatMoney(18014398509481986n))).toBeInTheDocument();
    expect(formatMoney(18014398509481986n)).not.toBe(formatMoney(Number("9007199254740993") * 2));
  });

  it("counts distinct departments and scopes stats to one period when unfiltered (REGISTER-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [line({ id: "a", period: "2026-06", employee_count: 10 }), line({ id: "b", period: "2026-07", employee_count: 12 })],
      source: "api",
    });
    render(await PayrollRegisterPage({ searchParams: {} }));
    expect(screen.getByText(/Totals above are for 2026-07/)).toBeInTheDocument();
    // Employees stat is the latest period only (12), never 10+12=22.
    const statValues = Array.from(document.querySelectorAll(".val")).map((n) => n.textContent);
    expect(statValues).toContain("12");
    expect(statValues).not.toContain("22");
    // Departments stat counts distinct departments (1), not rows (2).
    expect(statValues[0]).toBe("1");
  });

  it("shows 'Unassigned' for a null department (REGISTER-06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [line({ department_name: null })], source: "api" });
    render(await PayrollRegisterPage({ searchParams: { period: "2025-06" } }));
    expect(screen.getByText("Unassigned")).toBeInTheDocument();
  });

  it("rejects an invalid period without querying the register (REGISTER-03)", async () => {
    render(await PayrollRegisterPage({ searchParams: { period: "2025-13" } }));
    expect(screen.getByText(/"2025-13" is not a valid period/)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("offers a run picker and an active-filter chip with a clear link (REGISTER-03)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [line({})], source: "api" });
    render(await PayrollRegisterPage({ searchParams: { runId: "11111111-1111-4111-8111-111111111111" } }));
    expect(screen.getByRole("option", { name: "2025-06 · 42 employees" })).toBeInTheDocument();
    expect(screen.getByText("Run: 2025-06")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clear filters" })).toHaveAttribute("href", "/hr/payroll/register");
  });

  it("renders an empty state when there are no register lines", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    render(await PayrollRegisterPage({ searchParams: {} }));
    expect(screen.getByText("No register lines")).toBeInTheDocument();
  });

  it("shows a single error message (no duplicate badge) on failure (REGISTER-06)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    render(await PayrollRegisterPage({ searchParams: {} }));
    expect(screen.getByText("We couldn't load register.")).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  it("denies employee/manager sessions without fetching (REGISTER-05)", async () => {
    rolesMock.mockReturnValue(["employee", "manager"]);
    render(await PayrollRegisterPage({ searchParams: {} }));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(runsMock).not.toHaveBeenCalled();
  });
});
