"use client";
import { useMemo, useState } from "react";
import { DataTable, Segmented, StatusPill } from "@/app/_components/ds";
import type { AdminAuditLogEntry } from "@/app/_data/loaders";
import { formatIndianDateTime } from "@/lib/formatters";
import { SYSTEM_ACTOR_ID } from "@/lib/systemActor";

type Row = AdminAuditLogEntry & Record<string, unknown>;

const OUTCOME_OPTIONS = ["All", "Success", "Failure"] as const;
type OutcomeOption = (typeof OUTCOME_OPTIONS)[number];

/**
 * GAP-ADMIN-AUDIT-LOG-03: the CSV is a bulk copy of the audit trail, so the
 * export itself is recorded (admin-service POST /v1/admin/audit-logs/export-audit,
 * audit readers only -- the same people who can load this page). Fire-and-forget:
 * a failing audit call never blocks the user's own download.
 */
export async function recordAuditLogExport(info: { rowCount: number; filter: string }): Promise<void> {
  await fetch("/api/proxy/v1/admin/audit-logs/export-audit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    // Only whether a search was active is recorded, never the raw search text.
    body: JSON.stringify({ rowCount: info.rowCount, filtered: info.filter.trim() !== "" }),
  });
}

/**
 * GAP-ADMIN-AUDIT-LOG-04: the loader's literal "system" fallback reads as a person; show it as a system actor.
 * Platform-published events carry the uuid SYSTEM_ACTOR_ID, which must not show as a raw id either.
 */
export function formatActor(actor: unknown): string {
  const a = String(actor ?? "").trim();
  if (!a || a.toLowerCase() === "system" || a.toLowerCase() === SYSTEM_ACTOR_ID) return "System";
  return a;
}

export function AuditLogTable({ entries }: { entries: AdminAuditLogEntry[] }) {
  const [outcome, setOutcome] = useState<OutcomeOption>("All");

  const filtered = useMemo<Row[]>(() => {
    const base = outcome === "All" ? entries : entries.filter((e) => e.outcome === outcome.toLowerCase());
    return base as Row[];
  }, [entries, outcome]);
  // GAP-ADMIN-AUDIT-LOG-01: only claim "no events match" when a filter is
  // actually narrowing a non-empty list; an empty source list is just "none yet".
  const noEventsAtAll = entries.length === 0;

  return (
    <div className="card">
      <div className="card-h" style={{ flexWrap: "wrap", gap: 12 }}>
        <h3>Activity log</h3>
        <Segmented options={[...OUTCOME_OPTIONS]} value={outcome} onChange={(v) => setOutcome(v as OutcomeOption)} />
      </div>
      <DataTable<Row>
        columns={[
          {
            key: "timestamp",
            label: "When",
            render: (e) => <span style={{ whiteSpace: "nowrap", fontSize: 12.5, fontFamily: "monospace" }}>{formatIndianDateTime(String(e.timestamp))}</span>,
          },
          {
            key: "actor",
            label: "Actor",
            render: (e) => <span style={{ fontSize: 13 }} title={String(e.actor)}>{formatActor(e.actor)}</span>,
          },
          { key: "action", label: "Action", render: (e) => <code style={{ fontSize: 12 }}>{String(e.action)}</code> },
          { key: "resource", label: "Resource", render: (e) => <span style={{ fontSize: 13 }}>{e.resource ? String(e.resource) : "—"}</span> },
          {
            key: "outcome",
            label: "Outcome",
            render: (e) => <StatusPill status={String(e.outcome)} />,
          },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Search actor, action, resource…"
        pageSize={25}
        exportable
        exportFilename="audit-log"
        onExport={(info) => { void recordAuditLogExport(info).catch(() => undefined); }}
        emptyIcon="🔍"
        emptyTitle={noEventsAtAll ? "No audit events yet" : "No audit events match"}
        emptyMessage={noEventsAtAll ? "Events appear here as actions are recorded." : "Adjust the filters above to find events."}
      />
    </div>
  );
}
