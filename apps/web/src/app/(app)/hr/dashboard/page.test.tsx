import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

vi.mock("../../../_data/loaders", () => ({
  getHRDashboard: vi.fn(),
  getEmployees: vi.fn(),
  getDashboardLeaveInbox: vi.fn(),
  getMyProfile: vi.fn(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionName: () => null,
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
} from "../../../_data/loaders";

const mockedDash = vi.mocked(getHRDashboard);
const mockedEmp = vi.mocked(getEmployees);
const mockedInbox = vi.mocked(getDashboardLeaveInbox);
const mockedProfile = vi.mocked(getMyProfile);

const DASH_OK = {
  headcount: 245,
  headcountLastMonth: 240,
  attendanceTodayPct: 87,
  pendingLeaves: 3,
  onLeave: 2,
  payrollDue: 0,
  departmentBreakdown: [{ name: "Finance", count: 10 }],
  employeeTypeBreakdown: [],
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

beforeEach(() => {
  mockedDash.mockReset();
  mockedEmp.mockReset();
  mockedInbox.mockReset();
  mockedProfile.mockReset();
  // Sane, all-succeeding defaults -- each test only overrides what it cares about.
  mockedDash.mockResolvedValue({ data: DASH_OK, source: "api" });
  mockedEmp.mockResolvedValue({ data: [EMP_ROW], source: "api" });
  mockedInbox.mockResolvedValue({ data: [] });
  mockedProfile.mockResolvedValue({ data: PROFILE_OK, source: "api" });
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
});
