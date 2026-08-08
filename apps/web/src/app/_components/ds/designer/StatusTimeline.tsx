"use client";

import type { FormDesignState } from "./formTypes";

export type TimelineStepState = "done" | "current" | "upcoming";

export interface StatusTimelineStep {
  id: string;
  label: string;
  state: TimelineStepState;
  date?: string;
  slaDaysRemaining?: number;
}

export interface StatusTimelineProps {
  steps: StatusTimelineStep[];
  "aria-label"?: string;
}

export function StatusTimeline({ steps, "aria-label": ariaLabel = "Application progress" }: StatusTimelineProps) {
  return (
    <ol
      aria-label={ariaLabel}
      style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 0 }}
    >
      {steps.map((step, idx) => {
        const isLast = idx === steps.length - 1;
        const dotColor =
          step.state === "done" ? "var(--good-fg, #027a48)"
            : step.state === "current" ? "var(--info-fg, #175cd3)"
              : "var(--mut, #667085)";
        return (
          <li
            key={step.id}
            style={{
              display: "grid",
              gridTemplateColumns: "24px 1fr",
              gap: "4px 12px",
              paddingBottom: isLast ? 0 : 16,
              position: "relative",
            }}
          >
            {!isLast ? (
              <span
                aria-hidden
                style={{
                  position: "absolute",
                  left: 11,
                  top: 20,
                  bottom: 0,
                  width: 2,
                  background: step.state === "done" ? "var(--good-fg, #027a48)" : "var(--line)",
                }}
              />
            ) : null}
            <span
              aria-hidden
              style={{
                width: 12,
                height: 12,
                borderRadius: "50%",
                marginTop: 4,
                marginLeft: 6,
                background: dotColor,
                boxShadow: step.state === "current" ? `0 0 0 3px var(--info-bg, #eff8ff)` : undefined,
              }}
            />
            <div>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                <strong style={{ fontSize: 14 }}>{step.label}</strong>
                {step.state === "current" && step.slaDaysRemaining != null ? (
                  <span
                    style={{
                      fontSize: 11,
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "var(--warn-bg, #fffaeb)",
                      color: "var(--warn-fg, #b54708)",
                      fontWeight: 600,
                    }}
                  >
                    {step.slaDaysRemaining}d SLA
                  </span>
                ) : null}
              </div>
              {step.date ? (
                <span style={{ fontSize: 12, color: "var(--mut)" }}>{step.date}</span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}

/** Extract embedded formDesign from a published service definition (FN-13). */
export function formDesignFromService(forms: unknown[] | undefined): FormDesignState | null {
  if (!Array.isArray(forms) || forms.length === 0) return null;
  const first = forms[0];
  if (typeof first !== "object" || first === null) return null;
  const fd = (first as { formDesign?: FormDesignState }).formDesign;
  if (!fd?.sections || !fd?.fields) return null;
  return fd;
}
