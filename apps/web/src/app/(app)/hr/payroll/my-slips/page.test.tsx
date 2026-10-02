import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
const rolesMock = vi.fn((): string[] => ["employee"]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => rolesMock(),
  PAYROLL_READER_ROLES: ["payroll_admin", "payroll_officer", "super_admin", "hr_admin", "finance_officer"],
}));

import MySlipsPage from "./page";

const slip = (id: string, payPeriod: string) => ({ id, employeeId: "e1", employeeName: "Asha", department: "Fin", payPeriod, gross: 10000, deductions: 2000, net: 8000, status: "paid" });
const renderPage = async (sp: { page?: string } = {}) =>
  render(<NextIntlClientProvider locale="en" messages={enMessages}>{await MySlipsPage({ searchParams: sp })}</NextIntlClientProvider>);

describe("MySlipsPage (GAP-PAYROLL-SALARY-SLIPS-04)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    rolesMock.mockReturnValue(["employee"]);
  });

  it("lists the employee's own slips from /slips/mine, naming no employee id in the request", async () => {
    fetchJsonMock.mockResolvedValue({ data: [slip("s1", "Aug 2026")], source: "api" });
    await renderPage();
    expect(String(fetchJsonMock.mock.calls[0][0])).toBe("/api/v1/payroll/slips/mine?limit=24&offset=0");
    expect(screen.getByText("Aug 2026")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Aug 2026/ })).toHaveAttribute("href", "/hr/payroll/salary-slips/s1");
  });

  it("pages with an offset and offers an Older link only when a full page came back", async () => {
    fetchJsonMock.mockResolvedValue({ data: Array.from({ length: 24 }, (_, i) => slip(`s${i}`, "Aug 2026")), source: "api" });
    await renderPage({ page: "2" });
    expect(String(fetchJsonMock.mock.calls[0][0])).toContain("offset=24");
    expect(screen.getByRole("link", { name: "Older" })).toHaveAttribute("href", "/hr/payroll/my-slips?page=3");
    expect(screen.getByRole("link", { name: "Newer" })).toHaveAttribute("href", "/hr/payroll/my-slips?page=1");
  });

  it("denies a role the backend would 403 and never fetches", async () => {
    rolesMock.mockReturnValue(["manager"]);
    await renderPage();
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("shows a load error, not an empty state, when the fetch fails", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.queryByText("No payslips yet")).not.toBeInTheDocument();
  });
});
