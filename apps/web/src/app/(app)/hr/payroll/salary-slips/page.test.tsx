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
    const ui = await SalarySlipsPage();
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
    const ui = await SalarySlipsPage();
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
    const ui = await SalarySlipsPage();
    renderPage(ui);

    expect(screen.queryByText("₹0.00")).not.toBeInTheDocument();
    expect(screen.queryByText("No salary slips yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(4); // all 4 stat cards
    expect(screen.getByText("We couldn't load salary slips.")).toBeInTheDocument();
  });
});
