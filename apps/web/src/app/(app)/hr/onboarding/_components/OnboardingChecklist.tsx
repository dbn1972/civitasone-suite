"use client";

/**
 * OnboardingChecklist — interactive multi-step checklist for a new joinee.
 * Steps are presented in sequence; completed steps show a tick, in-progress
 * steps show a spinner, overdue steps show an amber warning.
 */

export type ChecklistStep = {
  id: string;
  label: string;
  description?: string;
  status: "pending" | "in_progress" | "completed" | "overdue";
  dueDay?: number;   // day-from-joining when this is due (e.g. 1, 3, 7, 30)
};

interface OnboardingChecklistProps {
  steps: ChecklistStep[];
  /** Called when HR marks a step done (optimistic UI). */
  onComplete?: (id: string) => void;
}

const STATUS_CONFIG: Record<
  ChecklistStep["status"],
  { icon: string; color: string; bg: string; label: string }
> = {
  completed: { icon: "✓", color: "#16a34a", bg: "#dcfce7", label: "Completed" },
  in_progress: { icon: "⟳", color: "#4f46e5", bg: "#ede9fe", label: "In progress" },
  overdue: { icon: "!", color: "#b45309", bg: "#fef3c7", label: "Overdue" },
  pending: { icon: "○", color: "#94a3b8", bg: "#f1f5f9", label: "Pending" },
};

export function OnboardingChecklist({ steps, onComplete }: OnboardingChecklistProps) {
  const total = steps.length;
  const done = steps.filter((s) => s.status === "completed").length;

  return (
    <div data-testid="onboarding-checklist">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: "var(--heading, #1e293b)" }}>
          Onboarding Checklist
        </h3>
        <span style={{ fontSize: 12, color: "var(--muted, #64748b)", fontWeight: 500 }}>
          {done} / {total} steps completed
        </span>
      </div>

      {/* Progress track */}
      <div
        style={{
          height: 6,
          background: "var(--border, #e2e8f0)",
          borderRadius: 99,
          marginBottom: 18,
          overflow: "hidden",
        }}
        role="progressbar"
        aria-valuenow={done}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-label="Checklist progress"
      >
        <div
          style={{
            height: "100%",
            width: `${(done / total) * 100}%`,
            background: "linear-gradient(90deg,#4f46e5,#7c3aed)",
            borderRadius: 99,
            transition: "width 0.4s ease",
          }}
        />
      </div>

      <ol
        style={{
          margin: 0,
          padding: 0,
          listStyle: "none",
          display: "flex",
          flexDirection: "column",
          gap: 2,
        }}
        aria-label="Onboarding steps"
      >
        {steps.map((step, idx) => {
          const cfg = STATUS_CONFIG[step.status];
          const isLast = idx === steps.length - 1;

          return (
            <li
              key={step.id}
              data-testid={`checklist-step-${step.id}`}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: 12,
                position: "relative",
                paddingBottom: isLast ? 0 : 14,
              }}
            >
              {/* Connector line */}
              {!isLast && (
                <div
                  aria-hidden
                  style={{
                    position: "absolute",
                    left: 15,
                    top: 30,
                    width: 2,
                    height: "100%",
                    background:
                      step.status === "completed"
                        ? "#d1fae5"
                        : "var(--border, #e2e8f0)",
                  }}
                />
              )}

              {/* Status icon */}
              <div
                aria-hidden
                style={{
                  flexShrink: 0,
                  width: 30,
                  height: 30,
                  borderRadius: "50%",
                  background: cfg.bg,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: step.status === "completed" ? 14 : 13,
                  fontWeight: 800,
                  color: cfg.color,
                  border: `2px solid ${cfg.color}22`,
                  zIndex: 1,
                }}
              >
                {cfg.icon}
              </div>

              {/* Label + description */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontSize: 13,
                      fontWeight: step.status === "completed" ? 500 : 600,
                      color:
                        step.status === "completed"
                          ? "var(--muted, #64748b)"
                          : "var(--body, #334155)",
                      textDecoration:
                        step.status === "completed" ? "line-through" : "none",
                    }}
                  >
                    {step.label}
                  </span>
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 99,
                      background: cfg.bg,
                      color: cfg.color,
                    }}
                  >
                    {cfg.label}
                  </span>
                  {step.dueDay !== undefined && (
                    <span style={{ fontSize: 10, color: "var(--muted, #64748b)" }}>
                      Day {step.dueDay}
                    </span>
                  )}
                </div>
                {step.description && (
                  <p
                    style={{
                      margin: "2px 0 0",
                      fontSize: 12,
                      color: "var(--muted, #64748b)",
                      lineHeight: 1.5,
                    }}
                  >
                    {step.description}
                  </p>
                )}
              </div>

              {/* Mark done button (HR can mark) */}
              {onComplete && step.status !== "completed" && (
                <button
                  onClick={() => onComplete(step.id)}
                  aria-label={`Mark "${step.label}" as complete`}
                  style={{
                    flexShrink: 0,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#4f46e5",
                    background: "none",
                    border: "1px solid #c7d2fe",
                    borderRadius: 6,
                    padding: "3px 8px",
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                  }}
                >
                  Mark done
                </button>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
