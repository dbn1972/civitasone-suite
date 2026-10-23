import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

const getMeetingsPageMock = vi.fn();
vi.mock("./_data/loaders", () => ({
  getMeetingsPage: (...args: unknown[]) => getMeetingsPageMock(...args),
}));

const getSessionRolesMock = vi.fn<() => string[]>();
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>(
    "@/lib/auth/roleGuard",
  );
  return {
    ...actual,
    getSessionRoles: () => getSessionRolesMock(),
  };
});

import MeetingHomePage from "./page";
import { MEETING_CONFIG_ADMIN_ROLES } from "@/lib/auth/roleGuard";

type Row = { id: string; status: string };
type Result = { data: Row[]; source: "api" | "error" };
const meeting = (id: string, status: string): Row => ({ id, status });
const ok = (rows: Row[]): Result => ({ data: rows, source: "api" });
const err = (): Result => ({ data: [], source: "error" });

// The page reads EVERY figure — the grand total and each status bucket — from the
// server total (meta.total) of getMeetingsPage, never from the length of a fetched
// page (GAP-MEETING-HOME-02). The mock reports total = number of fixture rows with
// that status, unless an explicit total is given (to prove the page length is not used).
function mockLists(
  all: Result,
  inProgress: Result = ok([]),
  totals?: { all?: number; inProgress?: number; byStatus?: Record<string, number> },
) {
  getMeetingsPageMock.mockImplementation((q?: { status?: string }) => {
    const src = q?.status === "in_progress" ? inProgress : all;
    let total: number;
    if (!q?.status) total = totals?.all ?? all.data.length;
    else if (q.status === "in_progress") total = totals?.inProgress ?? inProgress.data.length;
    else total = totals?.byStatus?.[q.status] ?? all.data.filter((m) => m.status === q.status).length;
    return Promise.resolve({ data: { rows: [], page: 1, pageSize: 1, total }, source: src.source });
  });
}

describe("MeetingHomePage", () => {
  beforeEach(() => {
    getMeetingsPageMock.mockReset();
    getSessionRolesMock.mockReset();
    getSessionRolesMock.mockReturnValue(MEETING_CONFIG_ADMIN_ROLES);
  });

  it("GAP-MEETING-HOME-01: on load failure shows no fabricated '0' and an error region with retry", async () => {
    mockLists(err(), err());
    render(await MeetingHomePage());
    // No stat shows a bare "0".
    expect(screen.queryByText("0")).not.toBeInTheDocument();
    // A retry control is present (RefreshErrorState renders a Retry button).
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("GAP-MEETING-HOME-01: on partial (in-progress only) failure also degrades, no silent zero", async () => {
    mockLists(ok([meeting("m1", "scheduled")]), err());
    render(await MeetingHomePage());
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
  });

  it("GAP-MEETING-HOME-03: counts adjourned and minutes_pending as distinct stats with drill-through links", async () => {
    mockLists(
      ok([
        meeting("a1", "adjourned"),
        meeting("a2", "adjourned"),
        meeting("p1", "minutes_pending"),
      ]),
    );
    render(await MeetingHomePage());
    expect(screen.getByText("Adjourned")).toBeInTheDocument();
    expect(screen.getByText("Minutes pending")).toBeInTheDocument();
    // Drill-through: a stat links into the filtered list.
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/meeting/meetings?status=adjourned");
    expect(links).toContain("/meeting/meetings?status=minutes_pending");
  });

  it("GAP-MEETING-HOME-02: totals come from the server-side meta total, not the fetched page length", async () => {
    mockLists(ok([meeting("m1", "scheduled")]), ok([]), { all: 1234, inProgress: 56 });
    render(await MeetingHomePage());
    expect(screen.getByText("1,234")).toBeInTheDocument();
    expect(screen.getByText("56")).toBeInTheDocument();
  });

  it("status buckets are server totals: a tenant with far more than one page shows the true counts", async () => {
    // Only a handful of rows are "fetched"; the server says there are hundreds.
    mockLists(ok([meeting("m1", "scheduled")]), ok([]), {
      all: 900,
      byStatus: { scheduled: 300, agenda_locked: 21, adjourned: 77, minutes_pending: 142 },
    });
    render(await MeetingHomePage());
    expect(screen.getByText("900")).toBeInTheDocument();
    expect(screen.getByText("321")).toBeInTheDocument(); // scheduled + agenda_locked
    expect(screen.getByText("77")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
  });

  it("GAP-MEETING-HOME-04: a plain member does not see the Admin Configuration tile", async () => {
    mockLists(ok([]));
    getSessionRolesMock.mockReturnValue(["committee_member"]);
    render(await MeetingHomePage());
    expect(screen.queryByText("Admin Configuration")).not.toBeInTheDocument();
    expect(screen.getByText("Meetings & Console")).toBeInTheDocument();
  });

  it("GAP-MEETING-HOME-04: an admin sees the Admin Configuration tile", async () => {
    mockLists(ok([]));
    getSessionRolesMock.mockReturnValue(["meeting_admin"]);
    render(await MeetingHomePage());
    expect(screen.getByText("Admin Configuration")).toBeInTheDocument();
  });

  it("GAP-MEETING-HOME-05: shows a one-click New meeting action", async () => {
    mockLists(ok([]));
    render(await MeetingHomePage());
    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/meeting/meetings/new");
  });
});
