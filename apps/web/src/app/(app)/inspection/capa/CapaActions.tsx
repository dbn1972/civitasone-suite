"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { AcceptedNotice, ActionButton } from "@/app/_components/ds";
import { useAcceptedWrite } from "@/lib/useAcceptedWrite";
import { useFormError } from "@/lib/useFormError";

type RowProps = { id: string; status: string };

export function CapaRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("capa");

  // SF-15: a 202 means "received", not "done". Remember the status at the time of
  // the 202 and show the shared AcceptedNotice (with a manual Refresh) instead of a
  // timer that guesses the write has landed (GAP-INSPECTION-CAPA-04 /
  // GAP-INSPECTION-INSPECTIONS-02 asked for an honest "still processing" state).
  const accepted = useAcceptedWrite();
  const [priorStatus, setPriorStatus] = useState<string | null>(null);

  // The server data caught up (status changed): drop the notice.
  useEffect(() => {
    if (priorStatus === null || status === priorStatus) return;
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
  }, [status, priorStatus, accepted]);

  function markAccepted(prior: string): void {
    setPriorStatus(prior);
    accepted.accept();
  }

  const canStart = status === "open";
  const canComplete = status === "in_progress" || status === "overdue";
  const canVerify = status === "completed";

  if (!canStart && !canComplete && !canVerify) {
    return <span style={{ color: "var(--ink2)", fontSize: 12 }}>&#8212;</span>;
  }

  async function start() {
    setBusy(true);
    setError(undefined);
    setMessage("");
    setPriorStatus(null);
    accepted.reset();
    try {
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/start`, { method: "POST" });
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      setMessage("Start requested — the status will update shortly.");
      router.refresh();
      markAccepted(status);
    } catch (e) {
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  async function completeWithRemarks(reason?: string) {
    const note = (reason ?? "").trim();
    if (!note) throw new Error("Closure remarks are required.");
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/complete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ evidenceOfClosure: [{ source: "user", note }] }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  async function verify() {
    const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effectivenessVerified: true }),
    });
    if (res.status !== 202 && !res.ok) {
      throw UserFacingError.from(await formError.fromResponse(res, "save"));
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {canStart ? (
          <button type="button" className="btn ghost" disabled={busy} onClick={() => void start()}>
            Start
          </button>
        ) : null}
        {canComplete ? (
          <ActionButton
            label="Complete"
            className="btn ghost"
            confirmTitle="Complete this corrective action?"
            confirmDescription="Record what was done to close this CAPA. These remarks are saved as the closure evidence and cannot be left blank."
            confirmLabel="Mark complete"
            requireReason
            reasonLabel="Closure remarks"
            onConfirm={completeWithRemarks}
            onSuccess={() => {
              setMessage("Completion requested — the status will update shortly.");
              router.refresh();
              markAccepted(status);
            }}
          />
        ) : null}
        {canVerify ? (
          <ActionButton
            label="Verify"
            className="btn ghost"
            confirmTitle="Verify effectiveness?"
            confirmDescription="Confirm you have checked that this corrective action was effective. This is a sign-off step."
            confirmLabel="Confirm verification"
            onConfirm={() => verify()}
            onSuccess={() => {
              setMessage("Verification requested — the status will update shortly.");
              router.refresh();
              markAccepted(status);
            }}
          />
        ) : null}
      </div>
      {accepted.phase !== "idle" ? (
        <AcceptedNotice {...accepted.noticeProps} message={message} />
      ) : message ? (
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
