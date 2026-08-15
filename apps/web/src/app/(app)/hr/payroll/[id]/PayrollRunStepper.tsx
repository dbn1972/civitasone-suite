"use client";

const STEPS = [
  { key: "data-lock", label: "Data Lock" },
  { key: "calculate", label: "Calculate" },
  { key: "review", label: "Review" },
  { key: "approve", label: "Approve" },
  { key: "disburse", label: "Disburse" },
] as const;

function statusToStepIndex(status: string): number {
  switch (status) {
    case "draft":      return 0;
    case "processing": return 1;
    case "completed":  return 2;
    case "approved":   return 3;
    case "paid":
    case "disbursed":  return 4;
    case "failed":     return 3;
    default:           return 0;
  }
}

type StepState = "done" | "current" | "error" | "pending";

function Spinner() {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-block",
        width: 14,
        height: 14,
        borderRadius: "50%",
        border: "2.5px solid rgba(255,255,255,0.35)",
        borderTopColor: "#fff",
        animation: "prs-spin 0.75s linear infinite",
      }}
    />
  );
}

export function PayrollRunStepper({ status }: { status: string }) {
  const curIdx  = statusToStepIndex(status);
  const allDone = status === "paid" || status === "disbursed";
  const failed  = status === "failed";

  const stateOf = (i: number): StepState => {
    if (allDone)       return "done";
    if (i < curIdx)    return "done";
    if (i === curIdx)  return failed ? "error" : "current";
    return "pending";
  };

  return (
    <div style={{ padding: "16px 0 8px" }}>
      <style>{`
        @keyframes prs-spin { to { transform: rotate(360deg); } }
      `}</style>
      <ol
        aria-label="Payroll run progress"
        style={{ display: "flex", listStyle: "none", margin: 0, padding: 0 }}
      >
        {STEPS.map((step, i) => {
          const st    = stateOf(i);
          const isLast = i === STEPS.length - 1;

          const circleColor =
            st === "done"    ? "var(--success,#16a34a)"   :
            st === "current" ? "var(--primary,#2563eb)"   :
            st === "error"   ? "var(--danger,#dc2626)"    :
                               "var(--line,#cbd5e1)";

          const circleBg =
            st === "done"    ? "var(--goodbg,#f0fdf4)"   :
            st === "current" ? "var(--primary,#2563eb)"  :
            st === "error"   ? "var(--badbg,#fef2f2)"    :
                               "var(--surface,#fff)";

          const circleText =
            st === "done"    ? "var(--success,#16a34a)"  :
            st === "current" ? "#fff"                    :
            st === "error"   ? "var(--danger,#dc2626)"   :
                               "var(--mut,#94a3b8)";

          const labelColor =
            st === "done"    ? "var(--success,#16a34a)"  :
            st === "current" ? "var(--primary,#2563eb)"  :
            st === "error"   ? "var(--danger,#dc2626)"   :
                               "var(--mut,#94a3b8)";

          const lineColor  = i < curIdx ? "var(--success,#16a34a)" : "var(--line,#e2e8f0)";

          return (
            <li
              key={step.key}
              style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}
            >
              {/* Row: circle + connector */}
              <div style={{ display: "flex", alignItems: "center", width: "100%" }}>
                <div
                  aria-current={st === "current" ? "step" : undefined}
                  style={{
                    width: 32, height: 32,
                    borderRadius: "50%",
                    flexShrink: 0,
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13, fontWeight: 700,
                    border: `2px solid ${circleColor}`,
                    background: circleBg,
                    color: circleText,
                    transition: "all 0.2s",
                  }}
                >
                  {st === "done"    ? "✓"         :
                   st === "current" ? <Spinner />  :
                   st === "error"   ? "✕"          :
                   i + 1}
                </div>
                {!isLast && (
                  <div
                    style={{
                      flex: 1, height: 2,
                      background: lineColor,
                      transition: "background 0.2s",
                    }}
                  />
                )}
              </div>
              {/* Label */}
              <div
                style={{
                  marginTop: 6,
                  fontSize: 11,
                  fontWeight: st === "current" || st === "done" ? 700 : 500,
                  color: labelColor,
                  textAlign: "center",
                  letterSpacing: "0.25px",
                  paddingRight: isLast ? 0 : 8,
                }}
              >
                {step.label}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
