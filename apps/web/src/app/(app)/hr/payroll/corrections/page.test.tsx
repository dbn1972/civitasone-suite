import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
let sessionRoles: string[] = ["payroll_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => sessionRoles,
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));
vi.mock("@/lib/entityAdapters/employee", () => ({
  searchEmployees: vi.fn(async () => []),
  resolveEmployees: vi.fn(async () => []),
}));

import CorrectionsPage from "./page";

const E1 = "55555555-5555-4555-8555-555555555501";

// UX-017: CorrectionsPage is a server component, but it renders
// CreateCorrectionForm (a client component using useTranslations), so the
// rendered tree needs a real NextIntlClientProvider.
async function renderPage() {
  const ui = await CorrectionsPage();
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

function withDirectory(corrections: { data: unknown; source: string }, names: unknown[] = []) {
  fetchJsonMock.mockImplementation((path: string) =>
    Promise.resolve(path.startsWith("/api/v1/hrms/employees") ? { data: names, source: "api" } : corrections),
  );
}

const ROW = {
  id: "c1",
  employee_id: E1,
  component: "BASIC",
  effective_from: "2025-04-01",
  old_value_minor: 4000000,
  new_value_minor: 4500000,
  arrears_minor: 1500000,
  affected_periods: 3,
  reason: "Pay fixation per 7th CPC order",
  status: "pending",
  created_at: "2025-06-01T00:00:00Z",
};

describe("CorrectionsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    sessionRoles = ["payroll_admin"];
  });

  it("shows employee names and the recorded reason (GAP-PAYROLL-CORRECTIONS-02/04)", async () => {
    withDirectory({ data: [ROW], source: "api" }, [[E1, { name: "Kavita Nair", employeeNo: "EMP-11" }]]);
    await renderPage();
    expect(screen.getByText("Kavita Nair (EMP-11)")).toBeInTheDocument();
    expect(screen.queryByText(E1)).not.toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "BASIC" })).toBeInTheDocument();
    expect(screen.getByText("Pay fixation per 7th CPC order")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /Reason/ })).toBeInTheDocument();
    expect(screen.getByText("Record Salary Correction")).toBeInTheDocument();
  });

  it("renders an empty state when there are no corrections", async () => {
    withDirectory({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No salary corrections yet")).toBeInTheDocument();
  });

  it("shows the saved-information badge when the source is error", async () => {
    withDirectory({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-CORRECTIONS-05: an employee gets Access restricted, no fetch, no form", async () => {
    sessionRoles = ["employee"];
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByText("Record Salary Correction")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-CORRECTIONS-05: a read-only payroll reader sees history but no form", async () => {
    sessionRoles = ["hr_admin"];
    withDirectory({ data: [ROW], source: "api" });
    await renderPage();
    expect(screen.getByRole("cell", { name: "BASIC" })).toBeInTheDocument();
    expect(screen.queryByText("Record Salary Correction")).not.toBeInTheDocument();
  });
});
