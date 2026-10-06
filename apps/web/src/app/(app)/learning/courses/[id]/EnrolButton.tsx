/**
 * GAP-LEARNING-COURSES-DETAIL-01/02/05: client-side "Enrol Now" button that
 * posts JSON to the proxy API (not a native HTML form to the raw backend URL)
 * with error handling for 409 PREREQUISITES_NOT_MET and other failures.
 *
 * The employeeId is derived server-side from getMyProfile() and threaded in as
 * a prop — the button never reads it from the URL bar (fixes DETAIL-02).
 * The backend also self-scopes (non-HR callers are forced onto their own id),
 * so this is defence in depth.
 */
"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";

interface EnrolButtonProps {
  courseId: string;
  employeeId: string;
  /** Names of prerequisite courses the user has NOT completed (pre-check). */
  unmetPrereqs: string[];
  disabled?: boolean;
}

export function EnrolButton({ courseId, employeeId, unmetPrereqs, disabled }: EnrolButtonProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const hasUnmet = unmetPrereqs.length > 0;

  const enrol = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/proxy/v1/hrms/learning/courses/${encodeURIComponent(courseId)}/enroll`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ employeeId }),
      });
      if (res.ok) {
        router.refresh();
        return;
      }
      const body = await res.json().catch(() => ({})) as Record<string, unknown>;
      if (body.code === "PREREQUISITES_NOT_MET") {
        const missing = Array.isArray(body.missing) ? (body.missing as string[]).join(", ") : "";
        setError(`Prerequisites not met${missing ? ": " + missing : ". Complete required courses first."}`);
      } else if (res.status === 409) {
        setError(typeof body.message === "string" ? body.message : "This action cannot be completed right now.");
      } else if (res.status === 403) {
        setError("You are not authorised to enrol. Please contact HR.");
      } else {
        setError("Enrolment failed. Please try again.");
      }
    } catch {
      setError("Network error. Please check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }, [courseId, employeeId, router]);

  if (hasUnmet) {
    return (
      <div>
        <button className="btn primary" disabled title="Complete prerequisites first" aria-disabled="true">
          Enrol Now
        </button>
        <p style={{ fontSize: 12, color: "var(--amber, #d97706)", margin: "4px 0 0" }}>
          Complete first: {unmetPrereqs.join(", ")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <button
        className="btn primary"
        onClick={enrol}
        disabled={busy || disabled}
        aria-busy={busy}
        aria-disabled={busy || disabled}
      >
        {busy ? "Enrolling…" : "Enrol Now"}
      </button>
      {error && (
        <p role="alert" style={{ fontSize: 12, color: "var(--red, #dc2626)", margin: "4px 0 0" }}>
          {error}
        </p>
      )}
    </div>
  );
}
