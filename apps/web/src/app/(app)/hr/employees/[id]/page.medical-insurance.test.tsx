import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("../../payroll/pay-groups/payGroupData", () => ({ getEmployeePayGroup: async () => ({ source: "api", data: { current: null, history: [] } }) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, PAYROLL_READER_ROLES: ["payroll_admin"] }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const m = enMessages.medicalInsurance;
const EMP_ID = "8cf7f7eb-1de6-4a31-b48c-1f598ecf33c0";
const EMP = { id: EMP_ID, employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer", joiningDate: "2020-01-15", status: "confirmed" };
const RECORD = {
  employeeId: EMP_ID, schemeType: "cghs", schemeId: null, cardNumber: "**************1234", cardNumberMasked: true,
  decryptFailed: false, validityFrom: "2026-04-01", validityTo: null, tier: null, dependants: [], dependantsCount: 0, annualLimitMinor: null,
};

async function renderPage(roles: string[], insurance: unknown = RECORD) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  fetchJsonMock.mockImplementation(async (u: string, fallback: unknown) =>
    u.startsWith("/api/v1/hrms/medical/insurance") ? { data: insurance, source: "api" } : { data: fallback, source: "api" });
  const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}
const insuranceCalls = () => fetchJsonMock.mock.calls.filter(([u]) => String(u).startsWith("/api/v1/hrms/medical/insurance"));

describe("EmployeeDetailPage medical insurance card", () => {
  beforeEach(() => { fetchJsonMock.mockReset(); getEmployeeByIdMock.mockReset(); });

  it.each([["hr_admin"], ["hr_officer"], ["super_admin"], ["finance_officer"]])("%s sees the card and the edit control", async (role) => {
    await renderPage([role]);
    expect(screen.getByText(m.title)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.editButton })).toBeInTheDocument();
    expect(insuranceCalls()[0]![0]).toBe(`/api/v1/hrms/medical/insurance?employeeId=${EMP_ID}`);
  });

  it("HR with no record on file gets 'add' instead of 'edit'", async () => {
    await renderPage(["hr_admin"], null);
    expect(screen.getByText(m.noRecord)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.addButton })).toBeInTheDocument();
  });

  it("a manager sees the (server-masked) card read-only", async () => {
    await renderPage(["manager"]);
    expect(screen.getByTestId("insurance-card-number")).toHaveTextContent("**************1234");
    expect(screen.queryByRole("button", { name: m.editButton })).not.toBeInTheDocument();
  });

  it("roles the backend would refuse never fetch it and see no card", async () => {
    await renderPage(["payroll_admin"]);
    expect(insuranceCalls()).toHaveLength(0);
    expect(screen.queryByText(m.title)).not.toBeInTheDocument();
  });

  it("a failed read shows 'unavailable' and no edit form (nothing to edit against)", async () => {
    mockRoles = ["hr_admin"];
    getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
    fetchJsonMock.mockImplementation(async (u: string, fallback: unknown) =>
      u.startsWith("/api/v1/hrms/medical/insurance") ? { data: null, source: "error", status: 500 } : { data: fallback, source: "api" });
    const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.getByText(m.unavailable)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.editButton })).not.toBeInTheDocument();
  });
});
