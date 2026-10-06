import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getProjectByIdMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getProjectById: (...args: unknown[]) => getProjectByIdMock(...args),
}));

// Isolate the branching: stub the heavy client child components.
vi.mock("./ProjectGantt", () => ({ ProjectGantt: () => <div>gantt</div> }));
vi.mock("./ProjectDetailActions", () => ({ ProjectDetailActions: () => <div>actions</div> }));
vi.mock("./ProjectDetailTables", () => ({
  MilestonesDetailTable: () => <div>milestones-table</div>,
  FundReleasesDetailTable: () => <div>fund-releases-table</div>,
}));
// roleGuard reads next/headers cookies at runtime; stub it for the server component.
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["project_manager"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
  PROJECT_WRITE_ROLES: ["project_manager", "project_officer", "super_admin"],
}));

import ProjectDetailPage from "./page";

const OK_PROJECT = {
  id: "p1",
  projectCode: "PR-1",
  name: "Rural Road",
  department: "PWD",
  scheme: "PMGSY",
  startDate: "2026-01-01",
  expectedEndDate: "2026-12-31",
  status: "active",
  totalBudget: 100000,
  expenditure: 25000,
  completionPct: 25,
  milestones: [],
  fundReleases: [],
};

describe("GAP-PROJECTS-DETAIL-01 project detail error ordering", () => {
  beforeEach(() => getProjectByIdMock.mockReset());

  it("renders RefreshErrorState (retry) on a 500 outage — not the 'removed' not-found view", async () => {
    getProjectByIdMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    render(await ProjectDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("Try again")).toBeInTheDocument();
    expect(screen.queryByText(/may have been removed/)).not.toBeInTheDocument();
  });

  it("renders the not-found view on a genuine 404", async () => {
    getProjectByIdMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    render(await ProjectDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("Project not found")).toBeInTheDocument();
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
  });

  it("renders the not-found view on a successful load that returned null", async () => {
    getProjectByIdMock.mockResolvedValue({ data: null, source: "api" });
    render(await ProjectDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("Project not found")).toBeInTheDocument();
  });

  it("renders the project on success", async () => {
    getProjectByIdMock.mockResolvedValue({ data: OK_PROJECT, source: "api" });
    render(await ProjectDetailPage({ params: { id: "p1" } }));
    expect(screen.getByText("Rural Road")).toBeInTheDocument();
  });
});
