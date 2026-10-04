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
vi.mock("../../../../../_components/EmployeePicker", () => ({ EmployeePicker: () => null }));
const rolesMock = vi.fn(() => ["payroll_admin"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_ADMIN_ROLES: ["payroll_admin", "payroll_officer", "super_admin"],
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import UnassignedPayGroupReportPage from "./page";

function withIntl(ui: React.ReactNode) {
  return <NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>;
}

type Unassigned = { month: string; total: number; data: unknown[] };

function mockApi(unassigned: { data: Unassigned; source: "api" | "error"; status?: number }) {
  fetchJsonMock.mockImplementation(async (path: string) => {
    if (path.includes("/unassigned")) return unassigned;
    // active pay groups
    return { data: [{ id: "g1", name: "Monthly Staff" }], source: "api" };
  });
}

describe("Unassigned pay-group report", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("lists the unassigned employees with a count and a per-row Assign action", async () => {
    mockApi({
      source: "api",
      data: {
        month: "2026-10",
        total: 2,
        data: [
          { employeeId: "e1", employeeNo: "E-1", fullName: "Asha Rao", departmentName: "Finance" },
          { employeeId: "e2", employeeNo: "E-2", fullName: "Ravi Kumar", departmentName: null },
        ],
      },
    });
    render(withIntl(await UnassignedPayGroupReportPage({ searchParams: { month: "2026-10" } })));
    expect(screen.getByText("2 employees are in no pay group.")).toBeInTheDocument();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign Asha Rao to a pay group" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Bulk assign" })).toBeInTheDocument();
    expect(String(fetchJsonMock.mock.calls.find((c) => String(c[0]).includes("/unassigned"))![0])).toContain("month=2026-10");
  });

  it("shows the empty state only when the load succeeded with no rows", async () => {
    mockApi({ source: "api", data: { month: "2026-10", total: 0, data: [] } });
    render(withIntl(await UnassignedPayGroupReportPage({ searchParams: { month: "2026-10" } })));
    expect(screen.getByText("Everyone is in a pay group")).toBeInTheDocument();
  });

  it("shows an error, NOT the empty state, when the load failed", async () => {
    mockApi({ source: "error", status: 500, data: { month: "2026-10", total: 0, data: [] } });
    render(withIntl(await UnassignedPayGroupReportPage({ searchParams: { month: "2026-10" } })));
    expect(screen.queryByText("Everyone is in a pay group")).not.toBeInTheDocument();
    expect(screen.queryByText(/employees are in no pay group/)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("read-only payroll roles see the list but no assign actions", async () => {
    rolesMock.mockReturnValue(["finance_officer"]);
    mockApi({
      source: "api",
      data: { month: "2026-10", total: 1, data: [{ employeeId: "e1", employeeNo: "E-1", fullName: "Asha Rao", departmentName: "Finance" }] },
    });
    render(withIntl(await UnassignedPayGroupReportPage({ searchParams: { month: "2026-10" } })));
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Assign/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Bulk assign" })).not.toBeInTheDocument();
  });

  it("denies roles outside the payroll readers without fetching", async () => {
    rolesMock.mockReturnValue(["employee"]);
    render(withIntl(await UnassignedPayGroupReportPage({})));
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("falls back to the current month for a garbled month param", async () => {
    mockApi({ source: "api", data: { month: "2026-10", total: 0, data: [] } });
    await UnassignedPayGroupReportPage({ searchParams: { month: "not-a-month" } });
    const url = String(fetchJsonMock.mock.calls.find((c) => String(c[0]).includes("/unassigned"))![0]);
    expect(url).toMatch(/month=\d{4}-\d{2}&/);
    expect(url).not.toContain("not-a-month");
  });
});
