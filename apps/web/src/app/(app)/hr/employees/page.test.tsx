import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const getEmployeesMock = vi.fn();
const getHRDashboardMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({
  getEmployees: (...args: unknown[]) => getEmployeesMock(...args),
  getHRDashboard: (...args: unknown[]) => getHRDashboardMock(...args),
}));

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import EmployeeDirectoryPage from "./page";

const DASH_OK = {
  headcount: 3,
  onLeave: 1,
  employeeTypeBreakdown: [{ name: "permanent", count: 2 }, { name: "intern", count: 1 }],
};

// Non-empty so page.tsx's page-0-empty-roster special case (total forced to
// 0 regardless of headcount) doesn't apply -- that's a different, existing
// behaviour this file isn't testing.
const ONE_EMPLOYEE = [{ id: "e1", employeeNo: "E1", name: "Priya Sharma", department: "Finance", status: "confirmed", employeeType: "permanent" }];

async function renderPage(searchParams?: Record<string, string>) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await EmployeeDirectoryPage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

describe("EmployeeDirectoryPage", () => {
  beforeEach(() => {
    getEmployeesMock.mockReset();
    getHRDashboardMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  /**
   * GAP-HR-EMPLOYEES-02: a real fetch failure must not read as "0 of
   * everything" — that's indistinguishable from a genuinely empty tenant.
   * Total/Active/Others all depend (directly, or via the total/others
   * arithmetic) on the failed employees fetch, so all three dash out. Since
   * the dashboard fetch independently succeeded here, OnLeave -- which is
   * derived only from the dashboard, never from the employees list -- must
   * still show its real fetched value rather than blanking out just
   * because a *different* fetch failed (see the dashboard-only-failure test
   * below for the mirror case). onLeave is deliberately non-zero here so
   * the "no fabricated zero" check below isn't vacuously satisfied by its
   * own legitimate value.
   */
  it("shows dash stats, not fabricated zeros, when the employees fetch errors", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "error" });
    getHRDashboardMock.mockResolvedValue({ data: { headcount: 0, onLeave: 2, employeeTypeBreakdown: [] }, source: "api" });
    await renderPage();
    expect(screen.getAllByText("—").length).toBe(3);
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-02 (dashboard-only failure sub-case): getEmployees()
   * and getHRDashboard() are independent fetches, so a failure confined to
   * the dashboard call must be just as visible as an employees-fetch
   * failure -- not silently absorbed. Before this fix only the
   * employees-fetch `source` was captured, so a dashboard-only error fell
   * back to displaying the current page's row count as Total/Others
   * (hrDashboard.headcount defaults to 0 on error, so
   * `hrDashboard.headcount || employees.length` resolves to
   * `employees.length`) and 0 as OnLeave -- both rendered as if they were
   * real tenant-wide numbers, with zero error indication.
   */
  it("shows dash for dashboard-derived stats, not a page-count fallback, when only the dashboard fetch errors", async () => {
    getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: { headcount: 0, onLeave: 0, employeeTypeBreakdown: [] }, source: "error" });
    await renderPage();
    // Total, OnLeave, and Others all derive (directly, or via the total/others
    // arithmetic) from the now-failed dashboard fetch, so all three dash out.
    expect(screen.getAllByText("—").length).toBe(3);
    // Active is derived only from the (successfully-fetched) employees page,
    // so it must still show its real count rather than dashing out too.
    expect(screen.getByText("1")).toBeInTheDocument();
  });

  it("does not show dash stats on a genuine successful load", async () => {
    getEmployeesMock.mockResolvedValue({
      data: [{ id: "e1", employeeNo: "E1", name: "Priya Sharma", department: "Finance", status: "confirmed", employeeType: "permanent" }],
      source: "api",
    });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage();
    expect(screen.queryAllByText("—").length).toBe(0);
  });

  /**
   * GAP-HR-EMPLOYEES-03 / GAP-HR-EMPLOYEES-IMPORT-06: bulk import existed
   * but had no link to it anywhere in the app.
   */
  it("shows an Import link next to Add Employee for an admin role", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage();
    const importLink = screen.getByRole("link", { name: "Import" });
    expect(importLink).toHaveAttribute("href", "/hr/employees/import");
  });

  it("shows neither Import nor Add Employee for a role outside EMPLOYEE_ADMIN_ROLES", async () => {
    mockRoles = ["manager"];
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage();
    expect(screen.queryByRole("link", { name: "Import" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Add Employee" })).not.toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-05: tabs used to be a fixed 4-entry array that could
   * never represent a tenant-defined type like "intern".
   */
  it("builds a type tab (with its real count) for a tenant-defined employee type", async () => {
    getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage();
    expect(screen.getByRole("link", { name: "Intern (1)" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Permanent (2)" })).toBeInTheDocument();
  });

  /**
   * GAP-HR-EMPLOYEES-08 (partial): the active chip must expose
   * aria-current so assistive tech announces which tab is selected.
   */
  it("marks the active type tab with aria-current=page", async () => {
    getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage({ type: "permanent" });
    expect(screen.getByRole("link", { name: "Permanent (2)" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "All (3)" })).not.toHaveAttribute("aria-current");
  });
});
