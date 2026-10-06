"use client";

/**
 * GAP-TELEPHONY-HOME-03: live call-centre status strip for the Telephony hub.
 *
 * The hub was a static tile list with no indication of whether anything is
 * queued — an agent had to open the Call Log to find out. This reads the same
 * /v1/telephony/calls resource the Call Log uses (shared summary maths in
 * lib/telephony/callSummary) and shows live / abandoned / SLA% at a glance.
 *
 * Honesty on failure (GAP-TELEPHONY-CALLS-01/02 pattern): a failed first fetch
 * with no cache renders a RefreshErrorState with a working Retry — never a wall
 * of zeros or a fabricated 100% SLA that would read as "all is well".
 */
import { StatCard, StatGrid, ErrorState } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { summariseCalls, type CallSummaryInput } from "@/lib/telephony/callSummary";
import { toHumanError } from "@/lib/messages";

type CallRow = CallSummaryInput & Record<string, unknown>;

function toCalls(payload: unknown): CallRow[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: CallRow[] }).data;
  }
  if (Array.isArray(payload)) return payload as CallRow[];
  return [];
}

export function TelephonyLiveSummary() {
  const { data: calls, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, CallRow[]>(
    "telephony.calls",
    "/v1/telephony/calls",
    { map: toCalls, initialData: [] },
  );

  // A failed first fetch with no cached copy: show an honest error, not zeros.
  if (error && calls.length === 0) {
    const human = toHumanError("load", { area: "call status" });
    return (
      <section aria-label="Live call status" style={{ marginBottom: 18 }}>
        <ErrorState error={human} onRetry={refresh} />
      </section>
    );
  }

  const showingCache = (offline || source === "cache") && cachedAt !== null;
  const note = showingCache
    ? `Showing saved data from ${new Date(cachedAt!).toLocaleString("en-IN")}${offline ? " — you're offline" : ""}.`
    : loading && calls.length === 0
      ? "Loading live status…"
      : "";

  const s = summariseCalls(calls);
  // While still loading with nothing yet, show "—" rather than a fabricated 0.
  const pending = loading && calls.length === 0;
  const num = (v: number) => (pending ? "—" : v.toLocaleString("en-IN"));
  const slaValue = pending ? "—" : s.slaPct === null ? "—" : `${s.slaPct}%`;

  return (
    <section aria-label="Live call status" style={{ marginBottom: 18 }}>
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px", minHeight: 16 }}>
        {note}
      </p>
      <StatGrid>
        <StatCard icon="📞" tone="info" label="Total Calls" value={num(s.total)} />
        <StatCard icon="🟢" tone="warn" label="Live (queued/ringing)" value={num(s.live)} />
        <StatCard icon="📉" tone="bad" label="Abandoned" value={num(s.abandoned)} />
        <StatCard
          icon="⏱"
          tone="good"
          label="SLA Answered"
          value={slaValue}
          hint={s.slaScored === 0 ? "No calls scored for SLA yet" : `${s.slaScored.toLocaleString("en-IN")} scored`}
        />
      </StatGrid>
    </section>
  );
}
