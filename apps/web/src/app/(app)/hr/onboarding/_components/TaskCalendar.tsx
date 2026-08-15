/**
 * TaskCalendar — week-view showing onboarding tasks by milestone day.
 * Columns: Day 1 · Day 3 · Day 7 · Day 30 (standard onboarding milestones).
 * Tasks in past due columns that are not completed are highlighted amber.
 */

export type CalendarTask = {
  id: string;
  title: string;
  description?: string;
  milestoneDay: 1 | 3 | 7 | 30;
  status: "pending" | "in_progress" | "completed" | "overdue";
  category?: string;
};

interface TaskCalendarProps {
  tasks: CalendarTask[];
  joiningDate?: string;   // ISO string — used to label columns with actual dates
}

const MILESTONES: { day: 1 | 3 | 7 | 30; label: string; sub: string }[] = [
  { day: 1, label: "Day 1", sub: "First day" },
  { day: 3, label: "Day 3", sub: "Early setup" },
  { day: 7, label: "Day 7", sub: "First week" },
  { day: 30, label: "Day 30", sub: "First month" },
];

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
  completed: { color: "#16a34a", label: "Done" },
  pending: { color: "#94a3b8", label: "Pending" },
  overdue: { color: "#d97706", label: "Overdue" },
  in_progress: { color: "#4f46e5", label: "In progress" },
};

export function TaskCalendar({ tasks, joiningDate }: TaskCalendarProps) {
  return (
    <div data-testid="task-calendar">
      <h3 style={{ margin: "0 0 14px", fontSize: 15, fontWeight: 700, color: "var(--heading, #1e293b)" }}>
        Onboarding Task Calendar
      </h3>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 10,
        }}
        role="list"
        aria-label="Onboarding milestone columns"
      >
        {MILESTONES.map(({ day, label, sub }) => {
          const colTasks = tasks.filter((t) => t.milestoneDay === day);
          const hasOverdue = colTasks.some((t) => t.status === "overdue");
          const actualDate = joiningDate ? addDays(joiningDate, day) : null;

          return (
            <div
              key={day}
              role="listitem"
              style={{
                border: `1px solid ${hasOverdue ? "#fde68a" : "var(--border, #e2e8f0)"}`,
                borderRadius: 10,
                padding: 12,
                background: hasOverdue ? "#fffbeb" : "var(--card-bg, #fff)",
              }}
            >
              {/* Column header */}
              <div style={{ marginBottom: 10 }}>
                <div
                  style={{
                    fontSize: 13,
                    fontWeight: 700,
                    color: hasOverdue ? "#92400e" : "var(--heading, #1e293b)",
                  }}
                >
                  {label}
                  {hasOverdue && (
                    <span
                      aria-label="has overdue tasks"
                      style={{ marginLeft: 4, fontSize: 11 }}
                    >
                      ⚠
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 10, color: "var(--muted, #64748b)", marginTop: 1 }}>
                  {actualDate ? actualDate : sub}
                </div>
              </div>

              {/* Task pills */}
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {colTasks.length === 0 ? (
                  <span style={{ fontSize: 11, color: "var(--muted, #94a3b8)", fontStyle: "italic" }}>
                    No tasks
                  </span>
                ) : (
                  colTasks.map((task) => {
                    const dot = STATUS_DOT[task.status] ?? { color: "#94a3b8", label: "Pending" };
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
                          background: task.status === "overdue" ? "#fef3c7" : "#f8fafc",
                          border: `1px solid ${task.status === "overdue" ? "#fde68a" : "var(--border, #e2e8f0)"}`,
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
                  })
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
