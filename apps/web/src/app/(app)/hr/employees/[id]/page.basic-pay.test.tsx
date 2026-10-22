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

const BASE = {
  id: "e1", employeeId: "EMP001", name: "Priya Sharma", department: "Finance", designation: "Section Officer",
  joiningDate: "2020-01-15", status: "confirmed", bankAccountNo: null, bankIfsc: null, pan: null,
};

async function renderPage(roles: string[], employee: Record<string, unknown>) {
  mockRoles = roles;
  getEmployeeByIdMock.mockResolvedValue({ data: employee, source: "api" });
  fetchJsonMock.mockImplementation(async (_url: string, fallback: unknown) => ({ data: fallback, source: "api" }));
  const ui = await EmployeeDetailPage({ params: { id: "e1" } });
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

/**
 * GAP-HR-EMPLOYEES-NEW-02: the wizard captures Basic Pay at creation, but the
 * saved record never showed it. The API sends basicMinor (paise) only to the HR
 * roles that can create the record, so the page just renders what it is given.
 */
describe("EmployeeDetailPage basic pay (GAP-HR-EMPLOYEES-NEW-02)", () => {
  beforeEach(() => { getEmployeeByIdMock.mockReset(); fetchJsonMock.mockReset(); });

  it("shows Basic Pay through formatMoney when the API supplies it (paise -> rupees)", async () => {
    await renderPage(["hr_admin"], { ...BASE, basicMinor: 4490000 });
    expect(screen.getByText("Basic Pay")).toBeInTheDocument();
    expect(screen.getByText("₹44,900.00")).toBeInTheDocument();
  });

  it("keeps decimal paise exact (no float rounding)", async () => {
    await renderPage(["hr_admin"], { ...BASE, basicMinor: 4490050 });
    expect(screen.getByText("₹44,900.50")).toBeInTheDocument();
  });

  it("shows a recorded zero as ₹0.00 rather than hiding the row", async () => {
    await renderPage(["hr_admin"], { ...BASE, basicMinor: 0 });
    expect(screen.getByText("₹0.00")).toBeInTheDocument();
  });

  it("shows no Basic Pay row at all when the API did not send it (any non-HR viewer)", async () => {
    await renderPage(["manager"], BASE);
    expect(screen.queryByText("Basic Pay")).not.toBeInTheDocument();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
