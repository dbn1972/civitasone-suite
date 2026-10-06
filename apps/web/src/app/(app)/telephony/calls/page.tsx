"use client";

/**
 * Telephony — Call Log.
 * Offline-capable read (useOfflineResource) of the telephony-service call API.
 * Phone numbers arrive already masked from the API (PII minimisation); we mask
 * again client-side as defence in depth so a full number can never render.
 * WCAG 2.2 AA: semantic headings, aria-live status, DS DataTable
 * (keyboard-operable, aria-sort), DS StatusPill tokens for colour contrast.
 */
import { useMemo, useState } from "react";
import { PageHeader, StatCard, StatGrid, StatusPill, DataTable, Segmented, ErrorState, Button } from "../../../_components/ds";
import type { PillVariant } from "../../../_components/ds/StatusPill";
import { useOfflineResource } from "@/lib/sync/resource";
import { formatSecondsDuration } from "@/lib/formatters";
import { summariseCalls } from "@/lib/telephony/callSummary";
import { toHumanError } from "@/lib/messages";

type CallRow = {
  id: string;
  direction: string;
  callerNumber: string | null;
  calleeNumber: string | null;
  status: string;
  disposition: string | null;
  queueId: string | null;
  agentId: string | null;
  linkedRefType: string | null;
  linkedRefId: string | null;
  hasRecording: boolean;
  waitSeconds: number | null;
  talkSeconds: number | null;
  slaAnswered: boolean | null;
  abandoned: boolean;
  startedAt: string | null;
  endedAt: string | null;
} & Record<string, unknown>;

/** Defence-in-depth mask: keep only the last 4 digits of any phone string. */
function maskPhone(value: string | null): string {
  if (!value) return "—";
  if (value.includes("*")) return value; // already masked upstream
  const digits = value.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

function toCalls(payload: unknown): CallRow[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: CallRow[] }).data;
  }
  if (Array.isArray(payload)) return payload as CallRow[];
  return [];
}

/** GAP-TELEPHONY-CALLS-03: status pill colour by call lifecycle meaning. */
const STATUS_VARIANT: Record<string, PillVariant> = {
  queued: "warn",
  ringing: "warn",
  answered: "good",
  completed: "good",
  missed: "bad",
  abandoned: "bad",
};

const columns = [
  {
    key: "direction" as const,
    label: "Direction",
    render: (r: CallRow) => <StatusPill status={r.direction} variant={r.direction === "inbound" ? "info" : "warn"} label={r.direction} />,
  },
  { key: "callerNumber" as const, label: "Caller", render: (r: CallRow) => maskPhone(r.callerNumber) },
  {
    key: "status" as const,
    label: "Status",
    // GAP-TELEPHONY-CALLS-03: an abandoned/missed call reads red; completed/answered green.
    render: (r: CallRow) => <StatusPill status={r.status} variant={r.abandoned ? "bad" : STATUS_VARIANT[r.status] ?? "info"} label={r.status} />,
  },
  {
    key: "disposition" as const,
    label: "Disposition",
    render: (r: CallRow) => (r.disposition ? <StatusPill status={r.disposition} variant="info" label={r.disposition.replace(/_/g, " ")} /> : "—"),
  },
  { key: "waitSeconds" as const, label: "Wait", align: "right" as const, render: (r: CallRow) => formatSecondsDuration(r.waitSeconds) },
  { key: "talkSeconds" as const, label: "Talk", align: "right" as const, render: (r: CallRow) => formatSecondsDuration(r.talkSeconds) },
  {
    key: "slaAnswered" as const,
    label: "SLA",
    render: (r: CallRow) =>
      r.slaAnswered == null ? "—" : <StatusPill status={r.slaAnswered ? "cleared" : "breached"} label={r.slaAnswered ? "met" : "breached"} />,
  },
  // GAP-TELEPHONY-CALLS-04: Recording presence (icon only; the audio is never
  // fetched to the client) and the linked ticket TYPE. The linked ref id is a
  // cross-service UUID with no resolved web route today, so we show the type as
  // a label rather than a dead/opaque link (recorded as a decision).
  {
    key: "hasRecording" as const,
    label: "Rec",
    align: "center" as const,
    render: (r: CallRow) => (r.hasRecording ? <span title="Call recorded" aria-label="Call recorded">🎙</span> : <span aria-label="No recording">—</span>),
  },
  {
    key: "linkedRefType" as const,
    label: "Linked",
    render: (r: CallRow) => (r.linkedRefType ? r.linkedRefType.replace(/_/g, " ") : "—"),
  },
];

