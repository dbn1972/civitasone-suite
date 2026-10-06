"use client";

/**
 * Telephony — Dispositions breakdown.
 * Aggregates completed-call wrap-up codes from the call API into a count +
 * share table (call-centre quality view). Offline-capable read; no PII is
 * displayed on this screen at all (counts only).
 * WCAG 2.2 AA: semantic structure, aria-live status, DS DataTable.
 */
import { useMemo, useState } from "react";
import { PageHeader, StatCard, StatGrid, DataTable, ProgressBar, Segmented, ErrorState, Button } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";
import { humaniseCode } from "@/lib/labels";
import { toHumanError } from "@/lib/messages";

type CallRow = {
  id: string;
  status: string;
  disposition: string | null;
} & Record<string, unknown>;

type DispositionRow = {
  disposition: string;
  label: string;
  count: number;
  sharePct: number;
} & Record<string, unknown>;

/** Sentinel key for completed calls that carry no wrap-up code. */
const NO_DISPOSITION = "__none";

function toCalls(payload: unknown): CallRow[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: CallRow[] }).data;
  }
  if (Array.isArray(payload)) return payload as CallRow[];
  return [];
}

/**
 * GAP-TELEPHONY-DISPOSITIONS-04: largest-remainder rounding so whole-percent
 * shares always sum to 100 (per-row Math.round could sum to 99 or 101).
 */
function largestRemainderPct(counts: number[], total: number): number[] {
  if (total <= 0) return counts.map(() => 0);
  const exact = counts.map((c) => (c / total) * 100);
  const floors = exact.map((e) => Math.floor(e));
  let remainder = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - Math.floor(e) }))
    .sort((a, b) => b.frac - a.frac);
  const result = [...floors];
  for (let k = 0; k < order.length && remainder > 0; k++) {
    result[order[k]!.i]! += 1;
    remainder -= 1;
  }
  return result;
}

type Aggregate = { rows: DispositionRow[]; completedTotal: number; noDispositionCount: number };

/**
 * GAP-TELEPHONY-DISPOSITIONS-03: 'Completed' now counts ALL completed calls;
 * completed calls with no wrap-up code are bucketed under 'No disposition'
 * instead of vanishing, so the figures reconcile with the Call Log.
 */
function aggregate(calls: CallRow[]): Aggregate {
  const completed = calls.filter((c) => c.status === "completed");
  const counts = new Map<string, number>();
  for (const c of completed) {
    const key = c.disposition ?? NO_DISPOSITION;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const completedTotal = completed.length;
  const entries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const shares = largestRemainderPct(
    entries.map(([, n]) => n),
    completedTotal,
  );
  const rows: DispositionRow[] = entries.map(([disposition, count], i) => ({
    disposition,
    label: disposition === NO_DISPOSITION ? "No disposition" : humaniseCode(disposition),
    count,
    sharePct: shares[i] ?? 0,
  }));
  return { rows, completedTotal, noDispositionCount: counts.get(NO_DISPOSITION) ?? 0 };
}

const columns = [
  { key: "label" as const, label: "Disposition" },
  { key: "count" as const, label: "Calls", align: "right" as const },
  {
    key: "sharePct" as const,
    label: "Share",
    render: (r: DispositionRow) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ProgressBar value={r.sharePct} label={`${r.label} share`} />
        <span aria-hidden="true">{r.sharePct}%</span>
      </div>
    ),
  },
];

const RANGES = ["Today", "7 days", "30 days", "All"] as const;
type Range = (typeof RANGES)[number];

function rangeFrom(range: Range, now: Date): string | null {
  if (range === "All") return null;
  const d = new Date(now);
  if (range === "Today") d.setHours(0, 0, 0, 0);
  else if (range === "7 days") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
}

export default function TelephonyDispositionsPage() {
  const [range, setRange] = useState<Range>("30 days");
  const from = useMemo(() => rangeFrom(range, new Date()), [range]);
  const path = from ? `/v1/telephony/calls?from=${encodeURIComponent(from)}` : "/v1/telephony/calls";

  const { data: calls, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, CallRow[]>(
    `telephony.calls:${range}`,
    path,
    { map: toCalls, initialData: [] },
  );

  const hasData = calls.length > 0;
  const showingCache = (offline || source === "cache") && cachedAt !== null;
  const { rows, completedTotal, noDispositionCount } = aggregate(calls);

  // GAP-TELEPHONY-DISPOSITIONS-05: top-N dispositions as dynamic cards rather
  // than two hard-coded keys (resolved/escalated); any tenant-defined code
  // surfaces here too.
  const topCards = rows.filter((r) => r.disposition !== NO_DISPOSITION).slice(0, 3);

  const header = (
    <PageHeader
      title="Dispositions"
      // GAP-TELEPHONY-DISPOSITIONS-02: honest, non-circular copy.
      subtitle={`Completed-call wrap-up codes and their share of completed calls with a wrap-up code — ${
        range.toLowerCase() === "all" ? "all time" : `last ${range.toLowerCase()}`
      }.`}
      back="/telephony"
      backLabel="Telephony"
      actions={
        <Button variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      }
    />
  );

  // GAP-TELEPHONY-DISPOSITIONS-01: honest error state, no "saved data" over empty.
  if (error && !hasData) {
    return (
      <>
        {header}
        <ErrorState error={toHumanError("load", { area: "dispositions" })} onRetry={refresh} />
      </>
    );
  }

  const pending = loading && !hasData;
  const cacheNote = showingCache
    ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
    : pending
      ? "Loading dispositions…"
      : "";

  const num = (v: number) => (pending ? "—" : v.toLocaleString("en-IN"));

  return (
    <>
      {header}
      <div style={{ margin: "0 0 10px" }}>
        <Segmented options={[...RANGES]} value={range} onChange={(v) => setRange(v as Range)} />
      </div>
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote}
      </p>
      <div aria-label="Dispositions breakdown">
        <StatGrid>
          <StatCard icon="🗂" tone="info" label="Completed" value={num(completedTotal)} hint="All completed calls in range" />
          {topCards.map((r) => (
            <StatCard key={r.disposition} icon="✅" tone="good" label={r.label} value={num(r.count)} />
          ))}
          <StatCard icon="❓" tone="warn" label="No disposition" value={num(noDispositionCount)} hint="Completed calls with no wrap-up code" />
        </StatGrid>
        <div className="card">
          <h2 className="sr-only">Dispositions table</h2>
          <DataTable<DispositionRow>
            columns={columns}
            rows={rows}
            sortable
            filterable
            filterPlaceholder="Filter dispositions…"
            pageSize={15}
          />
        </div>
      </div>
    </>
  );
}
