import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

let mockRoles: string[] = [];
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
}));

import LeaveManagementPage from "./page";

const MOCK_REQUESTS = [
  {
    id: "r1",
    employeeId: "e1",
    employeeName: "Asha Rao",
    leaveType: "Casual Leave",
    fromDate: "2026-10-03",
    toDate: "2026-10-04",
    days: 2,
    status: "pending",
  },
];

// GAP-HR-LEAVE-03: the loader now returns one page + the real total and
// per-status counts over everything the viewer can see.
function pageOf(rows: typeof MOCK_REQUESTS, over: Record<string, unknown> = {}) {
  const statusCounts: Record<string, number> = {};
  for (const r of rows) statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
  return { rows, total: rows.length, hasMore: false, page: 1, pageSize: 100, statusCounts, ...over };
}

async function renderPage(searchParams?: { page?: string }) {
  const page = await LeaveManagementPage({ searchParams: Promise.resolve(searchParams ?? {}) });
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("LeaveManagementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-LEAVE-01
  it("shows the error state, not zero stats or the honest-empty message, on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([]), source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load leave requests.")).toBeInTheDocument();
    expect(screen.queryByText("All clear — no leave requests")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Pending nudge must never render on a failed load, even if stale data existed.
    expect(screen.queryByText("Review now →")).not.toBeInTheDocument();
  });

  it("shows the honest empty state (not the error state) when there genuinely are no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf([]), source: "api" });
    await renderPage();
    expect(screen.getByText("All clear — no leave requests")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load leave requests.")).not.toBeInTheDocument();
  });

  it("renders real stat counts and rows on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
    await renderPage();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0); // total + pending stat
  });

  // GAP-HR-LEAVE-05
  it("renders From/To dates formatted via formatIndianDate, not as a raw ISO string", async () => {
    fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
    await renderPage();
    expect(screen.queryByText("2026-10-03")).not.toBeInTheDocument();
    // formatIndianDate now renders "dd Mon yyyy"; a bare "YYYY-MM-DD" input
    // like fromDate here is formatted literally with no timezone conversion
    // (see formatIndianDate's isBareCalendarDate branch), so this is
    // deterministic regardless of the test runner's local timezone.
    expect(screen.getByText("03 Oct 2026")).toBeInTheDocument();
  });

  // GAP-HR-LEAVE-04: data scoping is entirely server-side now (see
  // leave/routes.ts's resolveLeaveReadScope + repo.findLeaveAppsByTenant);
  // the page trusts whatever getLeaveRequestDetails() returns and only uses
  // roles to decide which nav links/nudges to show.
  it("hides Allocate/Policies links and the pending nudge for a plain employee", async () => {
    mockRoles = ["employee"];
    fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
    await renderPage();
    expect(screen.queryByText("Allocate")).not.toBeInTheDocument();
    expect(screen.queryByText("Policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
    expect(screen.queryByText("Review now →")).not.toBeInTheDocument();
  });

  it("shows Allocate/Policies links and the pending nudge for hr_admin when requests are pending", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
    await renderPage();
    expect(screen.getByText("Allocate")).toBeInTheDocument();
    expect(screen.getByText("Policies")).toBeInTheDocument();
    expect(screen.getByText("Review now →")).toBeInTheDocument();
  });

  // GAP-HR-LEAVE-03: a tenant with more requests than one page used to be
  // silently truncated (default page of 50) with stat tiles counting only the
  // rows that came back and no hint anything was missing.
  describe("pagination (GAP-HR-LEAVE-03)", () => {
    const FIRST_PAGE = pageOf(MOCK_REQUESTS, {
      total: 340, hasMore: true, page: 1, pageSize: 100,
      statusCounts: { pending: 120, approved: 200, rejected: 20 },
    });

    it("asks the loader for the requested page (?page=), defaulting to the first and ignoring junk", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
      await renderPage({ page: "3" });
      expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=200");
      fetchJsonMock.mockClear();
      await renderPage({ page: "abc" });
      expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=0");
      fetchJsonMock.mockClear();
      await renderPage({ page: "-4" });
      expect(String(fetchJsonMock.mock.calls[0]![0])).toContain("offset=0");
    });

    it("stat tiles show the TRUE totals over everything visible, not the length of the fetched page", async () => {
      fetchJsonMock.mockResolvedValue({ data: FIRST_PAGE, source: "api" });
      await renderPage();
      // (the pending count appears twice: its tile and the approver nudge)
      for (const n of ["340", "120", "200", "20"]) expect(screen.getAllByText(n).length).toBeGreaterThan(0);
      expect(screen.getByText(/awaiting approval/i).parentElement?.textContent).toContain("120");
    });

    it("says 'Showing 1-1 of 340' with a Next link (and no Previous) when more requests exist than the page holds", async () => {
      fetchJsonMock.mockResolvedValue({ data: FIRST_PAGE, source: "api" });
      await renderPage();
      expect(screen.getByText("Showing 1–1 of 340 requests")).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Leave requests pages" });
      expect(nav.querySelector('a[rel="next"]')).toHaveAttribute("href", "/hr/leave?page=2");
      expect(nav.querySelector('a[rel="prev"]')).toBeNull();
      expect(screen.getByText(/Search and sort apply to this page only/i)).toBeInTheDocument();
    });

    it("on a later page offers Previous (and Next only while more remain), with the right range", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS, { total: 340, hasMore: false, page: 4, pageSize: 100 }), source: "api" });
      await renderPage({ page: "4" });
      expect(screen.getByText("Showing 301–301 of 340 requests")).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Leave requests pages" });
      expect(nav.querySelector('a[rel="prev"]')).toHaveAttribute("href", "/hr/leave?page=3");
      expect(nav.querySelector('a[rel="next"]')).toBeNull();
    });

    it("shows no pager at all when everything fits on the one page", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
      await renderPage();
      expect(screen.queryByRole("navigation", { name: "Leave requests pages" })).not.toBeInTheDocument();
    });

    it("a page past the end says so (with the real total) and links back, rather than claiming there are no requests", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf([], { total: 340, hasMore: false, page: 9, pageSize: 100 }), source: "api" });
      await renderPage({ page: "9" });
      expect(screen.getByText("There are no requests on this page. 340 requests exist in total.")).toBeInTheDocument();
      const nav = screen.getByRole("navigation", { name: "Leave requests pages" });
      expect(nav.querySelector('a[rel="prev"]')).toHaveAttribute("href", "/hr/leave?page=4");
    });

    it("never shows a pager on a failed load", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf([], { total: 340, page: 2 }), source: "error" });
      await renderPage({ page: "2" });
      expect(screen.queryByRole("navigation", { name: "Leave requests pages" })).not.toBeInTheDocument();
    });
  });

  // GAP-HR-LEAVE-04: the list endpoint scopes a manager to their direct reports
  // (never themselves), so the page tells a manager-only viewer where their own
  // requests are rather than letting the omission look like a bug.
  describe("manager viewing the list (GAP-HR-LEAVE-04)", () => {
    it("tells a manager-only viewer this is their reports' list and links to their own History", async () => {
      mockRoles = ["manager"];
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
      await renderPage();
      expect(screen.getByText(/requests of the people who report to you/i)).toBeInTheDocument();
      const note = screen.getByText(/requests of the people who report to you/i);
      expect(note.querySelector("a")).toHaveAttribute("href", "/hr/leave/history");
    });

    it("does not show that note to HR (who see the whole tenant) or to a plain employee", async () => {
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
      mockRoles = ["hr_admin"];
      const first = await renderPage();
      expect(screen.queryByText(/requests of the people who report to you/i)).not.toBeInTheDocument();
      first.unmount();
      mockRoles = ["employee"];
      await renderPage();
      expect(screen.queryByText(/requests of the people who report to you/i)).not.toBeInTheDocument();
    });

    it("a manager who is also HR is not treated as manager-only", async () => {
      mockRoles = ["manager", "hr_officer"];
      fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
      await renderPage();
      expect(screen.queryByText(/requests of the people who report to you/i)).not.toBeInTheDocument();
    });
  });

  // GAP-HR-LEAVE-POLICIES-01 regression: hr_officer clears this page's own
  // isAdmin gate (HR_ROLES includes hr_officer) but leave-policies/page.tsx
  // and policy-admin-routes.ts only ever admitted hr_admin/super_admin/
  // tenant_admin/platform_admin — hr_officer used to see a "Policies" link
  // that led to a dead-end PermissionDenied screen.
  it("hides the Policies link for hr_officer (sees Allocate — hr_officer IS an allocate-capable HR role) even though it clears the page's own isAdmin gate", async () => {
    mockRoles = ["hr_officer"];
    fetchJsonMock.mockResolvedValue({ data: pageOf(MOCK_REQUESTS), source: "api" });
    await renderPage();
    expect(screen.getByText("Allocate")).toBeInTheDocument();
    expect(screen.queryByText("Policies")).not.toBeInTheDocument();
  });
});
