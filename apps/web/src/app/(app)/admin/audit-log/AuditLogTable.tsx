"use client";
import { useMemo, useState } from "react";
import { DataTable } from "@/app/_components/ds";
import type { AdminAuditLogEntry } from "@/app/_data/loaders";

type Row = AdminAuditLogEntry & Record<string, unknown>;

function formatWhen(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function AuditLogTable({ entries }: { entries: AdminAuditLogEntry[] }) {
  const [outcomeFilter, setOutcomeFilter] = useState<"all" | "success" | "failure">("all");

  const filtered = useMemo<Row[]>(() => {
    const base = outcomeFilter === "all" ? entries : entries.filter((e) => e.outcome === outcomeFilter);
    return base as Row[];
  }, [entries, outcomeFilter]);

  return (
    <div className="card">
      <div className="card-h" style={{ flexWrap: "wrap", gap: 12 }}>
        <h3>Activity log</h3>
        <div style={{ display: "flex", gap: 6 }} role="group" aria-label="Filter by outcome">
          {(["all", "success", "failure"] as const).map((o) => (
            <button
              key={o}
              type="button"
              onClick={() => setOutcomeFilter(o)}
              aria-pressed={outcomeFilter === o}
              className={`btn ${outcomeFilter === o ? "primary" : "ghost"} sm`}
              style={{ fontSize: 11.5, textTransform: "capitalize" }}
            >
              {o}
            </button>
          ))}
        </div>
      </div>
      <DataTable<Row>
        columns={[
          {
            key: "timestamp",
            label: "When",
            render: (e) => <span style={{ whiteSpace: "nowrap", fontSize: 12.5, fontFamily: "monospace" }}>{formatWhen(String(e.timestamp))}</span>,
          },
          { key: "actor", label: "Actor", render: (e) => <span style={{ fontSize: 13 }}>{String(e.actor)}</span> },
          { key: "action", label: "Action", render: (e) => <code style={{ fontSize: 12 }}>{String(e.action)}</code> },
          { key: "resource", label: "Resource", render: (e) => <span style={{ fontSize: 13 }}>{e.resource ? String(e.resource) : "—"}</span> },
          {
            key: "outcome",
            label: "Outcome",
            render: (e) => (
              <span className={`pill ${e.outcome === "success" ? "good" : "bad"}`}>{String(e.outcome)}</span>
            ),
          },
        ]}
        rows={filtered}
        sortable
        filterable
        filterPlaceholder="Search actor, action, resource…"
        pageSize={25}
        exportable
        exportFilename="audit-log"
        emptyIcon="🔍"
        emptyTitle="No audit events match"
        emptyMessage="Adjust the filters above to find events."
      />
    </div>
  );
}
