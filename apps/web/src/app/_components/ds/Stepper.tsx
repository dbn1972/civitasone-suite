/**
 * Stepper — an accessible progress indicator for linear, multi-step flows.
 *
 * GAP-ESTAB-WORKSPACE-06: replaces ad-hoc rows of <div>s (no list semantics,
 * no aria-current, hard-coded hex state colours) with a semantic ordered list
 * where exactly one item carries aria-current="step", completed items expose
 * visually-hidden "completed" text, and all state colour comes from design
 * tokens (--accent, --good, --line, --ink, --mut) so it tracks light/dark
 * theme and clears contrast. Reused across any wizard, not just the eOffice
 * one — the existing app/_components/Wizard.tsx manages its own internal step
 * state and renders its own (non-semantic) indicator, so it does not fit a flow
 * that drives the active step externally; this is the shared primitive for that.
 */

export interface StepperProps {
  /** Ordered step labels, start → finish. */
  steps: readonly string[];
  /** Zero-based index of the current step. */
  current: number;
  /** Accessible name for the list (e.g. "Progress"). */
  ariaLabel?: string;
}

export function Stepper({ steps, current, ariaLabel = "Progress" }: StepperProps) {
  return (
    <ol
      aria-label={ariaLabel}
      style={{
        display: "flex",
        gap: 8,
        flexWrap: "wrap",
        listStyle: "none",
        margin: 0,
        padding: 0,
      }}
    >
      {steps.map((label, i) => {
        const state = i < current ? "done" : i === current ? "current" : "upcoming";
        const bubbleBg =
          state === "done" ? "var(--good)" : state === "current" ? "var(--accent)" : "var(--line)";
        const bubbleColor = state === "upcoming" ? "var(--ink)" : "#fff";
        const textColor =
          state === "current" ? "var(--ink)" : state === "done" ? "var(--good)" : "var(--mut)";
        return (
          <li
            key={label}
            aria-current={state === "current" ? "step" : undefined}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "0.8125rem",
              color: textColor,
              fontWeight: state === "current" ? 600 : 400,
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 22,
                height: 22,
                borderRadius: "50%",
                display: "grid",
                placeItems: "center",
                fontSize: 12,
                background: bubbleBg,
                color: bubbleColor,
              }}
            >
              {state === "done" ? "✓" : i + 1}
            </span>
            <span>{label}</span>
            {state === "done" ? (
              <span
                style={{
                  position: "absolute",
                  width: 1,
                  height: 1,
                  padding: 0,
                  margin: -1,
                  overflow: "hidden",
                  clip: "rect(0 0 0 0)",
                  whiteSpace: "nowrap",
                  border: 0,
                }}
              >
                (completed)
              </span>
            ) : null}
            {i < steps.length - 1 ? (
              <span aria-hidden="true" style={{ color: "var(--line)" }}>
                ›
              </span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}
