"use client";

import Link from "next/link";
import { DataTable } from "../DataTable";

export type TestStepStatus = "pending" | "running" | "pass" | "fail";

export interface TestRunStep {
  id: string;
  label: string;
  status: TestStepStatus;
  error?: string;
  blockLink?: string;
  artifacts?: Record<string, unknown>;
}

export interface TestRunHistoryRow extends Record<string, unknown> {
  id: string;
  status: string;
  durationMs: number | null;
  createdAt: string;
}

export interface TestRunPanelProps {
  definitionId: string;
  steps: TestRunStep[];
  history: TestRunHistoryRow[];
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

function resolveBlockLink(definitionId: string, link?: string): string | undefined {
  if (!link) return undefined;
  return link.replace("__ID__", definitionId);
}

export function TestRunPanel({ definitionId, steps, history, onRun, running }: TestRunPanelProps) {
  return (
    <div>
      <p style={{ color: "var(--mut)", marginTop: 0 }}>
        A service must pass this test before it can be submitted.
      </p>
      <button type="button" className="btn primary" onClick={onRun} disabled={running}>
        {running ? "Running…" : "Run sandbox test"}
      </button>
      <ol style={{ listStyle: "none", margin: "16px 0 0", padding: 0, display: "grid", gap: 8 }}>
        {steps.map((step) => {
          const href = resolveBlockLink(definitionId, step.blockLink);
          return (
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
                {step.artifacts?.sampleLines ? (
                  <ul style={{ margin: "6px 0 0", paddingLeft: 18, fontSize: 12, color: "var(--ink2)" }}>
                    {(step.artifacts.sampleLines as { label?: string; amountMinor?: number }[]).map((line, i) => (
                      <li key={i}>{line.label ?? "Line"} — ₹{((line.amountMinor ?? 0) / 100).toFixed(2)}</li>
                    ))}
                  </ul>
                ) : null}
                {step.artifacts?.previewUrl ? (
                  <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--mut)" }}>Certificate preview ready (sandbox)</p>
                ) : null}
                {href && step.status === "fail" ? (
                  <Link href={href} style={{ fontSize: 12 }}>Go to block</Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>

      <h3 style={{ margin: "24px 0 8px", fontSize: 15, color: "var(--ink)" }}>Recent runs</h3>
      <DataTable<TestRunHistoryRow>
        columns={[
          { key: "createdAt", label: "Run at", render: (row) => new Date(row.createdAt).toLocaleString() },
          { key: "status", label: "Result", cellType: "status" },
          {
            key: "durationMs",
            label: "Duration",
            render: (row) => (row.durationMs != null ? `${row.durationMs} ms` : "—"),
          },
        ]}
        rows={history}
        emptyTitle="No test runs yet"
        emptyMessage="Run the sandbox test to validate your service wiring."
        pageSize={10}
      />
    </div>
  );
}