const RANGES = ["Today", "7 days", "30 days", "All"] as const;
type Range = (typeof RANGES)[number];

/** ISO lower bound (inclusive) for a range, or null for "All". */
function rangeFrom(range: Range, now: Date): string | null {
  if (range === "All") return null;
  const d = new Date(now);
  if (range === "Today") d.setHours(0, 0, 0, 0);
  else if (range === "7 days") d.setDate(d.getDate() - 7);
  else d.setDate(d.getDate() - 30);
  return d.toISOString();
}

export default function TelephonyCallsPage() {
  const [range, setRange] = useState<Range>("30 days");

  // GAP-TELEPHONY-CALLS-05: the selected window is sent as a `from` query param
  // (the server filters on createdAt) and is part of the path, so it's also the
  // cache key — a range change refetches and caches independently.
  const from = useMemo(() => rangeFrom(range, new Date()), [range]);
  const path = from ? `/v1/telephony/calls?from=${encodeURIComponent(from)}` : "/v1/telephony/calls";

  const { data: calls, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, CallRow[]>(
    `telephony.calls:${range}`,
    path,
    { map: toCalls, initialData: [] },
  );

  const hasData = calls.length > 0;
  const showingCache = (offline || source === "cache") && cachedAt !== null;
  const s = summariseCalls(calls);

  const header = (
    <PageHeader
      title="Call Log"
      subtitle={`Inbound and outbound calls with lifecycle, dispositions and SLA — ${range.toLowerCase() === "all" ? "all time" : `last ${range.toLowerCase()}`}.`}
      back="/telephony"
      backLabel="Telephony"
      actions={
        <Button variant="ghost" onClick={refresh}>
          Refresh
        </Button>
      }
    />
  );

  // GAP-TELEPHONY-CALLS-01: a failed first fetch with no cache shows an honest
  // error with Retry — not "Showing saved data" over an empty table and 100% SLA.
  if (error && !hasData) {
    return (
      <>
        {header}
        <ErrorState error={toHumanError("load", { area: "calls" })} onRetry={refresh} />
      </>
    );
  }

  const pending = loading && !hasData;
  const cacheNote = showingCache
    ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
    : pending
      ? "Loading calls…"
      : "";

  // GAP-TELEPHONY-CALLS-02: SLA is "—" when nothing is scored (and while
  // loading), never a fabricated 100%.
  const num = (v: number) => (pending ? "—" : v.toLocaleString("en-IN"));
  const slaValue: string = pending ? "—" : s.slaPct === null ? "—" : `${s.slaPct}%`;

  return (
    <>
      {header}
      <div style={{ margin: "0 0 10px" }}>
        <Segmented options={[...RANGES]} value={range} onChange={(v) => setRange(v as Range)} />
      </div>
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote}
      </p>
      <div aria-label="Call log">
        {/* GAP-TELEPHONY-CALLS-07: four cards in the four-column StatGrid (Live
            folded into Total's hint) so there is no orphan fifth card. */}
        <StatGrid>
          <StatCard
            icon="📞"
            tone="info"
            label="Total Calls"
            value={num(s.total)}
            hint={pending ? undefined : `${s.live.toLocaleString("en-IN")} live (queued/ringing)`}
          />
          <StatCard icon="✅" tone="good" label="Answered" value={num(s.answered)} />
          <StatCard icon="📉" tone="bad" label="Abandoned" value={num(s.abandoned)} />
          <StatCard
            icon="⏱"
            tone="good"
            label="SLA Answered"
            value={slaValue}
            hint={pending ? undefined : s.slaScored === 0 ? "No calls scored for SLA" : `${s.slaScored.toLocaleString("en-IN")} scored`}
          />
        </StatGrid>
        <div className="card">
          <h2 className="sr-only">Calls table</h2>
          <DataTable<CallRow>
            columns={columns}
            rows={calls}
            sortable
            filterable
            filterPlaceholder="Filter by status, disposition, number…"
            pageSize={15}
          />
        </div>
      </div>
    </>
  );
}
