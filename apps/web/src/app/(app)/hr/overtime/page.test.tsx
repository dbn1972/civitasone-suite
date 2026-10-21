import { describe, it, expect, vi, beforeEach } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const { getSessionRolesMock } = vi.hoisted(() => ({ getSessionRolesMock: vi.fn(() => ["hr_admin"]) }));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: getSessionRolesMock,
}));

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

import OvertimePage from "./page";
import { mapOvertime, type ApiOTRequest } from "./mapOvertime";

const MOCK_OT: ApiOTRequest[] = [
  { id: "o1", employeeId: "e1", employeeName: "A. Kumar", employeeNo: "E-1", requestDate: "2026-08-10", hoursRequested: "3", reason: "Budget report", status: "pending", approvedBy: null, approvedAt: null },
  { id: "o2", employeeId: "e2", employeeName: "B. Rao", employeeNo: "E-2", requestDate: "2026-08-09", hoursRequested: "2", reason: "System migration", status: "approved", approvedBy: "mgr1", approvedAt: "2026-08-10" },
];

/**
 * GAP-HR-OVERTIME-04: fetchJson itself is mocked in this suite (the real
 * fetchJson/mapResponse plumbing never runs here), so OvertimePage's
 * `result.data` shape is whatever this helper's caller says it is —
 * matching the real mapResponse's output shape ({requests, hasMore, total}).
 * Defaults (hasMore: false, total: rows.length) reproduce the exact
 * pre-GAP-HR-OVERTIME-04 behavior for every test below that doesn't care
 * about truncation.
 */
function mockOvertimeResponse(
  rows: ApiOTRequest[],
  opts: {
    source?: string;
    hasMore?: boolean;
    total?: number;
    summary?: { total: number; pending: number; approved: number; rejected: number; approvedHours: number } | null;
  } = {},
) {
  const requests = mapOvertime(rows);
  fetchJsonMock.mockResolvedValue({
    data: { requests, hasMore: opts.hasMore ?? false, total: opts.total ?? requests.length, summary: opts.summary ?? null },
    source: opts.source ?? "api",
  });
}

// The approve/reject buttons are a client component that reads the intl
// context, so the page is rendered inside the provider the app layout supplies.
async function renderPage(searchParams?: { offset?: string }) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await OvertimePage({ searchParams })}
    </NextIntlClientProvider>,
  );
}

describe("OvertimePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  it("GAP-HR-OVERTIME-02: renders the resolved employee name, not a bare id", async () => {
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.getByText("A. Kumar (E-1)")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
  });

  it("renders the date via the shared date formatter, not the raw ISO string", async () => {
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.queryByText("2026-08-10")).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-05: 'Approved Hours' only sums approved-status rows, not pending/rejected", async () => {
    // 3h pending + 2h approved: the old "Total Hours" summed both to 5.0;
    // the stat is now Approved Hours and must show only the 2h approved row.
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    // "2.00 h" appears twice: once as the Approved Hours stat value, once
    // as the one approved row's own hours cell -- both correct, and
    // together they confirm only the approved row's hours were summed.
    expect(screen.getAllByText("2.00 h")).toHaveLength(2);
    expect(screen.queryByText("5.0 h")).not.toBeInTheDocument();
    expect(screen.queryByText("5.00 h")).not.toBeInTheDocument();
  });

  it("renders link to new overtime request", async () => {
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.getByRole("link", { name: /new request/i })).toHaveAttribute("href", "/hr/overtime/new");
  });

  it("renders empty state when there are genuinely no requests", async () => {
    mockOvertimeResponse([]);
    await renderPage();
    expect(screen.getByText("No overtime requests yet")).toBeInTheDocument();
    // A genuine empty result is zero, not unknown — stats should read 0, not "—".
    expect(screen.getByText("0.00 h")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    mockOvertimeResponse([], { source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't load overtime requests.")).toBeInTheDocument();
    expect(screen.queryByText("No overtime requests yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.00 h")).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-01: does not render Approve/Reject actions for a manager (not in OVERTIME_DECIDE_ROLES)", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-01: renders Approve/Reject for a pending row when the viewer is hr_admin", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    // Only o1 (pending) gets actions; o2 (already approved) gets none.
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("GAP-HR-OVERTIME-04: no truncation notice when hasMore is false", async () => {
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-04: shows a truncation notice and the real server total (not the truncated page length) when hasMore is true", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250 });
    await renderPage();
    expect(screen.getByText(/showing the first 2 of 250 requests/i)).toBeInTheDocument();
    // "Total Requests" stat must read the real total (250), not the
    // truncated page length (2) -- the exact regression GAP-HR-OVERTIME-04
    // flags ("stat cards computed client-side from 200 rows can be wrong").
    expect(screen.getByText("250")).toBeInTheDocument();
  });
});

describe("OvertimePage — GAP-HR-OVERTIME-01/03 role-conditional controls", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
  });

  it.each([
    ["hr_admin", true],
    ["hr_officer", true],
    ["super_admin", true],
    ["employee", true],
    ["manager", false],
  ])("%s: New Request link shown = %s (mirrors POST /overtime-requests, which excludes a bare manager)", async (role, shown) => {
    getSessionRolesMock.mockReturnValue([role]);
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    const links = screen.queryAllByRole("link", { name: /new request/i });
    expect(links.length > 0).toBe(shown);
  });

  it("a manager sees no New Request link in the empty state either, and gets copy that does not promise an approval queue", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    mockOvertimeResponse([]);
    await renderPage();
    expect(screen.queryByRole("link", { name: /new request/i })).not.toBeInTheDocument();
    expect(screen.getByText(/from you and your direct reports will appear here/i)).toBeInTheDocument();
    expect(screen.queryByText(/for approval/i)).not.toBeInTheDocument();
  });

  it("the empty state still offers New Request to an employee", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    mockOvertimeResponse([]);
    await renderPage();
    const emptyState = screen.getByText("No overtime requests yet").closest(".empty-state") as HTMLElement;
    expect(within(emptyState).getByRole("link", { name: /new request/i })).toHaveAttribute("href", "/hr/overtime/new");
  });

  it("an employee sees no Approve / Reject (decisions are HR-only)", async () => {
    getSessionRolesMock.mockReturnValue(["employee"]);
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("an hr_officer sees both Approve and Reject on the pending row only", async () => {
    getSessionRolesMock.mockReturnValue(["hr_officer"]);
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: "Reject" })).toHaveLength(1);
  });
});

