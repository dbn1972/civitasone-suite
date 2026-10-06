import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getVisitsMock = vi.fn();
let mockRoles: string[] = ["field_admin"];

vi.mock("../_data", async () => {
  const actual = await vi.importActual<typeof import("../_data")>("../_data");
  return { ...actual, getFieldVisitsDetailed: () => getVisitsMock() };
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
  });

  it("GAP-FIELD-VISITS-04: KPI says 'latest N' and uses the server total when capped", async () => {
    getVisitsMock.mockResolvedValueOnce(page([visit()], 250));
    render(await FieldVisitsPage());
    expect(screen.getByText(/Visits \(latest 100\)/)).toBeInTheDocument();
    expect(screen.getByText("250")).toBeInTheDocument();
  });
});
