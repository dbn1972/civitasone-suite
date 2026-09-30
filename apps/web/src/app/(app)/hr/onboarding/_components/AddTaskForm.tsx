"use client";

/**
 * AddTaskForm — lets HR add a single onboarding task to an employee who has
 * none yet.
 *
 * GAP-HR-ONBOARDING-02 (fix step 1 of this catalog item; see this PR's
 * description for which step is deferred and why): onboarding could not be
 * started from the UI at all -- '+ Add New Joinee' only creates a new
 * employee record, and no screen ever called the existing
 * POST /v1/hrms/employees/:id/onboarding-tasks. This form calls that
 * existing endpoint directly; it does not add any new backend surface of
 * its own.
 */

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useFormError } from "@/lib/useFormError";

interface AddTaskFormProps {
  employeeId: string;
}

export function AddTaskForm({ employeeId }: AddTaskFormProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [dueByDay, setDueByDay] = useState("7");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const formError = useFormError("onboarding task");

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setSuccess(false);
    setLocalError(null);
    try {
      const res = await fetch(`/api/proxy/v1/hrms/employees/${employeeId}/onboarding-tasks`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueByDay: Number(dueByDay) }),
      });
      if (!res.ok) {
        setLocalError((await formError.fromResponse(res, "save")).message);
        return;
      }
      setTitle("");
      setDueByDay("7");
      setSuccess(true);
      // Async write (F3 queue, same as every other mutation in this module)
      // -- refresh shortly after so the new task actually shows up.
      setTimeout(() => router.refresh(), 1000);
    } catch {
      setLocalError(formError.fromException("save").message);
    } finally {
      setSubmitting(false);
    }
  }

  const dueByDayNum = Number(dueByDay);
  const canSubmit = title.trim().length > 0 && Number.isInteger(dueByDayNum) && dueByDayNum >= 1 && dueByDayNum <= 365;

  return (
    <form onSubmit={(e) => void handleSubmit(e)} style={{ marginTop: 16, textAlign: "left", maxWidth: 360, marginInline: "auto" }}>
      <div style={{ marginBottom: 10 }}>
        <label htmlFor="add-task-title" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--body, #334155)", marginBottom: 4 }}>
          Task title
        </label>
        <input
          id="add-task-title"
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          placeholder="e.g. Collect department ID badge"
          style={{ width: "100%", padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border, #cbd5e1)", fontSize: 13 }}
        />
      </div>
      <div style={{ marginBottom: 10 }}>
        <label htmlFor="add-task-due" style={{ display: "block", fontSize: 12, fontWeight: 600, color: "var(--body, #334155)", marginBottom: 4 }}>
          Due (days from joining)
        </label>
        <input
          id="add-task-due"
          type="number"
          min={1}
          max={365}
          value={dueByDay}
          onChange={(e) => setDueByDay(e.target.value)}
          style={{ width: 100, padding: "7px 10px", borderRadius: 6, border: "1px solid var(--border, #cbd5e1)", fontSize: 13 }}
        />
      </div>
      <button type="submit" className="btn primary" disabled={!canSubmit || submitting} style={{ fontSize: 13 }}>
        {submitting ? "Adding…" : "Add task"}
      </button>
      {success && (
        <p role="status" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--good, #067647)", fontWeight: 500 }}>
          Task added.
        </p>
      )}
      {localError && (
        <p role="alert" style={{ margin: "8px 0 0", fontSize: 12, color: "var(--bad, #dc2626)", fontWeight: 500 }}>
          {localError}
        </p>
      )}
    </form>
  );
}
