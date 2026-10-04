import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeeByIdMock = vi.fn();
vi.mock("../../../../_data/loaders", () => ({ getEmployeeById: (...a: unknown[]) => getEmployeeByIdMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles, PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"] }));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import EmployeeDetailPage from "./page";

const EMP = {
  id: "e1", employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer",
  joiningDate: "2020-01-15", status: "confirmed", bankAccountNo: null, bankIfsc: null, pan: null,
  workStateCode: "MH", serviceGrade: "Group-B", maritalStatus: "married", bloodGroup: "O+", shift: "morning",
  costCenterId: "11111111-2222-3333-4444-555555555555",
};

async function renderPage(roles: string[]) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: EMP, source: "api" });
  fetchJsonMock.mockImplementation(async (url: string, fallback: unknown, opts?: { mapResponse?: (p: unknown) => unknown }) => {
    if (url.includes("/finance/cost-centers")) {
      const mapped = opts?.mapResponse?.({ data: [{ id: EMP.costCenterId, code: "CC-IT", name: "IT Infrastructure" }] });
      return { data: mapped, source: "api" };
    }
    return { data: fallback, source: "api" };
  });
  const ui = await EmployeeDetailPage({ params: { id: "e1" } });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("EmployeeDetailPage profile fields (GAP-HR-EMPLOYEES-NEW-01)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); });

  it("shows the persisted service grade, shift, marital status and blood group, with labels not raw codes", async () => {
    await renderPage(["hr_admin"]);
    expect(screen.getByText("Group-B")).toBeInTheDocument();
    expect(screen.getByText("Morning")).toBeInTheDocument();
    expect(screen.getByText("Married")).toBeInTheDocument();
    expect(screen.getByText("O+")).toBeInTheDocument();
  });

  it("shows the state of employment by name, not its code", async () => {
    await renderPage(["hr_admin"]);
    expect(screen.getByText("State of employment (for professional tax)")).toBeInTheDocument();
    expect(screen.getByText("Maharashtra")).toBeInTheDocument();
  });

  it("HR sees the cost centre by NAME, never the raw id", async () => {
    await renderPage(["hr_admin"]);
    expect(screen.getByText("IT Infrastructure")).toBeInTheDocument();
    expect(screen.queryByText(EMP.costCenterId)).not.toBeInTheDocument();
  });

  it("a non-admin viewer (e.g. the employee on their own profile) sees no cost-centre row and no finance lookup is made", async () => {
    await renderPage(["employee"]);
    expect(screen.queryByText("IT Infrastructure")).not.toBeInTheDocument();
    expect(screen.queryByText(EMP.costCenterId)).not.toBeInTheDocument();
    expect(fetchJsonMock.mock.calls.some(([u]) => String(u).includes("cost-centers"))).toBe(false);
  });
});
