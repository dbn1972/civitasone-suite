"use client";

/**
 * Telephony — Call Log.
 * Offline-capable read (useOfflineResource) of the telephony-service call API.
 * Phone numbers arrive already masked from the API (PII minimisation); we mask
 * again client-side as defence in depth so a full number can never render.
 * WCAG 2.2 AA: semantic <main> + headings, aria-live status, DS DataTable
 * (keyboard-operable, aria-sort), DS StatusPill tokens for colour contrast.
 */
import type { ReactNode } from "react";
import { PageHeader, StatCard, StatGrid, StatusPill, DataTable } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";

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

function secs(v: number | null): ReactNode {
  return v == null ? "—" : `${v}s`;
}

const columns = [
  {
    key: "direction" as const,
    label: "Direction",
    render: (r: CallRow) => <StatusPill status={r.direction === "inbound" ? "info" : "review"} label={r.direction} />,
  },
  { key: "callerNumber" as const, label: "Caller", render: (r: CallRow) => maskPhone(r.callerNumber) },
  { key: "status" as const, label: "Status", render: (r: CallRow) => <StatusPill status={r.status} label={r.status} /> },
  {
    key: "disposition" as const,
    label: "Disposition",
    render: (r: CallRow) => (r.disposition ? <StatusPill status="info" label={r.disposition.replace(/_/g, " ")} /> : "—"),
  },
  { key: "waitSeconds" as const, label: "Wait", align: "right" as const, render: (r: CallRow) => secs(r.waitSeconds) },
  { key: "talkSeconds" as const, label: "Talk", align: "right" as const, render: (r: CallRow) => secs(r.talkSeconds) },
  {
    key: "slaAnswered" as const,
    label: "SLA",
    render: (r: CallRow) =>
      r.slaAnswered == null ? "—" : <StatusPill status={r.slaAnswered ? "good" : "bad"} label={r.slaAnswered ? "met" : "breached"} />,
  },
  {
    key: "linkedRefType" as const,
    label: "Linked",
    render: (r: CallRow) => (r.linkedRefType ? r.linkedRefType.replace(/_/g, " ") : "—"),
  },
];

export default function TelephonyCallsPage() {
  const { data: calls, source, offline, cachedAt, loading } = useOfflineResource<unknown, CallRow[]>(
    "telephony.calls",
    "/v1/telephony/calls",
    { map: toCalls, initialData: [] },
  );

  const answered = calls.filter((c) => c.status === "answered" || c.status === "completed").length;
  const live = calls.filter((c) => c.status === "queued" || c.status === "ringing").length;
  const abandoned = calls.filter((c) => c.abandoned).length;
  const slaMet = calls.filter((c) => c.slaAnswered === true).length;
  const slaScored = calls.filter((c) => c.slaAnswered != null).length;
  const slaPct = slaScored > 0 ? Math.round((slaMet / slaScored) * 100) : 100;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/telephony">Telephony</a>
      </nav>
      <PageHeader title="Call Log" subtitle="Inbound and outbound calls with lifecycle, dispositions and SLA." />
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote ?? (loading ? "Loading calls…" : "")}
      </p>
      <main aria-label="Call log">
        <StatGrid>
          <StatCard icon="📞" iconBg="#eef2ff" label="Total Calls" value={calls.length.toLocaleString("en-IN")} />
          <StatCard icon="🟢" iconBg="#ecfdf5" label="Live (queued/ringing)" value={live.toLocaleString("en-IN")} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Answered" value={answered.toLocaleString("en-IN")} />
          <StatCard icon="📉" iconBg="#fef2f2" label="Abandoned" value={abandoned.toLocaleString("en-IN")} />
          <StatCard icon="⏱" iconBg="#fff7ed" label="SLA Answered" value={`${slaPct}%`} />
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
      </main>
    </>
  );
}
