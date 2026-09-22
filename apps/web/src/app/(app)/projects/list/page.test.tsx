import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
vi.mock("./ProjectsTable", () => ({
  ProjectsTable: ({ rows }: { rows: unknown[] }) => <div>projects-table:{rows.length}</div>,
}));

import ProjectsListPage from "./page";

type MockProject = {
  id: string; projectCode: string; name: string; status: string; rag: string;
  totalBudget: number; expenditure: number; completionPct: number; startDate: string;
};

function project(overrides: Partial<MockProject> & { id: string }): MockProject {
  return {
    projectCode: `PRJ-${overrides.id}`, name: `Project ${overrides.id}`, status: "active",
    rag: "green", totalBudget: 100, expenditure: 0, completionPct: 0, startDate: "2026-01-01",
    ...overrides,
  };
}

function mockProjects(data: MockProject[]) {
  fetchJsonMock.mockImplementation((path: unknown) => {
    if (typeof path === "string" && path.includes("/project/projects")) {
      return Promise.resolve({ data, source: "api" as const });
    }
    return Promise.resolve({ data: [], source: "api" as const });
  });
}

// ISSUE-8: the live bug -- summary tiles showed "Active 3" while On Track /
// At Risk / Delayed all showed 0. Root cause: those 3 tiles were computed
// from a completionPct threshold and from lifecycle-status values
// (on_hold/delayed) that are mutually exclusive with "active", instead of
// from the project's real RAG (green/amber/red) field -- so for a tenant
// whose active projects are all rag: "green" but 0% physically complete
// (exactly this seed data), the breakdown could only ever read 0/0/0.
describe("ProjectsListPage", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("partitions the RAG breakdown from the real `rag` field, not from completionPct or lifecycle status", async () => {
    mockProjects([
      project({ id: "p1", status: "active", rag: "green", completionPct: 0 }), // the reported bug: 0% complete, still on track
      project({ id: "p2", status: "active", rag: "amber", completionPct: 0 }),
      project({ id: "p3", status: "delayed", rag: "red", completionPct: 0 }), // scheduler-flipped: still counted under Active
    ]);
    render(await ProjectsListPage());
    expect(screen.getByText("Active").parentElement).toHaveTextContent("3");
    expect(screen.getByText("On Track").parentElement).toHaveTextContent("1");
    expect(screen.getByText("At Risk").parentElement).toHaveTextContent("1");
    expect(screen.getByText("Delayed").parentElement).toHaveTextContent("1");
  });

  it("excludes non-active lifecycle states (completed, on_hold, cancelled, planning) from the Active/RAG tiles", async () => {
    mockProjects([
      project({ id: "p1", status: "active", rag: "green" }),
      project({ id: "p2", status: "completed", rag: "green" }),
      project({ id: "p3", status: "on_hold", rag: "amber" }),
      project({ id: "p4", status: "cancelled", rag: "red" }),
      project({ id: "p5", status: "planning", rag: "green" }),
    ]);
    render(await ProjectsListPage());
    expect(screen.getByText("Active").parentElement).toHaveTextContent("1");
    expect(screen.getByText("On Track").parentElement).toHaveTextContent("1");
    expect(screen.getByText("At Risk").parentElement).toHaveTextContent("0");
    expect(screen.getByText("Delayed").parentElement).toHaveTextContent("0");
  });
});
