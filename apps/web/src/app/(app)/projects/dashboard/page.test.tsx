import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./DashboardProjectsTable", () => ({
  DashboardProjectsTable: ({ rows }: { rows: unknown[] }) => <div>projects-table:{rows.length}</div>,
}));

import ProjectsDashboardPage from "./page";

const MOCK_DASHBOARD = { totalProjects: 12, onTrackPct: 80, delayed: 2, totalOutlay: 5_000_000_000 };
const MOCK_PROJECTS = [{ id: "p1", projectCode: "PRJ-1", name: "Rural Roads Phase 2", status: "active", totalBudget: 100, completionPct: 40 }];
const MOCK_SCHEMES = [{ id: "s1", name: "PMGSY", status: "active" }];

function mockLoaders(overrides: {
  dash?: { data: unknown; source: "api" | "error" };
  projects?: { data: unknown; source: "api" | "error" };
  schemes?: { data: unknown; source: "api" | "error" };
}) {
  const dash = overrides.dash ?? { data: MOCK_DASHBOARD, source: "api" as const };
  const projects = overrides.projects ?? { data: MOCK_PROJECTS, source: "api" as const };
  const schemes = overrides.schemes ?? { data: MOCK_SCHEMES, source: "api" as const };
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path !== "string") return Promise.resolve({ data: [], source: "api" });
    if (path.includes("/project/dashboard")) return Promise.resolve(dash);
    if (path.includes("/project/projects")) return Promise.resolve(projects);
    if (path.includes("/project/schemes")) return Promise.resolve(schemes);
    return Promise.resolve({ data: [], source: "api" });
  });
}

describe("ProjectsDashboardPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("renders the projects table and real stat counts when every loader succeeds", async () => {
    mockLoaders({});
    render(await ProjectsDashboardPage());
    expect(screen.getByText("projects-table:1")).toBeInTheDocument();
    expect(screen.getByText("Schemes").parentElement).toHaveTextContent("1");
  });

  it("shows the honest empty state when a tenant genuinely has zero projects (source: api, [])", async () => {
    mockLoaders({ projects: { data: [], source: "api" } });
    render(await ProjectsDashboardPage());
    expect(screen.getByText("No projects yet")).toBeInTheDocument();
  });

  it("shows the error state — not the empty-state prompt — when the PROJECTS loader fails, even though schemes/dashboard succeed", async () => {
    mockLoaders({ projects: { data: [], source: "error" } });
    render(await ProjectsDashboardPage());
    expect(screen.getByText("We couldn't load this projects.")).toBeInTheDocument();
    expect(screen.queryByText("No projects yet")).not.toBeInTheDocument();
    expect(screen.queryByText(/projects-table/)).not.toBeInTheDocument();
    // Combined `anyError` gates ALL the stat cards here (unlike the
    // disbursement page's independent per-source gating) — that was the
    // pre-existing design of this page's own `anyError` flag; UX-013 only
    // wired it up, it did not introduce the combination.
    expect(screen.getByText("Schemes").parentElement).toHaveTextContent("—");
  });

  it("shows the error state when the SCHEMES loader fails, even though projects/dashboard succeed", async () => {
    mockLoaders({ schemes: { data: [], source: "error" } });
    render(await ProjectsDashboardPage());
    expect(screen.getByText("We couldn't load this projects.")).toBeInTheDocument();
    expect(screen.queryByText(/projects-table/)).not.toBeInTheDocument();
  });
});
