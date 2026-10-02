import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getSessionRolesMock = vi.fn();
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import SalarySlipsPage from "./page";

function renderPage(ui: Awaited<ReturnType<typeof SalarySlipsPage>>) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

describe("SalarySlipsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(["payroll_admin"]);
  });

  it("shows PermissionDenied to an employee session and never calls the loader", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    const ui = await SalarySlipsPage({});
    renderPage(ui);
    expect(screen.getByText("Access restricted")).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
  });

  it("renders real totals and the table for a successful fetch", async () => {
    fetchJsonMock.mockResolvedValueOnce({
      data: [
        { id: "s1", employeeId: "e1", employeeName: "Asha", department: "Finance", payPeriod: "2026-08", gross: 10000, deductions: 2000, net: 8000, status: "finalized" },
      ],
      source: "api",
    });
    const ui = await SalarySlipsPage({});
    renderPage(ui);
    // Single-row fixture: the row's own gross equals the page total, so both
    // the stat card and the table cell legitimately show "₹100.00".
    expect(screen.getAllByText("₹100.00").length).toBeGreaterThan(0);
    expect(screen.queryByText("We couldn't load salary slips.")).not.toBeInTheDocument();
  });

  // GAP-PAYROLL-SALARY-SLIPS-01: a failed fetch used to read as good news --
  // StatCards showed real-looking ₹0.00/0 values and the table fell through
  // to its ordinary "no slips yet" empty state, with only the small
  // DataSourceBadge hinting anything was wrong.
  it("shows dashes (not a fabricated ₹0.00/0) and a retryable error instead of the empty state, when the fetch fails", async () => {
    fetchJsonMock.mockResolvedValueOnce({ data: [], source: "error" });
    const ui = await SalarySlipsPage({});
    renderPage(ui);

    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("No salary slips yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4); // all 4 stat cards
    expect(screen.getByText("We couldn't load salary slips.")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-SLIPS-02: a full page (possibly truncated) shows a banner and no money totals", async () => {
    const rows = Array.from({ length: 500 }, (_, i) => ({ id: `s${i}`, employeeId: `e${i}`, employeeName: "A", department: "D", payPeriod: "Aug 2026", gross: 100, deductions: 0, net: 100, status: "finalized" }));
    fetchJsonMock.mockResolvedValueOnce({ data: rows, source: "api" });
    renderPage(await SalarySlipsPage({ searchParams: {} }));
    expect(screen.getByText(/Showing the first 500 slips only/)).toBeInTheDocument();
    expect(screen.getByText("500+")).toBeInTheDocument();
    expect(screen.queryByText("₹50,000.00")).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-SALARY-SLIPS-03: totals cover only the selected pay period (default newest), All periods hides totals", async () => {
    const mk = (id: string, payPeriod: string, gross: number, net: number) => ({ id, employeeId: id, employeeName: id, department: "D", payPeriod, gross, deductions: 0, net, status: "finalized" });
    const data = [mk("a", "Jul 2026", 100000, 90000), mk("b", "Aug 2026", 200000, 150000), mk("c", "Aug 2026", 300000, 250000)];
    fetchJsonMock.mockResolvedValue({ data, source: "api" });
    const { unmount } = renderPage(await SalarySlipsPage({ searchParams: {} }));
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument(); // Aug gross 2000+3000
    expect(screen.getByText("₹4,000.00")).toBeInTheDocument(); // Aug net 1500+2500
    expect(screen.queryByText("₹6,000.00")).not.toBeInTheDocument(); // not Jul+Aug
    unmount();
    renderPage(await SalarySlipsPage({ searchParams: { period: "Jul 2026" } }));
    expect(screen.getByText("₹1,000.00", { selector: ".v, .value, div, p, span" })).toBeInTheDocument();
    cleanup();
    renderPage(await SalarySlipsPage({ searchParams: { period: "all" } }));
    expect(screen.getByText(/hidden for All periods/)).toBeInTheDocument();
    expect(screen.queryByText("₹6,000.00")).not.toBeInTheDocument();
  });
});
