import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// M2/M7: the employee profile must not issue the payroll-service pay-group request, nor show payroll
// cards/links, for a tenant whose module list has no Payroll. With Payroll on, or the list unknown, it is unchanged.
let enabled: string[] | null = null;
vi.mock("@/lib/moduleVisibility", () => ({ getEnabledModules: async () => enabled }));
const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const payGroupMock = vi.fn();
vi.mock("../../payroll/pay-groups/payGroupData", () => ({ getEmployeePayGroup: (...a: unknown[]) => payGroupMock(...a) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const EMP = { id: EMP_ID, employeeId: "UATG1-25595", name: "Asha Verma", department: "Finance", designation: "Clerk", joiningDate: "2026-10-28", status: "confirmed", pensionScheme: "EPF", statutoryIncomplete: [] };

async function renderPage(roles: string[]) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  payGroupMock.mockResolvedValue({ source: "api", data: { current: null, history: [] } });
  fetchJsonMock.mockImplementation(async (_u: string, fallback: unknown) => ({ data: fallback, source: "api" }));
  const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
  const view = render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
  return view.container;
}

const slipsLink = (c: HTMLElement) => c.querySelector(`a[href^="/hr/payroll/salary-slips"]`);

describe("EmployeeDetailPage Payroll switch (M2/M7)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); payGroupMock.mockReset(); enabled = null; });

  it("HR-only tenant (no payroll key): no pay-group request, no salary-slips link, no pay-group card", async () => {
    enabled = ["workforce_core", "hrms-leave", "hrms-payroll", "hrms-training"];
    const c = await renderPage(["hr_admin"]);
    expect(payGroupMock).not.toHaveBeenCalled();
    expect(slipsLink(c)).toBeNull();
    expect(fetchJsonMock.mock.calls.some((x) => String(x[0]).includes("/payroll"))).toBe(false);
  });

  it("tenant with Payroll on: the pay-group request is issued and the link shows", async () => {
    enabled = ["workforce_core", "hrms-leave", "payroll"];
    const c = await renderPage(["hr_admin"]);
    expect(payGroupMock).toHaveBeenCalledWith(EMP_ID);
    expect(slipsLink(c)).not.toBeNull();
  });

  it("unknown module list: unchanged (request issued, link shows)", async () => {
    enabled = null;
    const c = await renderPage(["hr_admin"]);
    expect(payGroupMock).toHaveBeenCalledTimes(1);
    expect(slipsLink(c)).not.toBeNull();
  });

  it("legacy blanket hrms key: unchanged (request issued, link shows)", async () => {
    enabled = ["hrms", "finance"];
    const c = await renderPage(["hr_admin"]);
    expect(payGroupMock).toHaveBeenCalledTimes(1);
    expect(slipsLink(c)).not.toBeNull();
  });

  it("super_admin bypass: still issued on a tenant without Payroll", async () => {
    enabled = ["hrms-leave"];
    await renderPage(["super_admin"]);
    expect(payGroupMock).toHaveBeenCalledTimes(1);
  });
});
