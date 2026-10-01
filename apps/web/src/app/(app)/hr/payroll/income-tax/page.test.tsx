import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

// GAP-PAYROLL-INCOME-TAX-02: page now has a role gate (this page previously
// rendered for any /hr role at all, with no backend-DPDP-leak but a
// confusing 403/blank-table experience for manager/employee) -- default to
// an authorized role so the existing content tests below keep exercising
// the real page body; the dedicated gate test overrides this per-call.
const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["payroll_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import IncomeTaxPage from "./page";

function renderPage(ui: React.ReactElement) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

const ROW = {
  id: "d1",
  employee: "Asha Rao",
  department: "Finance",
  grossIncome: "1200000",
  deductions80C: "150000",
  otherDeductions: "0",
  taxableIncome: "1050000",
  taxPayable: "95000",
  status: "submitted",
};

describe("IncomeTaxPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("denies a manager (not in the backend's READER_ROLES) without fetching", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText(/don.t have permission/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("admits a self-service employee (backend scopes them to their own row already)", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
  });

  it("shows a Department column alongside the existing Departments stat", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Department")).toBeInTheDocument();
    expect(screen.getAllByText("Finance").length).toBeGreaterThan(0);
  });

  // GAP-PAYROLL-INCOME-TAX-04: traced against the real backend -- a
  // submitted declaration's status is always "submitted" (never the
  // "finalized"/"completed" literals the old bucket matched against), so it
  // must count under "Finalized", not fall through to Total-only. The pill
  // must also show a translated label, not the raw enum.
  it("shows a translated status label instead of the raw backend enum", async () => {
    fetchJsonMock.mockResolvedValue({ data: [ROW], source: "api" });
    const ui = await IncomeTaxPage();
    renderPage(ui);
    expect(screen.getByText("Submitted")).toBeInTheDocument();
    expect(screen.queryByText("submitted")).not.toBeInTheDocument();
  });
});
