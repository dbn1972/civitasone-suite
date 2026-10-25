"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";
import { useFormError } from "@/lib/useFormError";

export function InstallStepActions({
  id,
  status,
  title,
  isRequired,
}: {
  id: string;
  status: string;
  title: string;
  isRequired: boolean;
}) {
  const router = useRouter();
  const formError = useFormError("install step");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);
  const [confirmFail, setConfirmFail] = useState(false);
  const [confirmComplete, setConfirmComplete] = useState(false);

  const done = status === "completed";

  async function action(verb: "run" | "skip" | "retry" | "complete" | "fail", remarks?: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/install/steps/${id}/${verb}`, {
        method: "PATCH",
        ...(remarks ? { headers: { "content-type": "application/json" }, body: JSON.stringify({ remarks }) } : {}),
      });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      router.refresh();
    } catch (e) {
      // CLOS-S2-01: UserFacingError text passes through; a network failure or any
      // other exception gets catalogued copy, never the raw `Failed to fetch`.
      setError(formError.fromException("save", e).message);
    } finally {
      setBusy(false);
    }
  }

  function onSkip() {
    // GAP-INSTALL-HOME-03: confirm every skip (optional steps too), not only
    // required ones — skipping any provisioning step is a decision worth a
    // deliberate confirmation.
    setConfirmSkip(true);
  }

  // GAP-INSTALL-HOME-04: derive which lifecycle actions are valid from the
  // current status rather than showing Run + Retry + Skip on every
  // non-completed step. pending/skipped can be Run; failed can be Retried;
  // in_progress offers nothing (the worker owns it). Skip is offered wherever
  // the step is not already terminal-skipped/completed.
  const canRun = status === "pending" || status === "skipped";
  const canRetry = status === "failed";
  const canSkip = status === "pending" || status === "failed";
  // Q9: nothing else advances a step past in_progress, so an install admin closes it by hand.
  const canClose = status === "in_progress";

  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

  if (!canRun && !canRetry && !canSkip && !canClose) return null;

  return (
    <div className="mt-3">
      <div className="flex flex-wrap gap-2">
        {canRun ? (
          <button
            type="button"
            className={`${btn} bg-indigo-600 text-white hover:bg-indigo-700`}
            disabled={busy || done}
            aria-busy={busy}
            onClick={() => void action("run")}
          >
            {busy ? "Running…" : "Run"}
          </button>
        ) : null}
        {canRetry ? (
          <button
            type="button"
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            disabled={busy || done}
            aria-busy={busy}
            onClick={() => void action("retry")}
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
        ) : null}
        {canClose ? (
          <>
            <p className="w-full text-xs text-slate-500" role="status">
              This step is running…
            </p>
            <button
              type="button"
              className={`${btn} bg-emerald-600 text-white hover:bg-emerald-700`}
              disabled={busy}
              aria-busy={busy}
              onClick={() => setConfirmComplete(true)}
            >
              Mark complete
            </button>
            <button
              type="button"
              className={`${btn} border border-red-300 bg-white text-red-700 hover:bg-red-50`}
              disabled={busy}
              aria-busy={busy}
              onClick={() => setConfirmFail(true)}
            >
              Mark failed
            </button>
          </>
        ) : null}
        {canSkip ? (
          <button
            type="button"
            className={`${btn} border border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}
            disabled={busy || done}
            aria-busy={busy}
            onClick={onSkip}
          >
            Skip
          </button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-xs text-red-600">
          {error}
        </p>
      ) : null}

      <ConfirmDialog
        open={confirmSkip}
        title={`Skip ${isRequired ? "required " : ""}step "${title}"?`}
        description={
          isRequired
            ? "This step is required for a complete installation. Skipping it may leave the tenant workspace partially provisioned. You can re-run it later from this wizard."
            : "Skipping this optional step marks it as skipped. You can re-run it later from this wizard."
        }
        confirmLabel="Skip step"
        cancelLabel="Keep step"
        danger={isRequired}
        busy={busy}
        onConfirm={() => {
          setConfirmSkip(false);
          void action("skip");
        }}
        onCancel={() => setConfirmSkip(false)}
      />
      <ConfirmDialog
        open={confirmComplete}
        title={`Mark step "${title}" complete?`}
        description="Use this once the step's work has finished. The action is recorded in the audit trail."
        confirmLabel="Mark complete"
        cancelLabel="Cancel"
        busy={busy}
        onConfirm={() => {
          setConfirmComplete(false);
          void action("complete");
        }}
        onCancel={() => setConfirmComplete(false)}
      />

      <ConfirmDialog
        open={confirmFail}
        title={`Mark step "${title}" failed?`}
        description="Record why the step failed. The remarks are shown on the step and stored in the audit trail. You can retry it afterwards."
        confirmLabel="Mark failed"
        cancelLabel="Cancel"
        danger
        requireReason
        reasonLabel="Remarks (required)"
        maxReasonLength={500}
        busy={busy}
        onConfirm={(reason) => {
          setConfirmFail(false);
          void action("fail", reason?.trim());
        }}
        onCancel={() => setConfirmFail(false)}
      />
    </div>
  );
}
