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

async function renderPage() {
  const page = await LeaveManagementPage();
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{page}</NextIntlClientProvider>);
}

describe("LeaveManagementPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    mockRoles = ["hr_admin"];
  });

  // GAP-HR-LEAVE-01
  it("shows the error state, not zero stats or the honest-empty message, on a real fetch failure", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load leave requests.")).toBeInTheDocument();
    expect(screen.queryByText("All clear — no leave requests")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    // Pending nudge must never render on a failed load, even if stale data existed.
    expect(screen.queryByText("Review now →")).not.toBeInTheDocument();
  });

  it("shows the honest empty state (not the error state) when there genuinely are no requests", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("All clear — no leave requests")).toBeInTheDocument();
    expect(screen.queryByText("We couldn't load leave requests.")).not.toBeInTheDocument();
  });

  it("renders real stat counts and rows on success", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await renderPage();
    expect(screen.getByText("Asha Rao")).toBeInTheDocument();
    expect(screen.getAllByText("1").length).toBeGreaterThan(0); // total + pending stat
  });

  // GAP-HR-LEAVE-05
  it("renders From/To dates formatted via formatIndianDate, not as a raw ISO string", async () => {
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await renderPage();
    expect(screen.queryByText("2026-10-03")).not.toBeInTheDocument();
    // Computed the same way formatIndianDate does (locale-formatted, no
    // fixed TZ) rather than hardcoded, so this doesn't depend on the test
    // runner's local timezone matching IST.
    const expected = new Date("2026-10-03").toLocaleDateString("en-IN", { day: "2-digit", month: "2-digit", year: "numeric" });
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  // GAP-HR-LEAVE-04: data scoping is entirely server-side now (see
  // leave/routes.ts's resolveLeaveReadScope + repo.findLeaveAppsByTenant);
  // the page trusts whatever getLeaveRequestDetails() returns and only uses
  // roles to decide which nav links/nudges to show.
  it("hides Allocate/Policies links and the pending nudge for a plain employee", async () => {
    mockRoles = ["employee"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await renderPage();
    expect(screen.queryByText("Allocate")).not.toBeInTheDocument();
    expect(screen.queryByText("Policies")).not.toBeInTheDocument();
    expect(screen.queryByText("Approvals")).not.toBeInTheDocument();
    expect(screen.queryByText("Review now →")).not.toBeInTheDocument();
  });

  it("shows Allocate/Policies links and the pending nudge for hr_admin when requests are pending", async () => {
    mockRoles = ["hr_admin"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await renderPage();
    expect(screen.getByText("Allocate")).toBeInTheDocument();
    expect(screen.getByText("Policies")).toBeInTheDocument();
    expect(screen.getByText("Review now →")).toBeInTheDocument();
  });

  // GAP-HR-LEAVE-POLICIES-01 regression: hr_officer clears this page's own
  // isAdmin gate (HR_ROLES includes hr_officer) but leave-policies/page.tsx
  // and policy-admin-routes.ts only ever admitted hr_admin/super_admin/
  // tenant_admin/platform_admin — hr_officer used to see a "Policies" link
  // that led to a dead-end PermissionDenied screen.
  it("hides the Policies link for hr_officer (sees Allocate — hr_officer IS an allocate-capable HR role) even though it clears the page's own isAdmin gate", async () => {
    mockRoles = ["hr_officer"];
    fetchJsonMock.mockResolvedValue({ data: MOCK_REQUESTS, source: "api" });
    await renderPage();
    expect(screen.getByText("Allocate")).toBeInTheDocument();
    expect(screen.queryByText("Policies")).not.toBeInTheDocument();
  });
});
