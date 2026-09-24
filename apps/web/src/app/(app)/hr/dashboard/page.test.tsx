import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../../../_data/loaders", () => ({
  getHRDashboard: vi.fn(),
  getEmployees: vi.fn(),
  getDashboardLeaveInbox: vi.fn(),
  getMyProfile: vi.fn(),
  getMyLeaveBalance: vi.fn(),
  getMyAttendance: vi.fn(),
  getMyLeaveApplications: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionName: () => null,
  getSessionRoles: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>{children}</a>
  ),
}));

import HRDashboardPage from "./page";
import {
  getHRDashboard,
  getEmployees,
  getDashboardLeaveInbox,
  getMyProfile,
  getMyLeaveBalance,
  getMyAttendance,
  getMyLeaveApplications,
} from "../../../_data/loaders";
import { getSessionRoles } from "@/lib/auth/roleGuard";

const mockedDash = vi.mocked(getHRDashboard);
const mockedEmp = vi.mocked(getEmployees);
const mockedInbox = vi.mocked(getDashboardLeaveInbox);
const mockedProfile = vi.mocked(getMyProfile);
const mockedBalance = vi.mocked(getMyLeaveBalance);
const mockedAttendance = vi.mocked(getMyAttendance);
const mockedMyApps = vi.mocked(getMyLeaveApplications);
const mockedRoles = vi.mocked(getSessionRoles);

const DASH_OK = {
  headcount: 245,
  headcountLastMonth: 240,
  attendanceTodayPct: 87,
  pendingLeaves: 3,
  onLeave: 2,
  payrollDue: 0,
  departmentBreakdown: [{ name: "Finance", count: 10 }],
  employeeTypeBreakdown: [],
  routingFailedCount: 0,
};

// Same shape fetchJson's `empty` fallback gives getHRDashboard() on a real
// failure (see HR_DASHBOARD_EMPTY in loaders.ts).
const DASH_EMPTY = {
  headcount: 0,
  headcountLastMonth: 0,
  attendanceTodayPct: 0,
  pendingLeaves: 0,
  onLeave: 0,
  payrollDue: 0,
  departmentBreakdown: [],
  employeeTypeBreakdown: [],
  routingFailedCount: 0,
};

const EMP_ROW = { id: "e1", name: "Asha Rao", department: "Finance", status: "confirmed" };

const PROFILE_OK = {
  id: "p1",
  name: "Priya Singh",
  department: "Finance",
  employeeNo: "E1",
  status: "active",
  designation: "Officer",
};

const MY_BALANCE_OK = [
  { leaveTypeId: "lt1", fy: "2026-27", total: 30, balance: 18, used: 12 },
];
const MY_ATTENDANCE_OK = [
  { date: "2026-09-01", status: "present", inTime: "09:00", outTime: "18:00" },
  { date: "2026-09-02", status: "present", inTime: "09:05", outTime: "18:02" },
  { date: "2026-09-03", status: "absent", inTime: null, outTime: null },
];
const MY_APPS_OK = [
  { id: "app1", leaveTypeId: "lt1", fromDate: "2026-09-10", toDate: "2026-09-12", days: 3, status: "pending" },
];

beforeEach(() => {
  mockedDash.mockReset();
  mockedEmp.mockReset();
  mockedInbox.mockReset();
  mockedProfile.mockReset();
  mockedBalance.mockReset();
  mockedAttendance.mockReset();
  mockedMyApps.mockReset();
  mockedRoles.mockReset();
  // Sane, all-succeeding defaults -- each test only overrides what it cares
  // about. Default role is HR-admin so every pre-existing test below (all
  // written against the admin/HR-staff dashboard) keeps exercising exactly
  // that branch with no changes required.
  mockedDash.mockResolvedValue({ data: DASH_OK, source: "api" });
  mockedEmp.mockResolvedValue({ data: [EMP_ROW], source: "api" });
  mockedInbox.mockResolvedValue({ data: [], routingFailed: [] });
  mockedProfile.mockResolvedValue({ data: PROFILE_OK, source: "api" });
  mockedBalance.mockResolvedValue({ data: MY_BALANCE_OK, source: "api" });
  mockedAttendance.mockResolvedValue({ data: MY_ATTENDANCE_OK, source: "api" });
  mockedMyApps.mockResolvedValue({ data: MY_APPS_OK, source: "api" });
  mockedRoles.mockReturnValue(["hr_admin"]);
});

