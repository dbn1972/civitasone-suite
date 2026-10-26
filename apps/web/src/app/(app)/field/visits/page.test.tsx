import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getVisitsMock = vi.fn();
const getTasksMock = vi.fn();
const resolveUsersMock = vi.fn();
let mockRoles: string[] = ["field_admin"];

vi.mock("../_data", async () => {
  const actual = await vi.importActual<typeof import("../_data")>("../_data");
  return {
    ...actual,
    getFieldVisitsDetailed: (...a: unknown[]) => getVisitsMock(...a),
    getFieldTasksDetailed: () => getTasksMock(),
  };
});
vi.mock("@/lib/directory/resolveUsers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/directory/resolveUsers")>("@/lib/directory/resolveUsers");
  return { ...actual, resolveUsers: (...a: unknown[]) => resolveUsersMock(...a) };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => mockRoles,
  hasAnyRole: (roles: string[], allowed: string[]) => roles.some((r) => allowed.includes(r)),
  FIELD_VISIT_LOCATION_ROLES: ["field_admin", "super_admin"],
}));

import FieldVisitsPage from "./page";
import type { FieldVisitRow, FieldVisitsPage as VisitsPage } from "../_data";

function visit(overrides: Partial<FieldVisitRow> = {}): FieldVisitRow {
  return {
    id: "v1",
    taskId: "task-1",
    agentId: "agent-1",
    checkInLatitude: "28.613900",
    checkInLongitude: "77.209000",
    checkOutLatitude: null,
    checkOutLongitude: null,
    checkInAt: "2026-08-05T04:00:00.000Z",
    checkOutAt: null,
    durationMinutes: null,
    outcome: null,
    notes: null,
    ...overrides,
  };
}

function page(rows: FieldVisitRow[], total = rows.length): { data: VisitsPage; source: "api" | "error" } {
  return { data: { rows, total, limit: 100 }, source: "api" };
}

