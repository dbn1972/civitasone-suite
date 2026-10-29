import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const payGroupMock = vi.fn();
vi.mock("../../payroll/pay-groups/payGroupData", () => ({ getEmployeePayGroup: (...a: unknown[]) => payGroupMock(...a) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const EMP = { id: EMP_ID, employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer", joiningDate: "2020-01-15", status: "confirmed" };

async function renderPage(roles: string[]) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  payGroupMock.mockResolvedValue({ source: "api", data: { current: null, history: [] } });
  fetchJsonMock.mockImplementation(async (_u: string, fallback: unknown) => ({ data: fallback, source: "api" }));
  const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const card = () => screen.queryByText(enMessages.employeeLoginLink.title);

describe("EmployeeDetailPage login-link card: hr_admin / super_admin only (FQ14)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); });

  it.each([["hr_admin"], ["super_admin"]])("%s sees the Login link card", async (role) => {
    await renderPage([role]);
    expect(card()).toBeInTheDocument();
    expect(screen.getByRole("button", { name: enMessages.employeeLoginLink.linkButton })).toBeInTheDocument();
  });

  it("hr_officer still opens and administers the page but gets no Login link card", async () => {
    await renderPage(["hr_officer"]);
    expect(screen.getByText("Priya Sharma")).toBeInTheDocument();
    expect(card()).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: enMessages.employeeLoginLink.linkButton })).not.toBeInTheDocument();
  });

  it("a manager gets no Login link card", async () => {
    await renderPage(["manager"]);
    expect(card()).not.toBeInTheDocument();
  });
});
