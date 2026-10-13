"use client";

import type { AsyncMutationPhase } from "@/lib/useAsyncMutation";
import { acceptedCopy, type AcceptedCopy } from "@/lib/acceptedCopy";
import { Button } from "./Button";

/**
 * AcceptedNotice - the one shared rendering of the 202 "accepted" convention (SF-15).
 *
 * Writes in this app are CQRS: the route validates, queues a command and returns 202; a consumer applies the change
 * LATER. So a successful POST means "received", not "done". Never fake completion with
 * `setTimeout(() => router.refresh(), N)` (a guard test fails on that). Drive the states with
 * `useAcceptedWrite()` (lib/useAcceptedWrite.ts, built on `useAsyncMutation`) and render this next to the form:
 *
 *   idle        nothing shown
 *   submitting  "Submitting..."                     the POST is in flight
 *   pending     "Received. Updating..."             accepted; a bounded poll of a real read endpoint is running
 *   confirmed   "Done."                             the poll saw the change (the page is then refreshed)
 *   timed_out   "Still processing" + Refresh now    poll budget spent; received but not visible yet
 *   accepted    "Received ... shortly" + Refresh now  no readable status exists: honest, never a fake success
 *   error       the failure message (role=alert)    nothing was changed
 *
 * Polling is bounded (maxAttempts, backoff) and only against a real status/GET endpoint. Without one, use the
 * "accepted" state with the manual refresh. Copy is en/hi (lib/acceptedCopy.ts, mirrored in messages asyncAccepted).
 */
export interface AcceptedNoticeProps {
  phase: AsyncMutationPhase;
  /** Failure message for the "error" phase (already display-safe). Falls back to the generic copy. */
  error?: string | null;
  /** True once the user pressed Refresh now, so the notice adds the "still being applied" hint. */
  refreshed?: boolean;
  /** Re-reads the page data. When omitted no Refresh button is shown. */
  onRefresh?: () => void;
  onDismiss?: () => void;
  /** Override the default en/hi copy (e.g. translated through a NextIntlClientProvider). */
  labels?: Partial<AcceptedCopy>;
  /** Replace the "accepted"/"pending" sentence with a page-specific one (e.g. naming the record). */
  message?: string;
}

export function AcceptedNotice({ phase, error, refreshed, onRefresh, onDismiss, labels, message }: AcceptedNoticeProps) {
  if (phase === "idle") return null;
  const c = { ...acceptedCopy(), ...labels };

  if (phase === "error") {
    return (
      <div role="alert" data-accepted-phase="error" style={{ fontSize: 13, margin: "8px 0" }}>
        <span>{error || c.failed}</span>
        {onDismiss && <Button size="sm" variant="ghost" onClick={onDismiss} style={{ marginLeft: 8 }}>{c.dismiss}</Button>}
      </div>
    );
  }

  const text =
    phase === "submitting" ? c.submitting
    : phase === "pending" ? (message ?? c.pending)
    : phase === "confirmed" ? c.confirmed
    : phase === "timed_out" ? c.timedOut
    : (message ?? c.accepted);
  const showRefresh = !!onRefresh && (phase === "accepted" || phase === "pending" || phase === "timed_out");

  return (
    <div
      aria-live="polite"
      aria-busy={phase === "submitting" || phase === "pending"}
      data-accepted-phase={phase}
      style={{ fontSize: 13, margin: "8px 0", display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
    >
      <span>{text}</span>
      {showRefresh && <Button size="sm" variant="ghost" onClick={onRefresh}>{c.refresh}</Button>}
      {refreshed && (phase === "accepted" || phase === "timed_out") && <span style={{ color: "var(--mut)" }}>{c.refreshedHint}</span>}
      {onDismiss && (phase === "accepted" || phase === "confirmed" || phase === "timed_out") && (
        <Button size="sm" variant="ghost" onClick={onDismiss}>{c.dismiss}</Button>
      )}
    </div>
  );
}
