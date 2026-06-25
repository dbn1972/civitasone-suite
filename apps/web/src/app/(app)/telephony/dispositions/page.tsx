"use client";

/**
 * Telephony — Dispositions breakdown.
 * Aggregates completed-call wrap-up codes from the call API into a count +
 * share table (call-centre quality view). Offline-capable read; no PII is
 * displayed on this screen at all (counts only).
 * WCAG 2.2 AA: semantic structure, aria-live status, DS DataTable.
 */
import { PageHeader, StatCard, StatGrid, DataTable, ProgressBar } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";

type CallRow = {
  id: string;
  status: string;
  disposition: string | null;
} & Record<string, unknown>;

type DispositionRow = {
  disposition: string;
  count: number;
  sharePct: number;
} & Record<string, unknown>;

function toCalls(payload: unknown): CallRow[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: CallRow[] }).data;
  }
  if (Array.isArray(payload)) return payload as CallRow[];
  return [];
}

function aggregate(calls: CallRow[]): DispositionRow[] {
  const completed = calls.filter((c) => c.status === "completed" && c.disposition);
  const counts = new Map<string, number>();
  for (const c of completed) counts.set(c.disposition!, (counts.get(c.disposition!) ?? 0) + 1);
  const total = completed.length || 1;
  return [...counts.entries()]
    .map(([disposition, count]) => ({ disposition, count, sharePct: Math.round((count / total) * 100) }))
    .sort((a, b) => b.count - a.count);
}

const columns = [
  { key: "disposition" as const, label: "Disposition", render: (r: DispositionRow) => r.disposition.replace(/_/g, " ") },
  { key: "count" as const, label: "Calls", align: "right" as const },
  {
    key: "sharePct" as const,
    label: "Share",
    render: (r: DispositionRow) => (
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <ProgressBar value={r.sharePct} />
        <span aria-hidden="true">{r.sharePct}%</span>
        <span className="sr-only">{r.sharePct} percent</span>
      </div>
    ),
  },
];

export default function TelephonyDispositionsPage() {
  const { data: calls, source, offline, cachedAt, loading } = useOfflineResource<unknown, CallRow[]>(
    "telephony.calls",
    "/v1/telephony/calls",
    { map: toCalls, initialData: [] },
  );

  const rows = aggregate(calls);
  const resolved = rows.find((r) => r.disposition === "resolved")?.count ?? 0;
  const escalated = rows.find((r) => r.disposition === "escalated")?.count ?? 0;
  const completedTotal = rows.reduce((s, r) => s + r.count, 0);

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/telephony">Telephony</a>
      </nav>
      <PageHeader title="Dispositions" subtitle="Completed-call wrap-up codes and their share of resolved calls." />
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote ?? (loading ? "Loading dispositions…" : "")}
      </p>
      <main aria-label="Dispositions breakdown">
        <StatGrid>
          <StatCard icon="🗂" iconBg="#eef2ff" label="Completed" value={completedTotal.toLocaleString("en-IN")} />
          <StatCard icon="✅" iconBg="#dcfce7" label="Resolved" value={resolved.toLocaleString("en-IN")} />
          <StatCard icon="⬆" iconBg="#fff7ed" label="Escalated" value={escalated.toLocaleString("en-IN")} />
        </StatGrid>
        <div className="card">
          <h2 className="sr-only">Dispositions table</h2>
          <DataTable<DispositionRow> columns={columns} rows={rows} sortable pageSize={15} />
        </div>
      </main>
    </>
  );
}
