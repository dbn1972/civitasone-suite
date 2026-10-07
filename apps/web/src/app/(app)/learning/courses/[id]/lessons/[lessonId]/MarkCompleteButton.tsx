/**
 * GAP-LEARNING-COURSES-DETAIL-03: "Mark complete" for a lesson. Posts JSON to
 * the proxy progress endpoint for the signed-in employee (employeeId is
 * derived server-side and passed in; the backend also self-scopes non-HR
 * callers to their own record). On success it refreshes so the course /
 * my-learning progress updates.
 */
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface MarkCompleteButtonProps {
  lessonId: string;
  employeeId: string;
  alreadyComplete: boolean;
}

export function MarkCompleteButton({ lessonId, employeeId, alreadyComplete }: MarkCompleteButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(alreadyComplete);
  const [error, setError] = useState("");

  const markComplete = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/learning/lessons/${encodeURIComponent(lessonId)}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId, status: "completed" }),
      });
      if (res.ok) {
        setDone(true);
        router.refresh();
        return;
      }
      if (res.status === 409) {
        setError("You are not enrolled in this course.");
      } else if (res.status === 403) {
        setError("You are not authorised to update this lesson.");
      } else {
        setError("Could not save progress. Please try again.");
      }
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }, [lessonId, employeeId, router]);

  if (done) {
    return <span style={{ color: "var(--green, #16a34a)", fontWeight: 600 }}>✓ Completed</span>;
  }

  return (
    <div>
      <button className="btn primary" onClick={markComplete} disabled={busy} aria-busy={busy}>
        {busy ? "Saving…" : "Mark complete"}
      </button>
      {error && (
        <p role="alert" style={{ fontSize: 12, color: "var(--red, #dc2626)", margin: "4px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
