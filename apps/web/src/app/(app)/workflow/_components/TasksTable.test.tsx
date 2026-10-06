import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { TasksTable } from "./TasksTable";
import type { WorkflowTask } from "../_data/workflowTypes";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/workflow/my-tasks",
}));

function task(id: string, over: Partial<WorkflowTask> = {}): WorkflowTask {
  return {
    id,
    instanceId: `inst-${id}`,
    name: `Task ${id}`,
    status: "pending",
    roleRef: null,
    nodeKey: "review",
    refType: "leave_app",
    refId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    decision: null,
    assigneeId: null,
    createdAt: "2026-01-10T09:00:00.000Z",
    dueAt: null,
    version: 1,
    ...over,
  };
}

describe("TasksTable — GAP-WORKFLOW-MY-TASKS-02/05", () => {
  it("renders an enriched Subject (refType + short refId)", () => {
    render(<TasksTable tasks={[task("1")]} showStatusFilter={false} />);
    expect(screen.getByText(/Leave App ·/)).toBeInTheDocument();
  });

  it("renders an Overdue pill for a task whose dueAt is in the past", () => {
    render(<TasksTable tasks={[task("1", { dueAt: "2000-01-01T00:00:00.000Z" })]} showStatusFilter={false} />);
    expect(screen.getByText(/Overdue ·/)).toBeInTheDocument();
  });

  it("sorts the most-overdue / oldest task first by default", () => {
    const overdue = task("old", { dueAt: "2000-01-01T00:00:00.000Z" });
    const future = task("new", { dueAt: "2999-01-01T00:00:00.000Z" });
    render(<TasksTable tasks={[future, overdue]} showStatusFilter={false} />);
    const rows = screen.getAllByRole("row");
    // rows[0] is the header; the first data row should be the overdue one.
    const firstDataRow = rows[1];
    expect(within(firstDataRow).getByText("Task old")).toBeInTheDocument();
  });

  it("renders a labelled 'Open instance' link, not a bare uuid fragment", () => {
    render(<TasksTable tasks={[task("1")]} showStatusFilter={false} />);
    const link = screen.getByRole("link", { name: /open instance/i });
    expect(link).toHaveAttribute("href", "/workflow/instances/inst-1");
  });

  it("hides the status filter when showStatusFilter is false", () => {
    render(<TasksTable tasks={[task("1")]} showStatusFilter={false} />);
    // StatusFilter is a radiogroup; it must be absent on the single-status inbox.
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
  });
});
