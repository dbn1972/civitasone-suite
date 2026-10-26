import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const tasksMock = vi.fn();
const routesMock = vi.fn();
const agentsMock = vi.fn();
const resolveUsersMock = vi.fn();
let mockRoles: string[] = ["field_admin"];

vi.mock("./_data", async () => {
  const actual = await vi.importActual<typeof import("./_data")>("./_data");
  return {
    ...actual,
    getFieldTasksDetailed: () => tasksMock(),
    getFieldRoutesDetailed: () => routesMock(),
    getFieldAgentsDetailed: () => agentsMock(),
  };
});
vi.mock("@/lib/directory/resolveUsers", async () => {
  const actual = await vi.importActual<typeof import("@/lib/directory/resolveUsers")>("@/lib/directory/resolveUsers");
  return { ...actual, resolveUsers: (...a: unknown[]) => resolveUsersMock(...a) };
});
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => mockRoles };
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import TasksPage from "./tasks/page";
import RoutesPage from "./routes/page";
import AgentsPage from "./agents/page";

describe("Field Tasks page (GAP-FIELD-TASKS-03/05)", () => {
  beforeEach(() => {
    tasksMock.mockReset();
    resolveUsersMock.mockReset();
    resolveUsersMock.mockResolvedValue(new Map());
    mockRoles = ["field_admin"];
  });

  it("GAP-FIELD-TASKS-05: shows the assignee NAME (not the UUID) and Start/Complete/Assign controls by status", async () => {
    const A = "aaaaaaaa-1111-4000-8000-000000000001";
    resolveUsersMock.mockResolvedValue(new Map([[A, "Asha Verma"]]));
    tasksMock.mockResolvedValueOnce({
      data: [
        { id: "t1", title: "Inspect pole", taskType: "inspection", assignee: A, assigneeId: A, status: "in_progress", priority: 1, dueDate: null, version: 3 },
        { id: "t2", title: "Survey ward", taskType: "survey", assignee: "Unassigned", assigneeId: null, status: "unassigned", priority: 2, dueDate: null, version: 1 },
      ],
      source: "api",
    });
    const { container } = render(await TasksPage());
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(container.textContent).not.toContain(A);
    expect(screen.getByRole("button", { name: "Mark complete" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Assign" })).toBeInTheDocument();
  });

  it("GAP-FIELD-TASKS-05: a field agent is not offered Assign (supervisor-only server-side)", async () => {
    mockRoles = ["field_agent"];
    tasksMock.mockResolvedValueOnce({
      data: [{ id: "t2", title: "Survey ward", taskType: "survey", assignee: "Unassigned", assigneeId: null, status: "unassigned", priority: 2, dueDate: null, version: 1 }],
      source: "api",
    });
    render(await TasksPage());
    expect(screen.queryByRole("button", { name: "Assign" })).not.toBeInTheDocument();
  });

  it("renders an Assignee column and typed task columns", async () => {
    tasksMock.mockResolvedValueOnce({
      data: [{ id: "t1", title: "Inspect pole", taskType: "inspection", assignee: "agent-9", status: "assigned", priority: 2, dueDate: "2026-09-30T10:00:00.000Z" }],
      source: "api",
    });
    render(await TasksPage());
    expect(screen.getByText("Assignee")).toBeInTheDocument();
    expect(screen.getByText("Title")).toBeInTheDocument();
    expect(screen.getByText("Inspect pole")).toBeInTheDocument();
    expect(screen.getByText("agent-9")).toBeInTheDocument();
    // status pill humanizes
    expect(screen.getByText("Assigned")).toBeInTheDocument();
  });

  it("a failed load shows a retry, never 'No tasks yet'", async () => {
    tasksMock.mockResolvedValueOnce({ data: [], source: "error" });
    render(await TasksPage());
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("No tasks yet")).not.toBeInTheDocument();
  });
});

describe("Field Routes page (GAP-FIELD-ROUTES-02/04)", () => {
  beforeEach(() => routesMock.mockReset());

  it("surfaces stop count, distance and agent", async () => {
    routesMock.mockResolvedValueOnce({
      data: [{ id: "r1", agent: "agent-1", routeDate: "2026-09-28", status: "draft", stopCount: 3, distanceKm: "12.50", durationMinutes: 95 }],
      source: "api",
    });
    render(await RoutesPage());
    expect(screen.getByText("Stops")).toBeInTheDocument();
    expect(screen.getByText("Distance")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("12.50 km")).toBeInTheDocument();
    expect(screen.getByText("agent-1")).toBeInTheDocument();
  });
});

describe("Field Agents page (GAP-FIELD-AGENTS-01/04)", () => {
  beforeEach(() => agentsMock.mockReset());

  it("renders one row per agent with a task count, not one row per task", async () => {
    agentsMock.mockResolvedValueOnce({
      data: [{ agentId: "a1", taskCount: 2 }, { agentId: "a2", taskCount: 5 }],
      source: "api",
    });
    render(await AgentsPage());
    expect(screen.getByText("Assigned tasks")).toBeInTheDocument();
    expect(screen.getByText("a1")).toBeInTheDocument();
    expect(screen.getByText("a2")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("a failed load shows a retry, never 'No agents yet'", async () => {
    agentsMock.mockResolvedValueOnce({ data: [], source: "error" });
    render(await AgentsPage());
    expect(screen.getAllByText(/try again|retry/i).length).toBeGreaterThan(0);
    expect(screen.queryByText("No agents yet")).not.toBeInTheDocument();
  });

  it("a 403 (non-supervisor) shows Access restricted, not a retry-able load error", async () => {
    agentsMock.mockResolvedValueOnce({ data: [], source: "error", status: 403, errorMessage: "requires one of: field_admin" });
    render(await AgentsPage());
    expect(screen.getByText(/access restricted/i)).toBeInTheDocument();
    expect(screen.queryByText(/try again|retry|check your connection/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/field_admin/)).not.toBeInTheDocument();
    expect(screen.queryByText("No agents yet")).not.toBeInTheDocument();
  });
});
