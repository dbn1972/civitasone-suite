"use client";

import { UserFacingError } from "@/lib/userFacingError";
import { useRouter } from "next/navigation";
import { useState, useRef, useEffect } from "react";
import { ActionButton } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

type RowProps = { id: string; status: string };

export function CapaRowAction({ id, status }: RowProps) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | undefined>();
  const formError = useFormError("capa");

  // GAP-INSPECTION-CAPA-04: track the status at the time of a 202 action
  // so a follow-up refresh can detect whether the async consumer applied it.
  const priorStatusRef = useRef<string | null>(null);
  const [pollDue, setPollDue] = useState(false);

  // When the follow-up refresh completes and pollDue is set, compare status.
  useEffect(() => {
    if (!pollDue) return;
    setPollDue(false);
    if (priorStatusRef.current === null) return;
    if (status === priorStatusRef.current) {
      setMessage(
        "Status unchanged — the request may still be processing. Refresh to check again.",
      );
    } else {
      setMessage("");
    }
    priorStatusRef.current = null;
  }, [pollDue, status]);

  // If status changes while a poll is pending, clear pending state immediately.
  useEffect(() => {
    if (priorStatusRef.current === null) return;
    if (status !== priorStatusRef.current) {
      setMessage("");
      priorStatusRef.current = null;
      setPollDue(false);
    }
  }, [status]);

  function scheduleFollowUp(priorStatus: string): void {
    priorStatusRef.current = priorStatus;
    setTimeout(() => {
      router.refresh();
      setPollDue(true);
    }, 5000);
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
    try {
      const res = await fetch(`/api/proxy/v1/inspection/capa/${id}/start`, { method: "POST" });
      if (res.status !== 202 && !res.ok) {
        throw UserFacingError.from(await formError.fromResponse(res, "save"));
      }
      setMessage("Start requested — the status will update shortly.");
      router.refresh();
      scheduleFollowUp(status);
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
              scheduleFollowUp(status);
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
              scheduleFollowUp(status);
            }}
          />
        ) : null}
      </div>
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
