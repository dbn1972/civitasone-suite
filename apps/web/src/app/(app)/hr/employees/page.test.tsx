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

const DASHBOARD_EMPTY = {
  headcount: 0, onLeave: 0, employeeTypeBreakdown: [] as Array<{ name: string; count: number }>,
};

const DASH_OK = {
  headcount: 3,
  onLeave: 1,
  servingCount: 1,
  employeeTypeBreakdown: [{ name: "permanent", count: 2 }, { name: "intern", count: 1 }],
};

// Non-empty so page.tsx's page-0-empty-roster special case (total forced to
// 0 regardless of headcount) doesn't apply -- that's a different, existing
// behaviour this file isn't testing. dateOfJoining is set so this row
// doesn't also trip GAP-HR-EMPLOYEES-06's Joining Date column into its own
// (unrelated, legitimate) dash for a missing date -- these dash-count
// assertions are about dashboard/employees-fetch error gating only.
const ONE_EMPLOYEE = [{ id: "e1", employeeNo: "E1", name: "Priya Sharma", department: "Finance", status: "confirmed", employeeType: "permanent", dateOfJoining: "2021-06-15" }];

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
    getHRDashboardMock.mockResolvedValue({ data: DASHBOARD_EMPTY, source: "api" });
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-EMPLOYEES-04: search must reach the backend across the whole
  // tenant, not just whatever 50 rows happen to be on the current page.
  describe("server-side search (GAP-HR-EMPLOYEES-04)", () => {
    it("forwards ?q= to getEmployees", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({ q: "Rashmi" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, "Rashmi", undefined);
    });

    it("does not forward an empty search string as a real query", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({});
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined);
    });

    it("finds an employee whose row is on a later server page when searching (regression: used to only ever see the current 50-row page)", async () => {
      getEmployeesMock.mockResolvedValue({
        data: [{ id: "e1", name: "Rashmi Ranjan Das", department: "Finance", status: "confirmed" }],
        source: "api",
      });
      await renderPage({ q: "Rashmi", page: "3" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 150, undefined, "Rashmi", undefined);
      expect(screen.getByText("Rashmi Ranjan Das")).toBeInTheDocument();
    });

    it("renders a Clear link only when a search is active", async () => {
      getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
      await renderPage({ q: "Rashmi" });
      expect(screen.getByRole("link", { name: "Clear" })).toBeInTheDocument();
    });
  });

  it("shows the honest empty state (Total: 0) for a genuinely empty, un-searched roster", async () => {
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({});
    expect(screen.getAllByText("0").length).toBeGreaterThan(0);
  });

  it("does not zero out the total for an empty search result (a real, narrow match set, not an empty roster)", async () => {
    getHRDashboardMock.mockResolvedValue({ data: { ...DASHBOARD_EMPTY, headcount: 214 }, source: "api" });
    getEmployeesMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage({ q: "Nobody Matches This" });
    // "214" appears both in the Total stat card and the "All (214)" tab label.
    expect(screen.getAllByText("214").length).toBeGreaterThan(0);
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
    // Total, Active, OnLeave and Others all derive from the now-failed dashboard fetch.
    // Active (servingCount) is a dashboard aggregate now too (GAP-HR-EMPLOYEES-01), so all four dash out.
    expect(screen.getAllByText("—").length).toBe(4);
  });

  it("does not show dash stats on a genuine successful load", async () => {
    getEmployeesMock.mockResolvedValue({
      // dateOfJoining is set so this row doesn't also trip GAP-HR-EMPLOYEES-06's
      // Joining Date column into its own (unrelated, legitimate) dash for a
      // missing date -- this test is about dashboard/employees-fetch error
      // gating only.
      data: [{ id: "e1", employeeNo: "E1", name: "Priya Sharma", department: "Finance", status: "confirmed", employeeType: "permanent", dateOfJoining: "2021-06-15" }],
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

  /**
   * GAP-HR-EMPLOYEES-01: Active/Others used to be computed from the 50 rows
   * on the current page (and Others subtracted that page count from the
   * tenant total), so the cards changed with ?page=.
   */
  describe("tenant-wide stat cards (GAP-HR-EMPLOYEES-01)", () => {
    const TENANT = { headcount: 214, onLeave: 5, servingCount: 157, employeeTypeBreakdown: [] as Array<{ name: string; count: number }> };
    const cardValue = (label: string) =>
      Array.from(document.querySelectorAll(".stat")).find((el) => el.textContent?.includes(label))?.querySelector(".val")?.textContent;

    it("shows 214 / 157 / 5 / 52 regardless of ?page=", async () => {
      for (const page of ["0", "3"]) {
        getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
        getHRDashboardMock.mockResolvedValue({ data: TENANT, source: "api" });
        const { unmount } = await renderPage({ page });
        expect(cardValue("Total")).toBe("214");
        expect(cardValue("Active")).toBe("157");
        expect(cardValue("On Leave")).toBe("5");
        expect(cardValue("Others")).toBe("52");
        unmount();
      }
    });

    it("shows a dash for Active and Others (not a computed guess) when the backend does not report servingCount", async () => {
      getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
      getHRDashboardMock.mockResolvedValue({ data: { ...TENANT, servingCount: null }, source: "api" });
      await renderPage();
      expect(cardValue("Active")).toBe("—");
      expect(cardValue("Others")).toBe("—");
      expect(cardValue("Total")).toBe("214");
    });
  });

  /**
   * GAP-HR-EMPLOYEES-06: server-side status filter; stats stay tenant-wide.
   */
  describe("status filter (GAP-HR-EMPLOYEES-06)", () => {
    it("forwards a known ?status= to getEmployees and marks that chip current", async () => {
      getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
      getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
      await renderPage({ status: "separated" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, undefined, "separated");
      expect(screen.getByRole("link", { name: "Separated" })).toHaveAttribute("aria-current", "page");
      expect(screen.getByRole("link", { name: "All statuses" })).not.toHaveAttribute("aria-current");
    });

    it("ignores an unknown ?status= value instead of forwarding it", async () => {
      getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
      getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
      await renderPage({ status: "bogus" });
      expect(getEmployeesMock).toHaveBeenCalledWith(50, 0, undefined, undefined, undefined);
    });

    it("keeps the status when switching the type tab", async () => {
      getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
      getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
      await renderPage({ status: "confirmed" });
      expect(screen.getByRole("link", { name: "Intern (1)" })).toHaveAttribute("href", "/hr/employees?type=intern&status=confirmed");
    });
  });

  /** GAP-HR-EMPLOYEES-08: no inline styles on the chip rows. */
  it("renders the chip rows without inline style attributes", async () => {
    getEmployeesMock.mockResolvedValue({ data: ONE_EMPLOYEE, source: "api" });
    getHRDashboardMock.mockResolvedValue({ data: DASH_OK, source: "api" });
    await renderPage();
    const chips = Array.from(document.querySelectorAll("a.chip-link"));
    expect(chips.length).toBeGreaterThan(0);
    expect(chips.every((c) => !c.hasAttribute("style"))).toBe(true);
  });
});