describe("FieldVisitsPage", () => {
  beforeEach(() => {
    getVisitsMock.mockReset();
    getTasksMock.mockReset();
    resolveUsersMock.mockReset();
    getTasksMock.mockResolvedValue({ data: [], source: "api" });
    resolveUsersMock.mockResolvedValue(new Map());
    mockRoles = ["field_admin"];
  });

  it("GAP-FIELD-VISITS-01: a failed load shows a retry, never '0' stats or 'No visits yet'", async () => {
    getVisitsMock.mockResolvedValueOnce({ data: { rows: [], total: 0, limit: 100 }, source: "error" });
    render(await FieldVisitsPage());
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("No visits yet")).not.toBeInTheDocument();
  });

  it("GAP-FIELD-VISITS-03: rounds coordinates and shows the Agent/Task columns for a privileged role", async () => {
    getVisitsMock.mockResolvedValueOnce(page([visit()]));
    const { container } = render(await FieldVisitsPage());
    // rounded to 3 dp, not the full precision string
    expect(screen.getByText("28.614, 77.209")).toBeInTheDocument();
    expect(container.textContent).not.toContain("28.613900");
    expect(screen.getByText("Agent")).toBeInTheDocument();
    expect(screen.getByText("Task")).toBeInTheDocument();
  });

  it("GAP-FIELD-VISITS-03: a non-privileged role sees no GPS column and no export", async () => {
    mockRoles = ["field_agent"];
    getVisitsMock.mockResolvedValueOnce(page([visit()]));
    const { container } = render(await FieldVisitsPage());
    expect(screen.queryByText("GPS")).not.toBeInTheDocument();
    // coordinates not present at all
    expect(container.textContent).not.toContain("28.614");
    // no CSV export button
    expect(screen.queryByText(/CSV/i)).not.toBeInTheDocument();
  });

  it("GAP-FIELD-VISITS-02: an open visit > 12h reads as Overdue, completed reads as Completed", async () => {
    const now = Date.now();
    const longOpen = visit({ id: "lo", checkInAt: new Date(now - 20 * 3600 * 1000).toISOString() });
    const done = visit({ id: "dn", checkInAt: new Date(now - 3 * 3600 * 1000).toISOString(), checkOutAt: new Date(now - 2 * 3600 * 1000).toISOString(), outcome: "completed", durationMinutes: 60 });
    getVisitsMock.mockResolvedValueOnce(page([longOpen, done]));
    render(await FieldVisitsPage());
    expect(screen.getByText("Overdue")).toBeInTheDocument();
    // "Completed" appears both as the status pill and (humanized) in the
    // outcome column — assert at least one is present.
    expect(screen.getAllByText("Completed").length).toBeGreaterThan(0);
    // open-visit elapsed time: 20 h open → "open 20h" in duration column (never a dash)
    expect(screen.getByText("open 20h")).toBeInTheDocument();
    // completed visit with durationMinutes shows "60 min" (not "open Xh")
    expect(screen.getByText("60 min")).toBeInTheDocument();
  });

  it("GAP-FIELD-VISITS-04: KPI says 'latest N' and uses the server total when capped", async () => {
    getVisitsMock.mockResolvedValueOnce(page([visit()], 250));
    render(await FieldVisitsPage());
    expect(screen.getByText(/Visits \(latest 100\)/)).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });

  it("GAP-FIELD-VISITS-04: from page 2 the Open KPI is labelled with the visit window it counts, not plain Open", async () => {
    const rows = [visit({ id: "a" }), visit({ id: "b", checkOutAt: "2026-08-05T06:00:00.000Z", outcome: "completed", durationMinutes: 120 })];
    getVisitsMock.mockResolvedValueOnce(page(rows, 250));
    render(await FieldVisitsPage({ searchParams: Promise.resolve({ offset: "100" }) }));
    expect(getVisitsMock).toHaveBeenCalledWith(expect.objectContaining({ offset: 100 }));
    expect(screen.getByText("Open (in visits 101–102)")).toBeInTheDocument();
    expect(screen.queryByText("Open")).not.toBeInTheDocument();
    expect(screen.queryByText(/latest 100/)).not.toBeInTheDocument();
  });

  // GAP-FIELD-VISITS-03: Agent / Task show resolved names, not raw UUIDs.
  it("GAP-FIELD-VISITS-03: Agent and Task columns show resolved names, falling back to a short id", async () => {
    const A1 = "aaaaaaaa-1111-4000-8000-000000000001";
    const A2 = "aaaaaaaa-2222-4000-8000-000000000002";
    const T1 = "bbbbbbbb-1111-4000-8000-000000000001";
    resolveUsersMock.mockResolvedValue(new Map([[A1, "Asha Verma"]]));
    getTasksMock.mockResolvedValue({
      data: [{ id: T1, title: "Inspect pole 14", taskType: "inspection", assignee: A1, status: "assigned", priority: 1, dueDate: null }],
      source: "api",
    });
    getVisitsMock.mockResolvedValueOnce(page([visit({ id: "v1", agentId: A1, taskId: T1 }), visit({ id: "v2", agentId: A2, taskId: "cccccccc-1111-4000-8000-000000000001" })]));
    const { container } = render(await FieldVisitsPage());
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.getByText("Inspect pole 14")).toBeInTheDocument();
    // unresolved ids degrade to a short id, never a guessed name
    expect(screen.getByText("aaaaaaaa…")).toBeInTheDocument();
    expect(container.textContent).not.toContain(A1);
    expect(resolveUsersMock).toHaveBeenCalledTimes(1);
    expect([...(resolveUsersMock.mock.calls[0]![0] as Iterable<string>)].sort()).toEqual([A1, A2]);
  });

  // GAP-FIELD-VISITS-04: paging + date-range filter.
  it("GAP-FIELD-VISITS-04: passes offset/from/to from the URL to the loader, ignoring malformed values", async () => {
    getVisitsMock.mockResolvedValue(page([visit()], 1));
    await FieldVisitsPage({ searchParams: Promise.resolve({ offset: "100", from: "2026-10-01", to: "not-a-date" }) });
    expect(getVisitsMock).toHaveBeenCalledWith({ offset: 100, from: "2026-10-01", to: undefined });
  });

  it("GAP-FIELD-VISITS-04: a full first page links to older visits keeping the date range", async () => {
    getVisitsMock.mockResolvedValue(page(Array.from({ length: 100 }, (_, i) => visit({ id: `v${i}` })), 250));
    render(await FieldVisitsPage({ searchParams: Promise.resolve({ from: "2026-10-01" }) }));
    const older = screen.getByRole("link", { name: /older visits/i });
    expect(older.getAttribute("href")).toBe("/field/visits?offset=100&from=2026-10-01");
    expect(screen.queryByRole("link", { name: /newer visits/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("field-visits-window").textContent).toMatch(/1.{1,3}100 of 250/);
  });

  it("GAP-FIELD-VISITS-04: a later page shows newer + older links and 'showing X-Y of total' KPIs", async () => {
    getVisitsMock.mockResolvedValue(page(Array.from({ length: 50 }, (_, i) => visit({ id: `v${i}` })), 150));
    render(await FieldVisitsPage({ searchParams: Promise.resolve({ offset: "100" }) }));
    expect(screen.getByRole("link", { name: /newer visits/i }).getAttribute("href")).toBe("/field/visits");
    expect(screen.queryByRole("link", { name: /older visits/i })).not.toBeInTheDocument();
    expect(screen.getByTestId("field-visits-window").textContent).toMatch(/101.{1,3}150 of 150/);
  });

  it("GAP-FIELD-VISITS-04: renders a from/to filter form and distinguishes an empty range from no visits", async () => {
    getVisitsMock.mockResolvedValue(page([], 0));
    const { container } = render(await FieldVisitsPage({ searchParams: Promise.resolve({ from: "2026-10-01", to: "2026-10-02" }) }));
    expect((container.querySelector('input[name="from"]') as HTMLInputElement).value).toBe("2026-10-01");
    expect((container.querySelector('input[name="to"]') as HTMLInputElement).value).toBe("2026-10-02");
    expect(screen.getByText("No visits in this date range")).toBeInTheDocument();
    expect(screen.queryByText("No visits yet")).not.toBeInTheDocument();
  });
});
