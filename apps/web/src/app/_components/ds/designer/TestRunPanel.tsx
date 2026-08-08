"use client";

export type TestStepStatus = "pending" | "running" | "pass" | "fail";

export interface TestRunStep {
  id: string;
  label: string;
  status: TestStepStatus;
  error?: string;
  blockLink?: string;
}

export interface TestRunPanelProps {
  steps: TestRunStep[];
  onRun?: () => void;
  running?: boolean;
}

function statusIcon(status: TestStepStatus): string {
  switch (status) {
    case "pass": return "✓";
    case "fail": return "✗";
    case "running": return "…";
    default: return "○";
  }
}

export function TestRunPanel({ steps, onRun, running }: TestRunPanelProps) {
  return (
    <div>
      <p style={{ color: "var(--mut)", marginTop: 0 }}>
        A service must pass this test before it can be submitted.
      </p>
      <button type="button" className="btn primary" onClick={onRun} disabled={running}>
        {running ? "Running…" : "Run sandbox test"}
      </button>
      <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 8 }}>
        {steps.map((step) => (
          <li
            key={step.id}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 10,
              padding: "10px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-sm)",
              background: step.status === "fail" ? "var(--bad-bg)" : "var(--panel)",
            }}
          >
            <span aria-hidden style={{ fontWeight: 700, color: step.status === "fail" ? "var(--bad-fg)" : "var(--mut)" }}>
              {statusIcon(step.status)}
            </span>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 500 }}>{step.label}</div>
              {step.error ? (
                <p style={{ margin: "4px 0 0", fontSize: 13, color: "var(--bad-fg)" }}>{step.error}</p>
              ) : null}
              {step.blockLink ? (
                <a href={step.blockLink} style={{ fontSize: 12 }}>Go to block</a>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}
