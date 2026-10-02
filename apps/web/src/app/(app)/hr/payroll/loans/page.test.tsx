import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const getSessionRolesMock = vi.fn<() => string[]>();
const getSessionUserIdMock = vi.fn<() => string | null>();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
  getSessionUserId: () => getSessionUserIdMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
}));

import LoansPage from "./page";

const EMP_ID = "11111111-1111-4111-8111-111111111111";
const ME = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// UX-017: LoansPage (Server Component, getTranslations("payrollLoans")) also
// renders LoanSearchForm/CreateLoanForm/LoansTable, "use client" components
// that call useTranslations(...) -- so every render needs a real
// NextIntlClientProvider in the tree, same pattern as
// hr/payroll/disbursement/page.test.tsx (tranche 9).
function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

type Loan = { id: string; loanNo: string; loanType: string; principalMinor: string; outstandingMinor: string; emiMinor: string; tenureMonths: number; status: string; createdBy?: string };

let scheduleResult: { payload: unknown; source: "api" | "error" } | null = null;

function mockApi(loans: Loan[] | "error", employees: unknown[] = [{ id: EMP_ID, name: "Asha Rao", employeeNo: "EMP-001", department: "Finance" }]) {
  fetchJsonMock.mockImplementation(async (url: string, _fallback: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) => {
    if (url.startsWith("/api/v1/hrms/employees")) {
      return { data: opts?.mapResponse ? opts.mapResponse({ data: employees }) ?? [] : employees, source: "api" };
    }
    if (url.includes("/schedule")) {
      return scheduleResult
        ? { data: opts?.mapResponse ? opts.mapResponse(scheduleResult.payload) ?? [] : [], source: scheduleResult.source }
        : { data: [], source: "api" };
    }
    if (loans === "error") return { data: [], source: "error" };
    return { data: loans, source: "api" };
  });
}

const loan = (over: Partial<Loan>): Loan => ({
  id: "l1", loanNo: "LN-1", loanType: "personal", principalMinor: "100000", outstandingMinor: "50000",
  emiMinor: "10000", tenureMonths: 10, status: "applied", createdBy: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", ...over,
});

describe("LoansPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    scheduleResult = null;
    getSessionRolesMock.mockReturnValue(["payroll_officer"]);
    getSessionUserIdMock.mockReturnValue(ME);
  });

  it("prompts for an employee search when no empId is given, without fabricating data", async () => {
    const ui = await LoansPage({ searchParams: {} });
    renderPage(ui);

    expect(screen.getByText("Search for an employee to see their loans")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders loans for the searched employee and names that employee (GAP-PAYROLL-LOANS-01)", async () => {
    mockApi([loan({})]);

    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);

    expect(screen.getByText("LN-1")).toBeInTheDocument();
    expect(screen.getByText("Loans — Asha Rao (EMP-001)")).toBeInTheDocument();
    expect(screen.queryByText(new RegExp(EMP_ID))).not.toBeInTheDocument();
    expect(screen.queryByText(/UUID/)).not.toBeInTheDocument();
  });

  it("says when the employee's name cannot be resolved instead of guessing", async () => {
    mockApi([loan({})], []);
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.getByText("Loans — employee name unavailable")).toBeInTheDocument();
  });

  it("shows the error data-source badge when the API fails for a searched employee", async () => {
    mockApi("error");

    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);

    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("computes stats over active loans only for a mixed-status fixture (GAP-PAYROLL-LOANS-03)", async () => {
    mockApi([
      loan({ id: "a", loanNo: "LN-A", status: "applied", outstandingMinor: "500000", emiMinor: "50000" }),
      loan({ id: "b", loanNo: "LN-B", status: "disbursed", outstandingMinor: "300000", emiMinor: "25000" }),
      loan({ id: "c", loanNo: "LN-C", status: "closed", outstandingMinor: "0", emiMinor: "40000" }),
    ]);
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);

    const stat = (label: string) => screen.getByText(label).closest(".stat") as HTMLElement;
    expect(within(stat("Active (disbursed)")).getByText("1")).toBeInTheDocument();
    expect(within(stat("Pending disbursement")).getByText("1")).toBeInTheDocument();
    expect(within(stat("Monthly EMI (active loans)")).getByText("₹250.00")).toBeInTheDocument();
    expect(within(stat("Outstanding (active loans)")).getByText("₹3,000.00")).toBeInTheDocument();
  });

  it("gives a payroll officer the create form and Disburse actions", async () => {
    mockApi([loan({})]);
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.getByRole("button", { name: "Create Loan" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Disburse loan LN-1" })).toBeInTheDocument();
  });

  it("gives hr_admin a read-only view: no create form, no Disburse (GAP-PAYROLL-LOANS-02)", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockApi([loan({})]);
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.getByText("LN-1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Loan" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Disburse/ })).not.toBeInTheDocument();
  });

  it("shows PermissionDenied to a manager-only session and fetches nothing (GAP-PAYROLL-LOANS-02)", async () => {
    getSessionRolesMock.mockReturnValue(["manager", "employee"]);
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.queryByRole("button", { name: "Create Loan" })).not.toBeInTheDocument();
    expect(screen.queryByText("LN-1")).not.toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("GAP-PAYROLL-LOANS-06: no permanent empty 'schedule' card before an employee is searched", async () => {
    const ui = await LoansPage({ searchParams: {} });
    renderPage(ui);
    expect(screen.queryByText(/Recovery Schedule/)).not.toBeInTheDocument();
    expect(screen.queryByText("Recovery schedule not yet available")).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("/schedule"))).toBe(false);
  });

  it("GAP-PAYROLL-LOANS-06: shows the real per-installment schedule for the employee's live loan, fetched by that loan's id", async () => {
    mockApi([loan({ id: "other", loanNo: "LN-0", status: "closed" }), loan({ id: "live", loanNo: "LN-9", status: "active" })]);
    scheduleResult = {
      source: "api",
      payload: { schedule: [{ installmentNo: 1, openingMinor: 100000, emiMinor: 60000, principalMinor: 59000, interestMinor: 1000, closingMinor: 41000 }] },
    };
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.getByText("Recovery Schedule — LN-9")).toBeInTheDocument();
    expect(screen.getByText("₹410.00")).toBeInTheDocument();
    const scheduleCalls = fetchJsonMock.mock.calls.filter(([u]) => String(u).includes("/schedule"));
    expect(scheduleCalls).toHaveLength(1);
    expect(String(scheduleCalls[0][0])).toBe("/api/v1/payroll/loans/live/schedule");
  });

  it("GAP-PAYROLL-LOANS-06: a loanId that is not one of the employee's loans is ignored", async () => {
    mockApi([loan({ id: "mine", loanNo: "LN-1", status: "active" })]);
    scheduleResult = { source: "api", payload: { schedule: [] } };
    await LoansPage({ searchParams: { empId: EMP_ID, loanId: "someone-elses" } });
    const scheduleCalls = fetchJsonMock.mock.calls.filter(([u]) => String(u).includes("/schedule"));
    expect(String(scheduleCalls[0][0])).toBe("/api/v1/payroll/loans/mine/schedule");
  });

  it("GAP-PAYROLL-LOANS-06: a failed schedule load shows a load error, not an empty schedule", async () => {
    mockApi([loan({ id: "live", status: "active" })]);
    scheduleResult = { source: "error", payload: null };
    const ui = await LoansPage({ searchParams: { empId: EMP_ID } });
    renderPage(ui);
    expect(screen.queryByText("No installments")).not.toBeInTheDocument();
  });
});
