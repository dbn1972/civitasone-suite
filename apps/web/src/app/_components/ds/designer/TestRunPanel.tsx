"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { DataTable } from "../DataTable";
import {
  formatPaise,
  parseDemandLines,
  parseJournalPreview,
  resolveThreePartError,
} from "@/app/(app)/designer/_data/sandboxTestModel";

export type TestStepStatus = "pending" | "running" | "pass" | "fail";

export interface TestRunStep {
  id: string;
  label: string;
  status: TestStepStatus;
  /** Backend skip mapped to pass with skipped flag for muted UI. */
  skipped?: boolean;
  error?: string;
  why?: string;
  next?: string;
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

function statusIcon(status: TestStepStatus, skipped?: boolean): string {
  if (skipped) return "–";
  switch (status) {
    case "pass": return "✓";
    case "fail": return "✗";
    case "running": return "…";
    default: return "○";
  }
}

function statusLabel(status: TestStepStatus, skipped?: boolean): string {
  if (skipped) return "Skipped";
  switch (status) {
    case "pass": return "Pass";
    case "fail": return "Fail";
    case "running": return "Running";
    default: return "Pending";
  }
}

function resolveBlockLink(definitionId: string, link?: string): string | undefined {
  if (!link) return undefined;
  return link.replace("__ID__", definitionId);
}

function StepArtifacts({ artifacts }: { artifacts?: Record<string, unknown> }) {
  if (!artifacts) return null;
  const lines = parseDemandLines(artifacts);
  const journal = parseJournalPreview(artifacts);
  const previewUrl = typeof artifacts.previewUrl === "string" ? artifacts.previewUrl : null;
  const consumer = typeof artifacts.consumerCode === "string" ? artifacts.consumerCode : null;

  if (lines.length === 0 && !journal && !previewUrl && !consumer) return null;

  return (
    <div style={{ marginTop: 8, display: "grid", gap: 6, fontSize: 12, color: "var(--ink2)" }}>
      {lines.length > 0 ? (
        <div>
          <div style={{ fontWeight: 600, marginBottom: 2 }}>Demand lines</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {lines.map((line, i) => (
              <li key={i}>
                {line.label}
                {line.taxHeadCode ? ` (${line.taxHeadCode})` : ""} — {formatPaise(line.amountMinor)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {journal ? (
        <p style={{ margin: 0 }}>
          GL preview: Dr {journal.debit} / Cr {journal.credit} · {formatPaise(journal.amountMinor)}
        </p>
      ) : null}
      {consumer ? (
        <p style={{ margin: 0 }}>Sandbox payment: {consumer} ({String(artifacts.status ?? "captured")})</p>
      ) : null}
      {previewUrl ? (
        <p style={{ margin: 0 }}>
          Certificate preview ready (sandbox)
          {" · "}
          <a href={previewUrl} target="_blank" rel="noreferrer">Open sample PDF</a>
        </p>
      ) : null}
    </div>
  );
}

function FailDetails({ step }: { step: TestRunStep }) {
  const three = resolveThreePartError({
    error: step.error,
    why: step.why,
    next: step.next,
  });
  if (!three) return null;
  return (
    <dl
      style={{
        margin: "8px 0 0",
        display: "grid",
        gap: 6,
        fontSize: 13,
        color: "var(--bad-fg)",
      }}
    >
      <div>
        <dt style={{ fontWeight: 600, margin: 0 }}>What happened</dt>
        <dd style={{ margin: "2px 0 0" }}>{three.what}</dd>
      </div>
      <div>
        <dt style={{ fontWeight: 600, margin: 0 }}>Why</dt>
        <dd style={{ margin: "2px 0 0" }}>{three.why}</dd>
      </div>
      <div>
        <dt style={{ fontWeight: 600, margin: 0 }}>What to do next</dt>
        <dd style={{ margin: "2px 0 0" }}>{three.next}</dd>
      </div>
    </dl>
  );
}

export function TestRunPanel({ definitionId, steps, history, onRun, running }: TestRunPanelProps) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    const next: Record<string, boolean> = {};
    for (const step of steps) {
      if (step.status === "fail") next[step.id] = true;
    }
    setExpanded((prev) => ({ ...prev, ...next }));
  }, [steps]);

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
          const isFail = step.status === "fail";
          const isOpen = Boolean(expanded[step.id]);
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
                background: isFail ? "var(--bad-bg)" : "var(--panel)",
              }}
            >
              <span
                aria-hidden
                style={{
                  fontWeight: 700,
                  color: isFail
                    ? "var(--bad-fg)"
                    : step.status === "pass" && !step.skipped
                      ? "var(--good)"
                      : "var(--mut)",
                }}
              >
                {statusIcon(step.status, step.skipped)}
              </span>
              <div style={{ flex: 1 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <span style={{ fontWeight: 500 }}>{step.label}</span>
                  <span style={{ fontSize: 12, color: "var(--mut)" }}>
                    {statusLabel(step.status, step.skipped)}
                  </span>
                  {isFail ? (
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ fontSize: 12, padding: "2px 8px" }}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded((prev) => ({ ...prev, [step.id]: !prev[step.id] }))}
                    >
                      {isOpen ? "Hide details" : "Show details"}
                    </button>
                  ) : null}
                </div>
                {isFail && isOpen ? <FailDetails step={step} /> : null}
                {!isFail ? <StepArtifacts artifacts={step.artifacts} /> : null}
                {isFail && isOpen ? <StepArtifacts artifacts={step.artifacts} /> : null}
                {href && isFail ? (
                  <p style={{ margin: "8px 0 0" }}>
                    <Link href={href} style={{ fontSize: 13 }}>Go to block</Link>
                  </p>
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