describe("HRDashboardPage", () => {
  it("shows real employee rows and no error banner when every loader succeeds", async () => {
    render(await HRDashboardPage());
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load employees.")).not.toBeInTheDocument();
    expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
  });

  // Regression: the page's own (sr-only) #hr-dash-heading h1 and
  // GreetingHeader's personalized "Good morning, X" banner were both
  // rendered as <h1>, giving the page two competing top-level headings.
  // GreetingHeader's is now an <h2>.
  it("has exactly one h1 on the page", async () => {
    render(await HRDashboardPage());
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
  });

  describe("profile absence is not a page failure", () => {
    // Regression for: a user with no linked employee record (e.g. an
    // admin/test account) got a false "We couldn't load employees" and a
    // false page-level "Couldn't load — showing nothing" banner, even
    // though the employee list itself had genuinely loaded, because
    // profileResult's legitimate 404 kept the page's broad `anyError` flag
    // true and the employee table gated on that broad flag instead of its
    // own empResult.

    it("still shows the real employee table for getMyProfile's normalized 404-as-absence result", async () => {
      // This is the shape getMyProfile() itself now returns for a 404 (see
      // the fix in loaders.ts) -- a legitimate "no linked employee record",
      // not a fetch failure.
      mockedProfile.mockResolvedValue({ data: null, source: "api", status: 404 });
      render(await HRDashboardPage());
      expect(screen.getByText("Asha Rao")).toBeInTheDocument();
      expect(screen.queryByText("We couldn't load employees.")).not.toBeInTheDocument();
    });

    it("does not show the page-level error banner for that same case", async () => {
      mockedProfile.mockResolvedValue({ data: null, source: "api", status: 404 });
      render(await HRDashboardPage());
      expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
    });

    it("keeps the employee table honest even if profileResult itself still comes back source:\"error\" (page-level guard, independent of the loaders.ts normalization)", async () => {
      // Reproduces the exact original bug shape directly at the page level:
      // empResult succeeds, but profileResult is an "error" -- whether from
      // a future regression in getMyProfile's 404 handling, or a genuine
      // non-404 profile failure. Either way the employee table must key off
      // empResult alone, not the page's broader anyError.
      mockedProfile.mockResolvedValue({ data: null, source: "error", status: 404 });
      render(await HRDashboardPage());
      expect(screen.getByText("Asha Rao")).toBeInTheDocument();
      expect(screen.queryByText("We couldn't load employees.")).not.toBeInTheDocument();
    });
  });

  describe("genuine employee-list failure", () => {
    it("still shows the employees error state when empResult itself fails", async () => {
      mockedEmp.mockResolvedValue({ data: [], source: "error" });
      render(await HRDashboardPage());
      expect(screen.getByText("We couldn't load employees.")).toBeInTheDocument();
      expect(screen.queryByText("Asha Rao")).not.toBeInTheDocument();
    });
  });

  describe("genuine dashboard-summary failure", () => {
    it("still renders real employee rows -- only the KPI strip goes honest-blank, not the table", async () => {
      mockedDash.mockResolvedValue({ data: DASH_EMPTY, source: "error" });
      render(await HRDashboardPage());
      // KPI strip honest-blank behaviour itself is HRKPIStrip.test.tsx's
      // job; this just confirms page.tsx still wires hrDashboardFailed
      // through, and -- the actual point of this fix -- that a dashResult
      // failure no longer blanks the unrelated employee table either.
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
      expect(screen.getByText("Asha Rao")).toBeInTheDocument();
      expect(screen.queryByText("We couldn't load employees.")).not.toBeInTheDocument();
    });
  });

  describe("HR-admin routing-failure alert", () => {
    it("surfaces routing-failed leave applications to HR instead of staying silent", async () => {
      mockedInbox.mockResolvedValue({
        data: [],
        routingFailed: [{
          id: "rf1", employeeName: "Kiran Kumar", employeeNo: "E9", departmentName: "IT",
          leaveTypeName: "Earned Leave", leaveTypeCode: "EL", fromDate: "2026-09-01", toDate: "2026-09-02",
          daysApplied: 2, status: "routing_failed",
        }],
      });
      render(await HRDashboardPage());
      // testid, not role="alert": PayrollBanner (always rendered in this
      // branch) is ALSO role="alert", so the role alone is ambiguous here.
      expect(screen.getByTestId("routing-failed-alert")).toHaveTextContent(/could not be routed for approval/i);
      expect(screen.getByText(/Kiran Kumar/)).toBeInTheDocument();
    });

    it("shows no routing-failure alert when there are none", async () => {
      render(await HRDashboardPage());
      expect(screen.queryByText(/could not be routed for approval/i)).not.toBeInTheDocument();
    });
  });

  describe("employee role (non-HR-staff viewer)", () => {
    // The live-audit bug this closes: loading /hr/dashboard as a plain
    // "employee" used to call getHRDashboard()/getEmployees()/
    // getDashboardLeaveInbox() unconditionally -- all three 403 for that
    // role server-side (see hrms-service dashboard/routes.ts's
    // READER_ROLES) -- so every KPI tile and the pending-actions banner
    // went honest-blank on EVERY load, not a degraded case. isHRStaff now
    // gates which loaders even get called.
    beforeEach(() => {
      mockedRoles.mockReturnValue(["employee"]);
    });

    it("never calls the HR-admin-only loaders for a plain employee", async () => {
      render(await HRDashboardPage());
      expect(mockedDash).not.toHaveBeenCalled();
      expect(mockedEmp).not.toHaveBeenCalled();
      expect(mockedInbox).not.toHaveBeenCalled();
    });

    it("renders genuinely useful self-service content with no error banner", async () => {
      render(await HRDashboardPage());
      expect(screen.queryByText("Couldn't load — showing nothing")).not.toBeInTheDocument();
      expect(screen.queryByText(/We couldn't load your pending actions/)).not.toBeInTheDocument();
      // Both the KPI tile ("Leave Balance") and the quick action ("My Leave
      // Balance") legitimately match this text -- getAllByText on purpose.
      expect(screen.getAllByText(/Leave Balance/i).length).toBeGreaterThan(0);
      expect(screen.getByText(/My Leave Applications/i)).toBeInTheDocument();
    });

    it("still has exactly one h1 on the employee-role page", async () => {
      render(await HRDashboardPage());
      expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    });

    it("surfaces a routing_failed request honestly instead of a bare Pending", async () => {
      mockedMyApps.mockResolvedValue({
        data: [{ id: "a9", leaveTypeId: "lt1", fromDate: "2026-09-01", toDate: "2026-09-02", days: 2, status: "routing_failed" }],
        source: "api",
      });
      render(await HRDashboardPage());
      // Both the KPI strip's "My Requests" trend line and the leave-status
      // panel's own status pill mention "needs attention" for the same
      // condition -- getAllByText (not getByText) on purpose, since more
      // than one match here is consistent messaging, not ambiguity.
      expect(screen.getAllByText(/needs attention/i).length).toBeGreaterThan(0);
      expect(screen.queryByText("Pending")).not.toBeInTheDocument();
    });

    it("shows an honest-blank KPI tile, not a fabricated zero, when a self-service loader fails", async () => {
      mockedBalance.mockResolvedValue({ data: [], source: "error" });
      render(await HRDashboardPage());
      expect(screen.getAllByText("—").length).toBeGreaterThan(0);
      expect(screen.getByText("Couldn't load — showing nothing")).toBeInTheDocument();
    });

    it("does not show the admin employee directory table", async () => {
      render(await HRDashboardPage());
      // The admin table's <section> carries aria-label="Recent employees",
      // giving it an implicit "region" role -- absent here means the whole
      // admin-only employee-directory section never rendered.
      expect(screen.queryByRole("region", { name: /recent employees/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("table", { name: /recent employee records/i })).not.toBeInTheDocument();
    });
  });
});
