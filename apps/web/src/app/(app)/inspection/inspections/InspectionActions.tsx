"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export type InspectionRow = {
  id: string;
  status: string;
};

type RowProps = { id: string; status: string };

type ActionSpec = {
  label: string;
  path: string;
  body?: Record<string, unknown>;
};

function actionForStatus(status: string): ActionSpec | null {
  switch (status) {
    case "scheduled":
      return {
        label: "Start",
        path: "transition",
        body: { targetState: "in_progress", remarks: "Started from inspection hub" },
      };
    case "in_progress":
      return {
        label: "Complete",
        path: "transition",
        body: { targetState: "completed", remarks: "Completed from inspection hub" },
      };
    case "paused":
      return {
        label: "Resume",
        path: "transition",
        body: { targetState: "in_progress", remarks: "Resumed from inspection hub" },
      };
    case "completed":
      return {
        label: "Submit review",
        path: "transition",
        body: { targetState: "under_review", remarks: "Submitted from inspection hub" },
      };
    case "under_review":
      return { label: "Finalize", path: "finalize" };
    default:
      return null;
  }
}

export function InspectionRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();

  const action = actionForStatus(status);
  if (!action) return <span style={{ color: "var(--ink2)", fontSize: 12 }}>—</span>;

  async function run() {
    if (!action) return;
    setBusy(true);
    setError(undefined);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/inspection/inspections/${id}/${action.path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: action.body ? JSON.stringify(action.body) : undefined,
      });
      if (res.status !== 202 && !res.ok) {
        throw new Error((await res.text()) || "Request failed");
      }
      setMessage(`${action.label} accepted (queued).`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Inspection action failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className="btn ghost" disabled={busy} onClick={() => void run()}>
        {action.label}
      </button>
      {message ? (
        <span role="status" aria-live="polite" style={{ fontSize: 11, color: "var(--good)" }}>
          {message}
        </span>
      ) : null}
      {error ? (
        <span role="alert" style={{ fontSize: 11, color: "var(--bad)" }}>
          {error}
        </span>
      ) : null}
    </div>
  );
}

type Props = { inspections: InspectionRow[] };

export function InspectionActions({ inspections }: Props) {
  const actionable = inspections.filter((row) => actionForStatus(row.status) !== null);
  if (actionable.length === 0) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
      {actionable.map((row) => (
        <div key={row.id} style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 13, flex: 1 }}>{row.id.slice(0, 8)}… — {row.status}</span>
          <InspectionRowAction id={row.id} status={row.status} />
        </div>
      ))}
    </div>
  );
}
