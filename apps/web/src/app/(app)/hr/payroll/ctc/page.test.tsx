import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_REPORT_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin"],
}));

import CtcConfigPage from "./page";

async function renderPage() {
  const ui = await CtcConfigPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("CtcConfigPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("renders configured CTC components", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "c1", component_code: "BASIC", component_name: "Basic Salary", calc_type: "pct_of_ctc", value: "40.0000", is_employer_cost: false, is_active: true },
        { id: "c2", component_code: "ER_PF", component_name: "Employer PF", calc_type: "pct_of_basic", value: "12.0000", is_employer_cost: true, is_active: true },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Basic Salary")).toBeInTheDocument();
    expect(screen.getByText("Employer PF")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  it("formats only fixed values as money (paise) and never puts ₹ on a formula (CTC-03)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "c1", component_code: "CONV", component_name: "Conveyance", calc_type: "fixed", value: "1500000.0000", is_employer_cost: false, is_active: true },
        { id: "c2", component_code: "BONUS", component_name: "Bonus", calc_type: "formula", value: "1.5000", is_employer_cost: false, is_active: true },
      ],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("₹15,000.00")).toBeInTheDocument();
    expect(screen.getByText("Formula: 1.5")).toBeInTheDocument();
    expect(screen.queryByText("₹0.02")).not.toBeInTheDocument();
  });

  it("no longer shows an 'Active Components' KPI the table can't reconcile (CTC-01)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.queryByText("Active Components")).not.toBeInTheDocument();
    expect(screen.getByText("Fixed-Amount")).toBeInTheDocument();
  });

  it("renders an empty state without leaking a table name (CTC-05)", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No CTC configuration found")).toBeInTheDocument();
    expect(screen.queryByText(/payroll_ctc_config/)).not.toBeInTheDocument();
  });

  it("denies roles the CTC endpoints reject, without fetching (COMPARISON-03 sibling gate)", async () => {
    rolesMock.mockReturnValue(["employee"]);
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });
});
