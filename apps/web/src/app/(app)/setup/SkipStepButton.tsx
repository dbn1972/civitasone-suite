"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { persistSkippedStep, unskipStep } from "./setupSkipApi";

/**
 * GAP-SETUP-HOME-02 — "Skip for now" persists a per-tenant deferral BEFORE
 * leaving, so the skipped step is excluded from the resume target and the
 * progress denominator on the next visit. The label only promises a deferral
 * when one was actually saved: if the write fails (a non-admin viewer, or the
 * settings service is offline) we navigate to the dashboard anyway but surface
 * an honest "couldn't save — this step will still show as to-do" note rather
 * than implying it was deferred.
 */
export function SkipStepButton({ stepKey, stepTitle }: { stepKey: string; stepTitle: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onSkip() {
    setBusy(true);
    setFailed(false);
    const ok = await persistSkippedStep(stepKey);
    if (!ok) {
      // Honest: do not claim a deferral was saved. Let the clerk still leave.
      setFailed(true);
      setBusy(false);
      return;
    }
    router.push("/dashboard");
  }

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: 4 }}>
      <button
        type="button"
        className="btn ghost"
        disabled={busy}
        aria-label={`Skip "${stepTitle}" for now and continue later`}
        onClick={() => void onSkip()}
      >
        {busy ? "Skipping…" : "Skip for now"}
      </button>
      {failed && (
        <span role="status" style={{ fontSize: 12, color: "var(--warn)" }}>
          Couldn&apos;t save the skip — this step will still show as to-do.{" "}
          <a href="/dashboard">Go to dashboard anyway</a>
        </span>
      )}
    </span>
  );
}

/**
 * GAP-SETUP-HOME-02 — bring a previously-skipped step back into the active set.
 * Shown on a skipped step so a deferral is reversible.
 */
export function UnskipStepButton({ stepKey, stepTitle }: { stepKey: string; stepTitle: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onUnskip() {
    setBusy(true);
    const ok = await unskipStep(stepKey);
    setBusy(false);
    if (ok) router.refresh();
  }

  return (
    <button
      type="button"
      className="btn ghost"
      disabled={busy}
      aria-label={`Bring "${stepTitle}" back into the setup steps`}
      onClick={() => void onUnskip()}
    >
      {busy ? "Restoring…" : "Un-skip"}
    </button>
  );
}
