/**
 * TaskCalendar — column-per-due-day view of a joinee's onboarding tasks.
 * Tasks in past due columns that are not completed are highlighted amber.
 */
import { formatInIST, addDaysIST } from "@/lib/formatters";


export type CalendarTask = {
  id: string;
  title: string;
  description?: string;
  /** Real day-from-joining this task is due (hrms_onboarding_tasks.due_by_day). */
  dueByDay: number;
  status: "pending" | "in_progress" | "completed" | "overdue";
  category?: string;
};

interface TaskCalendarProps {
  tasks: CalendarTask[];
  joiningDate?: string;   // ISO string — used to label columns with actual dates
}

/**
 * The column's real calendar date: joining date + dueByDay days -- exactly how the overdue rule (page.tsx
 * deriveStatus, and hrms-service buildOnboardingSummaryRows) computes a task's due date. It used to label
 * the column with joining + (dueByDay - 1), one day earlier than the date the task actually turns overdue
 * on (GAP-HR-ONBOARDING-DETAIL-06).
 */
function dueDateLabel(iso: string, dueByDay: number): string {
  try {
    const shifted = addDaysIST(iso, dueByDay);
    return shifted === "—" ? "" : formatInIST(shifted, { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

const STATUS_DOT: Partial<Record<CalendarTask["status"], { color: string; label: string }>> = {
  completed:   { color: "var(--good)",    label: "Done" },
  pending:     { color: "var(--mut)",        label: "Pending" },
  overdue:     { color: "var(--warn)",       label: "Overdue" },
  in_progress: { color: "var(--indigo)",    label: "In progress" },
};

export function TaskCalendar({ tasks, joiningDate }: TaskCalendarProps) {
  // GAP-HR-ONBOARDING-DETAIL-06: columns are the tasks' own real due days,
  // not snapped to the nearest of 4 fixed milestones (1/3/7/30) -- the old
  // approach put a Day 14 task under the "Day 7" column (|14-7|=7 is closer
  // than |30-14|=16), silently misrepresenting when it's actually due. A
  // tenant whose tasks land on [1, 3, 7, 14, 30] now gets 5 real columns
  // instead of losing day 14 into day 7.
  const days = [...new Set(tasks.map((t) => t.dueByDay))].sort((a, b) => a - b);

  return (
    <div data-testid="task-calendar">
      <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--heading)" }}>
        Onboarding Task Calendar
      </h3>
      {days.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic" }}>No tasks</p>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${days.length}, minmax(120px, 1fr))`,
            gap: 10,
            overflowX: "auto",
          }}
          role="list"
          aria-label="Onboarding due-day columns"
        >
          {days.map((day) => {
            const colTasks = tasks.filter((t) => t.dueByDay === day);
            const hasOverdue = colTasks.some((t) => t.status === "overdue");
            const actualDate = joiningDate ? dueDateLabel(joiningDate, day) : null;

            return (
              <div
                key={day}
                role="listitem"
                style={{
                  border: `1px solid ${hasOverdue ? "var(--warnbd)" : "var(--border)"}`,
                  borderRadius: 10,
                  padding: 12,
                  background: hasOverdue ? "var(--warnbg)" : "var(--card-bg)",
                }}
              >
                {/* Column header */}
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: hasOverdue ? "var(--warn)" : "var(--heading)",
                    }}
                  >
                    {`Day ${day}`}
                    {hasOverdue && (
                      <span
                        aria-label="has overdue tasks"
                        style={{ marginInlineStart: 4, fontSize: 11 }}
                      >
                        ⚠
                      </span>
                    )}
                  </div>
                  {actualDate && (
                    <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 1 }}>
                      {actualDate}
                    </div>
                  )}
                </div>

                {/* Task pills */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {colTasks.map((task) => {
                    const dot = STATUS_DOT[task.status] ?? { color: "var(--mut)", label: "Pending" };
                    return (
                      <div
                        key={task.id}
                        data-testid={`calendar-task-${task.id}`}
                        style={{
                          display: "flex",
                          alignItems: "flex-start",
                          gap: 6,
                          padding: "6px 8px",
                          borderRadius: 6,
                          background: task.status === "overdue" ? "var(--warnbg)" : "var(--bg)",
                          border: `1px solid ${task.status === "overdue" ? "var(--warnbd)" : "var(--border)"}`,
                        }}
                      >
                        <div
                          aria-hidden
                          style={{
                            flexShrink: 0,
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: dot.color,
                            marginTop: 3,
                          }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: task.status === "completed" ? "var(--muted)" : "var(--body)",
                              textDecoration: task.status === "completed" ? "line-through" : "none",
                              lineHeight: 1.4,
                            }}
                          >
                            {task.title}
                          </div>
                          {task.description && (
                            <div style={{ fontSize: 10, color: "var(--muted)", lineHeight: 1.4 }}>
                              {task.description}
                            </div>
                          )}
                          <div
                            style={{
                              fontSize: 9,
                              fontWeight: 600,
                              color: dot.color,
                              marginTop: 2,
                              textTransform: "uppercase",
                              letterSpacing: "0.04em",
                            }}
                          >
                            {dot.label}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
