import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

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
function mockOvertimeResponse(rows: ApiOTRequest[], opts: { source?: string; hasMore?: boolean; total?: number } = {}) {
  const requests = mapOvertime(rows);
  fetchJsonMock.mockResolvedValue({
    data: { requests, hasMore: opts.hasMore ?? false, total: opts.total ?? requests.length },
    source: opts.source ?? "api",
  });
}

describe("OvertimePage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
  });

  it("GAP-HR-OVERTIME-02: renders the resolved employee name, not a bare id", async () => {
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    expect(screen.getByText("A. Kumar (E-1)")).toBeInTheDocument();
    expect(screen.queryByText("e1")).not.toBeInTheDocument();
  });

  it("renders the date via the shared date formatter, not the raw ISO string", async () => {
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    expect(screen.queryByText("2026-08-10")).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-05: 'Approved Hours' only sums approved-status rows, not pending/rejected", async () => {
    // 3h pending + 2h approved: the old "Total Hours" summed both to 5.0;
    // the stat is now Approved Hours and must show only the 2h approved row.
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    // "2.00 h" appears twice: once as the Approved Hours stat value, once
    // as the one approved row's own hours cell -- both correct, and
    // together they confirm only the approved row's hours were summed.
    expect(screen.getAllByText("2.00 h")).toHaveLength(2);
    expect(screen.queryByText("5.0 h")).not.toBeInTheDocument();
    expect(screen.queryByText("5.00 h")).not.toBeInTheDocument();
  });

  it("renders link to new overtime request", async () => {
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    expect(screen.getByRole("link", { name: /new request/i })).toHaveAttribute("href", "/hr/overtime/new");
  });

  it("renders empty state when there are genuinely no requests", async () => {
    mockOvertimeResponse([]);
    render(await OvertimePage());
    expect(screen.getByText("No overtime requests yet")).toBeInTheDocument();
    // A genuine empty result is zero, not unknown — stats should read 0, not "—".
    expect(screen.getByText("0.00 h")).toBeInTheDocument();
  });

  it("shows the error state — not zero stat cards or the empty-state prompt — on a real fetch failure", async () => {
    mockOvertimeResponse([], { source: "error" });
    render(await OvertimePage());
    expect(screen.getByText("We couldn't load overtime requests.")).toBeInTheDocument();
    expect(screen.queryByText("No overtime requests yet")).not.toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
    expect(screen.queryByText("0.00 h")).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-01: does not render Approve/Reject actions for a manager (not in OVERTIME_DECIDE_ROLES)", async () => {
    getSessionRolesMock.mockReturnValue(["manager"]);
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-01: renders Approve/Reject for a pending row when the viewer is hr_admin", async () => {
    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    // Only o1 (pending) gets actions; o2 (already approved) gets none.
    expect(screen.getAllByRole("button", { name: "Approve" })).toHaveLength(1);
  });

  it("GAP-HR-OVERTIME-04: no truncation notice when hasMore is false", async () => {
    mockOvertimeResponse(MOCK_OT);
    render(await OvertimePage());
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });

  it("GAP-HR-OVERTIME-04: shows a truncation notice and the real server total (not the truncated page length) when hasMore is true", async () => {
    mockOvertimeResponse(MOCK_OT, { hasMore: true, total: 250 });
    render(await OvertimePage());
    expect(screen.getByText(/showing the first 2 of 250 requests/i)).toBeInTheDocument();
    // "Total Requests" stat must read the real total (250), not the
    // truncated page length (2) -- the exact regression GAP-HR-OVERTIME-04
    // flags ("stat cards computed client-side from 200 rows can be wrong").
    expect(screen.getByText("250")).toBeInTheDocument();
  });
});
