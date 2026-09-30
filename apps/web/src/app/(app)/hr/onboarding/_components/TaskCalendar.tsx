/**
 * TaskCalendar — column-per-due-day view of a joinee's onboarding tasks.
 * Tasks in past due columns that are not completed are highlighted amber.
 */

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

function addDays(iso: string, days: number): string {
  try {
    const d = new Date(iso);
    d.setDate(d.getDate() + days - 1);
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
  } catch {
    return "";
  }
}

const STATUS_DOT: Partial<Record<CalendarTask["status"], { color: string; label: string }>> = {
  completed:   { color: "var(--good, #067647)",    label: "Done" },
  pending:     { color: "var(--mut, #94a3b8)",        label: "Pending" },
  overdue:     { color: "var(--warn, #d97706)",       label: "Overdue" },
  in_progress: { color: "var(--indigo, #4f46e5)",    label: "In progress" },
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
      <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--heading, #1e293b)" }}>
        Onboarding Task Calendar
      </h3>
      {days.length === 0 ? (
        <p style={{ fontSize: 12, color: "var(--muted, #94a3b8)", fontStyle: "italic" }}>No tasks</p>
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
            const actualDate = joiningDate ? addDays(joiningDate, day) : null;

            return (
              <div
                key={day}
                role="listitem"
                style={{
                  border: `1px solid ${hasOverdue ? "var(--warnbd, #fde68a)" : "var(--border, #e2e8f0)"}`,
                  borderRadius: 10,
                  padding: 12,
                  background: hasOverdue ? "var(--warnbg, #fffbeb)" : "var(--card-bg, #fff)",
                }}
              >
                {/* Column header */}
                <div style={{ marginBottom: 10 }}>
                  <div
                    style={{
                      fontSize: 13,
                      fontWeight: 700,
                      color: hasOverdue ? "var(--warn, #92400e)" : "var(--heading, #1e293b)",
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
                    <div style={{ fontSize: 10, color: "var(--muted, #64748b)", marginTop: 1 }}>
                      {actualDate}
                    </div>
                  )}
                </div>

                {/* Task pills */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {colTasks.map((task) => {
                    const dot = STATUS_DOT[task.status] ?? { color: "var(--mut, #94a3b8)", label: "Pending" };
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
                          background: task.status === "overdue" ? "var(--warnbg, #fef3c7)" : "var(--bg, #f8fafc)",
                          border: `1px solid ${task.status === "overdue" ? "var(--warnbd, #fde68a)" : "var(--border, #e2e8f0)"}`,
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
                              color: task.status === "completed" ? "var(--muted, #64748b)" : "var(--body, #334155)",
                              textDecoration: task.status === "completed" ? "line-through" : "none",
                              lineHeight: 1.4,
                            }}
                          >
                            {task.title}
                          </div>
                          {task.description && (
                            <div style={{ fontSize: 10, color: "var(--muted, #94a3b8)", lineHeight: 1.4 }}>
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
