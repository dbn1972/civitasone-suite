import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const getTasksMock = vi.fn();
const getSessionUserIdMock = vi.fn();

vi.mock("../_data/workflowData", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("../_data/workflowData");
  return { ...actual, getTasks: (...a: unknown[]) => getTasksMock(...a) };
});
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workflow/my-tasks",
}));

import MyTasksPage from "./page";

const ME = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";

function task(id: string, over: Record<string, unknown> = {}) {
  return {
    id, instanceId: `inst-${id}`, name: `Task ${id}`, status: "pending",
    roleRef: null, nodeKey: "review", refType: "leave_app", refId: null,
    decision: null, assigneeId: null, createdAt: "2026-01-10T09:00:00.000Z",
    dueAt: null, version: 1, ...over,
  };
}

describe("MyTasksPage — GAP-WORKFLOW-MY-TASKS-03/05", () => {
  beforeEach(() => {
    getTasksMock.mockReset();
    getSessionUserIdMock.mockReset();
    getSessionUserIdMock.mockReturnValue(ME);
  });

  it("counts only tasks assigned to me in 'Claimed by me'", async () => {
    getTasksMock.mockResolvedValue({
      data: [task("a", { assigneeId: ME }), task("b", { assigneeId: OTHER }), task("c")],
      source: "api",
    });
    render(await MyTasksPage());
    expect(screen.getByText("Claimed by me")).toBeInTheDocument();
    // Open=3, Unassigned=1, Claimed by me=1 (only task a).
    expect(screen.getByText("3")).toBeInTheDocument();
    // Exactly two "1" values (Unassigned + Claimed by me).
    expect(screen.getAllByText("1").length).toBeGreaterThanOrEqual(2);
  });

  it("shows a Try again action and '—' stats when the task fetch fails", async () => {
    getTasksMock.mockResolvedValue({ data: [], source: "error" });
    render(await MyTasksPage());
    expect(screen.getByText("We couldn't load your tasks.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /try again/i })).toBeInTheDocument();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("shows a truncation notice when the inbox hits the 200-task cap (GAP-WORKFLOW-MY-TASKS-04)", async () => {
    const many = Array.from({ length: 200 }, (_, i) => task(`t${i}`));
    getTasksMock.mockResolvedValue({ data: many, source: "api" });
    render(await MyTasksPage());
    expect(screen.getByText(/Showing the first 200 tasks/)).toBeInTheDocument();
  });

  it("does not render a redundant 'Pending' stat (same as Open)", async () => {
    getTasksMock.mockResolvedValue({ data: [task("a")], source: "api" });
    const { container } = render(await MyTasksPage());
    // No stat tile is labelled "Pending" (the old redundant stat). Scope to the
    // StatCard label element so an in-table "Pending" status pill doesn't match.
    const statLabels = Array.from(container.querySelectorAll(".lab")).map((n) => n.textContent);
    expect(statLabels).not.toContain("Pending");
    expect(statLabels).toContain("Open tasks");
    expect(statLabels).toContain("Claimed by me");
  });
});
