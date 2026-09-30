import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { TaskCalendar, type CalendarTask } from "./TaskCalendar";

function task(overrides: Partial<CalendarTask> & { id: string; title: string; dueByDay: number }): CalendarTask {
  return { status: "pending", ...overrides };
}

describe("TaskCalendar", () => {
  // GAP-HR-ONBOARDING-DETAIL-06 regression: a day-14 task used to be snapped
  // into the "Day 7" column (nearest of the fixed [1,3,7,30] milestones,
  // since |14-7|=7 < |30-14|=16), silently misrepresenting when it's due.
  it("shows a real 'Day 14' column instead of folding it into Day 7", () => {
    render(
      <TaskCalendar
        tasks={[
          task({ id: "t1", title: "Week-one check-in", dueByDay: 7 }),
          task({ id: "t2", title: "Mid-onboarding review", dueByDay: 14 }),
        ]}
      />,
    );

    expect(screen.getByText("Day 7")).toBeInTheDocument();
    expect(screen.getByText("Day 14")).toBeInTheDocument();
    expect(screen.queryByText("Day 30")).not.toBeInTheDocument();
  });

  it("only creates columns for due days that actually have tasks", () => {
    render(<TaskCalendar tasks={[task({ id: "t1", title: "Submit ID", dueByDay: 1 })]} />);
    expect(screen.getByText("Day 1")).toBeInTheDocument();
    expect(screen.queryByText("Day 3")).not.toBeInTheDocument();
  });

  it("orders columns by day ascending regardless of task order", () => {
    render(
      <TaskCalendar
        tasks={[
          task({ id: "t1", title: "Later task", dueByDay: 30 }),
          task({ id: "t2", title: "Earlier task", dueByDay: 1 }),
        ]}
      />,
    );
    const headings = screen.getAllByText(/^Day \d+$/).map((el) => el.textContent);
    expect(headings).toEqual(["Day 1", "Day 30"]);
  });

  it("shows the 'No tasks' state when given an empty list", () => {
    render(<TaskCalendar tasks={[]} />);
    expect(screen.getByText("No tasks")).toBeInTheDocument();
  });

  it("marks a column with an overdue-tasks indicator when any task in it is overdue", () => {
    render(<TaskCalendar tasks={[task({ id: "t1", title: "Late task", dueByDay: 3, status: "overdue" })]} />);
    expect(screen.getByLabelText("has overdue tasks")).toBeInTheDocument();
  });
});
