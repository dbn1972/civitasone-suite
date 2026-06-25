"use client";

/**
 * Telephony — Agent Queue board.
 * Offline-capable read of the telephony-service agents API. Shows agent
 * presence (available / busy / wrap-up / offline) and their queue assignment.
 * WCAG 2.2 AA: semantic structure, aria-live status, DS DataTable + StatusPill.
 */
import { PageHeader, StatCard, StatGrid, StatusPill, DataTable } from "../../../_components/ds";
import { useOfflineResource } from "@/lib/sync/resource";

type AgentRow = {
  id: string;
  userId: string;
  displayName: string;
  queueId: string | null;
  status: string;
  extension: string | null;
} & Record<string, unknown>;

const PRESENCE: Record<string, string> = {
  available: "good",
  busy: "warn",
  wrap_up: "review",
  offline: "mut",
};

function toAgents(payload: unknown): AgentRow[] {
  if (payload && typeof payload === "object" && Array.isArray((payload as { data?: unknown }).data)) {
    return (payload as { data: AgentRow[] }).data;
  }
  if (Array.isArray(payload)) return payload as AgentRow[];
  return [];
}

const columns = [
  { key: "displayName" as const, label: "Agent" },
  { key: "extension" as const, label: "Extension", render: (r: AgentRow) => r.extension ?? "—" },
  {
    key: "status" as const,
    label: "Presence",
    render: (r: AgentRow) => <StatusPill status={PRESENCE[r.status] ?? "info"} label={r.status.replace(/_/g, " ")} />,
  },
  { key: "queueId" as const, label: "Queue", render: (r: AgentRow) => (r.queueId ? r.queueId.slice(0, 8) : "Unassigned") },
];

export default function TelephonyAgentsPage() {
  const { data: agents, source, offline, cachedAt, loading } = useOfflineResource<unknown, AgentRow[]>(
    "telephony.agents",
    "/v1/telephony/agents",
    { map: toAgents, initialData: [] },
  );

  const available = agents.filter((a) => a.status === "available").length;
  const busy = agents.filter((a) => a.status === "busy" || a.status === "wrap_up").length;
  const offlineCount = agents.filter((a) => a.status === "offline").length;

  const cacheNote =
    offline || source === "cache"
      ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
      : null;

  return (
    <>
      <nav aria-label="Breadcrumb" className="back">
        ← <a href="/telephony">Telephony</a>
      </nav>
      <PageHeader title="Agent Queue" subtitle="Live agent presence and queue assignment for routing." />
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "#92400e", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote ?? (loading ? "Loading agents…" : "")}
      </p>
      <main aria-label="Agent queue">
        <StatGrid>
          <StatCard icon="👥" iconBg="#eef2ff" label="Agents" value={agents.length.toLocaleString("en-IN")} />
          <StatCard icon="🟢" iconBg="#ecfdf5" label="Available" value={available.toLocaleString("en-IN")} />
          <StatCard icon="🗣" iconBg="#fff7ed" label="On Call / Wrap-up" value={busy.toLocaleString("en-IN")} />
          <StatCard icon="⚪" iconBg="#f8fafc" label="Offline" value={offlineCount.toLocaleString("en-IN")} />
        </StatGrid>
        <div className="card">
          <h2 className="sr-only">Agents table</h2>
          <DataTable<AgentRow> columns={columns} rows={agents} sortable filterable filterPlaceholder="Filter agents…" pageSize={15} />
        </div>
      </main>
    </>
  );
}
