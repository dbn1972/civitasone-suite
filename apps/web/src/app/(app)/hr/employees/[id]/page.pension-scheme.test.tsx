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
const EMP = { id: EMP_ID, employeeId: "UATG1-25595", name: "Contract Staff", department: "Finance", designation: "Clerk", joiningDate: "2026-10-28", status: "confirmed", pensionScheme: "EPF", statutoryIncomplete: ["UAN_MISSING"] };
const PENDING = { id: "c1", fromScheme: "NPS", toScheme: "EPF", effectiveFrom: "2027-02-01", reason: "Contract staff are EPF members", status: "pending" };
const m = enMessages.pensionSchemeChange;

async function renderPage(roles: string[], emp: Record<string, unknown> = EMP) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: emp, source: "api" });
  payGroupMock.mockResolvedValue({ source: "api", data: { current: null, history: [] } });
  fetchJsonMock.mockImplementation(async (u: string, fallback: unknown, o: { mapResponse?: (p: unknown) => unknown }) =>
    u.includes("/pension-scheme-changes") ? { data: o.mapResponse!({ data: [PENDING] }), source: "api" } : { data: fallback, source: "api" });
  const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("EmployeeDetailPage pension scheme card (UAT b18)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); });

  it("hr_admin sees the scheme, the UAN warning and can decide the pending change", async () => {
    await renderPage(["hr_admin"]);
    expect(screen.getByText(m.title)).toBeInTheDocument();
    expect(screen.getByText(m.schemes.EPF)).toBeInTheDocument();
    expect(screen.getByText(m.uanMissingWarning)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: m.approveButton })).toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]) === `/api/v1/hrms/employees/${EMP_ID}/pension-scheme-changes`)).toBe(true);
  });

  it("hr_officer sees the card (maker) but cannot approve or reject", async () => {
    await renderPage(["hr_officer"]);
    expect(screen.getByText(m.title)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: m.approveButton })).toBeNull();
  });

  it("a manager gets no pension scheme card and the history is not fetched", async () => {
    await renderPage(["manager"]);
    expect(screen.queryByText(m.title)).toBeNull();
    expect(fetchJsonMock.mock.calls.some((c) => String(c[0]).includes("/pension-scheme-changes"))).toBe(false);
  });

  it("an exited employee cannot be given a new scheme from the page", async () => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
    getEmployeeByIdMock.mockResolvedValue({ data: { ...EMP, status: "separated" }, source: "api" });
    payGroupMock.mockResolvedValue({ source: "api", data: { current: null, history: [] } });
    fetchJsonMock.mockImplementation(async (_u: string, fallback: unknown) => ({ data: fallback, source: "api" }));
    const ui = await EmployeeDetailPage({ params: Promise.resolve({ id: EMP_ID }) });
    render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
    expect(screen.queryByRole("button", { name: m.changeButton })).toBeNull();
  });
});
