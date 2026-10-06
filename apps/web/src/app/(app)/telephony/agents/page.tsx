"use client";

/**
 * Telephony — Agent Queue board.
 * Offline-capable read of the telephony-service agents API. Shows agent
 * presence (available / busy / wrap-up / offline) and their queue assignment.
 * WCAG 2.2 AA: semantic structure, aria-live status, DS DataTable + StatusPill.
 */
import { useState } from "react";
import { PageHeader, StatCard, StatGrid, StatusPill, DataTable, ErrorState, Button } from "../../../_components/ds";
import type { PillVariant } from "../../../_components/ds/StatusPill";
import { useOfflineResource } from "@/lib/sync/resource";
import { toHumanError } from "@/lib/messages";

type AgentRow = {
  id: string;
  userId: string;
  displayName: string;
  queueId: string | null;
  queueName: string | null;
  status: string;
  extension: string | null;
} & Record<string, unknown>;

/**
 * GAP-TELEPHONY-AGENTS-02: presence must drive the pill COLOUR via an explicit
 * DS tone (variant), not a status word. The old map produced "good"/"warn"/
 * "mut" strings and fed them to StatusPill's STATUS_MAP, which has no such
 * keys, so available/busy/offline all rendered neutral "info" — the one signal
 * the board exists for was unreadable.
 */
const PRESENCE_VARIANT: Record<string, PillVariant> = {
  available: "good",
  busy: "warn",
  wrap_up: "warn",
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
    render: (r: AgentRow) => (
      <StatusPill status={r.status} variant={PRESENCE_VARIANT[r.status] ?? "info"} label={r.status.replace(/_/g, " ")} />
    ),
  },
  // GAP-TELEPHONY-AGENTS-04: show the resolved queue name, never a truncated
  // queueId UUID. "Unknown queue" when an assigned queue could not be resolved.
  {
    key: "queueName" as const,
    label: "Queue",
    render: (r: AgentRow) => (r.queueId ? (r.queueName ?? "Unknown queue") : "Unassigned"),
  },
];

export default function TelephonyAgentsPage() {
  const { data: agents, source, offline, cachedAt, loading, error, refresh } = useOfflineResource<unknown, AgentRow[]>(
    "telephony.agents",
    "/v1/telephony/agents",
    { map: toAgents, initialData: [] },
  );
  const [refreshedAt, setRefreshedAt] = useState<string>(() => new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));

  const available = agents.filter((a) => a.status === "available").length;
  const busy = agents.filter((a) => a.status === "busy" || a.status === "wrap_up").length;
  const offlineCount = agents.filter((a) => a.status === "offline").length;

  const hasData = agents.length > 0;
  // GAP-TELEPHONY-AGENTS-01: only report "saved data" on a REAL cache hit
  // (cachedAt set), not merely because the hook's initial source is "cache".
  const showingCache = (offline || source === "cache") && cachedAt !== null;

  function handleRefresh() {
    setRefreshedAt(new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }));
    refresh();
  }

  // GAP-TELEPHONY-AGENTS-01: a failed first fetch with no cache must show an
  // honest error with Retry — not "Showing saved data" over an empty table.
  if (error && !hasData) {
    return (
      <>
        <PageHeader
          title="Agent Queue"
          subtitle="Agent presence and queue assignment for routing."
          back="/telephony"
          backLabel="Telephony"
        />
        <ErrorState error={toHumanError("load", { area: "agents" })} onRetry={handleRefresh} />
      </>
    );
  }

  const cacheNote = showingCache
    ? `Showing saved data${cachedAt ? ` from ${new Date(cachedAt).toLocaleString("en-IN")}` : ""}${offline ? " — you're offline" : ""}.`
    : loading && !hasData
      ? "Loading agents…"
      : `Updated ${refreshedAt}`;

  return (
    <>
      <PageHeader
        title="Agent Queue"
        subtitle="Agent presence and queue assignment for routing."
        back="/telephony"
        backLabel="Telephony"
        actions={
          <Button variant="ghost" onClick={handleRefresh}>
            Refresh
          </Button>
        }
      />
      <p role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 8px", minHeight: 16 }}>
        {cacheNote}
      </p>
      <div aria-label="Agent queue">
        <StatGrid>
          <StatCard icon="👥" tone="info" label="Agents" value={hasData || !loading ? agents.length.toLocaleString("en-IN") : "—"} />
          <StatCard icon="🟢" tone="good" label="Available" value={hasData || !loading ? available.toLocaleString("en-IN") : "—"} />
          <StatCard icon="🗣" tone="warn" label="On Call / Wrap-up" value={hasData || !loading ? busy.toLocaleString("en-IN") : "—"} />
          <StatCard icon="⚪" tone="neutral" label="Offline" value={hasData || !loading ? offlineCount.toLocaleString("en-IN") : "—"} />
        </StatGrid>
        <div className="card">
          <h2 className="sr-only">Agents table</h2>
          <DataTable<AgentRow> columns={columns} rows={agents} sortable filterable filterPlaceholder="Filter agents…" pageSize={15} />
        </div>
      </div>
    </>
  );
}