// GAP-HR-OVERTIME-04: the stat cards came from the rows of the loaded window,
// so Pending / Approved / Approved Hours undercounted once the list spanned
// more than one page; and the rows past the first 200 were unreachable.
describe("OvertimePage — GAP-HR-OVERTIME-04 server-side totals and paging", () => {
  const SUMMARY = { total: 250, pending: 120, approved: 100, rejected: 30, approvedHours: 412.5 };
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  it("takes every stat card from the server summary, not from the 2 rows loaded", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage();
    expect(screen.getByText("250")).toBeInTheDocument();
    expect(screen.getByText("120")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("412.50 h")).toBeInTheDocument();
    // The window-derived approved hours (2.00 h) appears only as the one approved row's own cell.
    expect(screen.getAllByText("2.00 h")).toHaveLength(1);
  });

  it("asks the API for one page at a time (limit=20, offset from ?offset=)", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage();
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/hrms/overtime-requests?limit=20&offset=0");

    fetchJsonMock.mockClear();
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage({ offset: "40" });
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/hrms/overtime-requests?limit=20&offset=40");
  });

  it("ignores a junk ?offset= and starts at the first page", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage({ offset: "-5" });
    expect(fetchJsonMock.mock.calls[0]![0]).toBe("/api/v1/hrms/overtime-requests?limit=20&offset=0");
  });

  it("links every page: summary, Previous and Next carry the right offsets", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage({ offset: "40" });
    expect(screen.getByText("41–60 of 250")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/hr/overtime?offset=20");
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/hr/overtime?offset=60");
  });

  it("the first page has Next but no Previous, and the last page has Previous but no Next", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage();
    expect(screen.queryByRole("link", { name: "Previous" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Next" })).toHaveAttribute("href", "/hr/overtime?offset=20");
    fetchJsonMock.mockClear();
    mockOvertimeResponse(MOCK_OT, { hasMore: false, total: 250, summary: SUMMARY });
    cleanup();
    await renderPage({ offset: "240" });
    expect(screen.getByRole("link", { name: "Previous" })).toHaveAttribute("href", "/hr/overtime?offset=220");
    expect(screen.queryByRole("link", { name: "Next" })).not.toBeInTheDocument();
  });

  it("shows no pager when everything fits on one page", async () => {
    mockOvertimeResponse(MOCK_OT);
    await renderPage();
    expect(screen.queryByRole("navigation", { name: "Pages" })).not.toBeInTheDocument();
  });

  it("the 'showing the first N' notice appears on the first page only, and no longer tells users to filter", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250, summary: SUMMARY });
    await renderPage();
    expect(screen.getByText(/showing the first 2 of 250 requests/i)).toBeInTheDocument();
    expect(screen.queryByText(/refine the filter/i)).not.toBeInTheDocument();
    cleanup();
    await renderPage({ offset: "20" });
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it("a page past the end is not reported as 'no overtime requests yet'", async () => {
    mockOvertimeResponse([], { hasMore: false, total: 250, summary: SUMMARY });
    await renderPage({ offset: "400" });
    expect(screen.queryByText("No overtime requests yet")).not.toBeInTheDocument();
    expect(screen.getByText("No requests on this page")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the first page" })).toHaveAttribute("href", "/hr/overtime");
  });
});
