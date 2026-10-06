"use client";

import { userFacingErrorFromResponse } from "@/lib/api/userFacingFromResponse";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ConfirmDialog } from "@/app/_components/ds";

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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmSkip, setConfirmSkip] = useState(false);

  const done = status === "completed";

  async function action(verb: "run" | "skip" | "retry") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/proxy/v1/install/steps/${id}/${verb}`, { method: "PATCH" });
      if (!res.ok) throw await userFacingErrorFromResponse(res, "save");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${verb} this step. Please try again.`);
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

  const btn =
    "inline-flex min-h-[44px] items-center justify-center rounded-lg px-4 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50";

  if (!canRun && !canRetry && !canSkip) {
    return status === "in_progress" ? (
      <p className="mt-3 text-xs text-slate-500" role="status">
        This step is running…
      </p>
    ) : null;
  }

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
    </div>
  );
}
