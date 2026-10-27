"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { Button } from "@/app/_components/ds";
import { humanizeStatus } from "@/lib/formatters";
import { useFormError } from "@/lib/useFormError";

/**
 * GAP-PROJECTS-DETAIL-TASKS-01: status / progress edit for one task
 * (PATCH /v1/projects/:id/tasks/:taskId/status). Mirrors the legal transitions
 * of project-service domain.ts TASK_TRANSITIONS so only reachable next states
 * are offered; the server remains the authority and answers 422 INVALID_TRANSITION
 * / 404 for anything else. Only rendered for roles the service accepts.
 */
const NEXT: Record<string, string[]> = {
  pending: ["in_progress", "blocked"],
  in_progress: ["completed", "blocked", "pending"],
  blocked: ["pending", "in_progress"],
  completed: [],
};

export function allowedNextStatuses(status: string): string[] {
  return NEXT[status] ?? [];
}

export function TaskStatusControl({
  projectId,
  taskId,
  status,
  progressPct,
}: {
  projectId: string;
  taskId: string;
  status: string;
  progressPct: number;
}) {
  const router = useRouter();
  const options = allowedNextStatuses(status);
  const [next, setNext] = useState(status);
  const [progress, setProgress] = useState(String(Math.min(100, Math.max(0, Math.round(progressPct)))));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const formError = useFormError("task");
  const statusId = useId();
  const progressId = useId();

  // A completed task is terminal: nothing to edit.
  if (options.length === 0) return <span style={{ fontSize: 13, color: "var(--ink2)" }}>—</span>;

  async function save() {
    const pct = Number(progress);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      setMessage("Progress must be between 0 and 100.");
      return;
    }
    if (next === status && pct === Math.round(progressPct)) {
      setMessage("Nothing to update.");
      return;
    }
    if (next === status) {
      // Progress-only change keeps the status; the endpoint requires a legal
      // transition, so progress is edited together with a status move.
      setMessage("Choose the new status to record progress.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const res = await fetch(`/api/proxy/v1/projects/${projectId}/tasks/${taskId}/status`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: next, progressPct: pct }),
      });
      if (!res.ok) {
        setMessage((await formError.fromResponse(res, "save")).message);
        if (res.status === 404 || res.status === 422) router.refresh();
        return;
      }
      router.refresh();
    } catch (caught) {
      setMessage(formError.fromException("save", caught).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
      <label htmlFor={statusId} className="sr-only">Status</label>
      <select id={statusId} className="inp" value={next} onChange={(e) => setNext(e.target.value)} style={{ minHeight: 32 }}>
        <option value={status}>{humanizeStatus(status)} (current)</option>
        {options.map((s) => (
          <option key={s} value={s}>{humanizeStatus(s)}</option>
        ))}
      </select>
      <label htmlFor={progressId} className="sr-only">Progress %</label>
      <input
        id={progressId}
        className="inp"
        type="number"
        min={0}
        max={100}
        step={1}
        value={progress}
        onChange={(e) => setProgress(e.target.value)}
        style={{ minHeight: 32, width: 72 }}
      />
      <Button type="button" variant="secondary" disabled={busy} onClick={() => void save()}>
        {busy ? "Saving…" : "Update"}
      </Button>
      {message && (
        <span role="alert" style={{ width: "100%", fontSize: 12, color: "var(--bad)" }}>{message}</span>
      )}
    </div>
  );
}
