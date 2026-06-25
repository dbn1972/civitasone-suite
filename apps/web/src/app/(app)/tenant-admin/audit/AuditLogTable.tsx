"use client";

import { useMemo, useState } from "react";
import { Segmented, DataTable } from "../../../_components/ds";
import { formatIndianDate } from "@/lib/formatters";

export type AuditEvent = {
  id: string;
  timestamp: string;
  actor: string;
  ipAddress?: string;
  action: string;
  resource?: string;
  outcome: string;
} & Record<string, unknown>;

const FILTERS = ["All", "Failures"] as const;

/** Format an ISO timestamp as a GFR-compliant Indian date plus 24h time. */
function formatWhen(iso: string): string {
  const time = new Date(iso);
  const hhmm = isNaN(time.getTime())
    ? ""
    : ` ${time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })}`;
  return `${formatIndianDate(iso)}${hhmm}`;
}

export function AuditLogTable({ events }: { events: AuditEvent[] }) {
  const [filter, setFilter] = useState<string>("All");

  const rows = useMemo(() => {
    if (filter === "Failures") return events.filter((e) => e.outcome === "failure");
    return events;
  }, [events, filter]);

  return (
    <div className="card">
      <div className="card-h">
        <h3 id="audit-table-heading">Activity log</h3>
        <div role="group" aria-label="Filter audit events by outcome">
          <Segmented options={[...FILTERS]} value={filter} onChange={setFilter} />
        </div>
      </div>
      <DataTable<AuditEvent>
        columns={[
          { key: "timestamp", label: "When", render: (e) => <span style={{ whiteSpace: "nowrap" }}>{formatWhen(e.timestamp)}</span> },
          {
            key: "actor",
            label: "Actor",
            render: (e) => (
              <div className="who">
                <div className="av" aria-hidden="true">{e.actor.slice(0, 2).toUpperCase()}</div>
                <div>
                  <div className="nm">{e.actor}</div>
                  {e.ipAddress && <div className="ml"><span className="mono">{e.ipAddress}</span></div>}
                </div>
              </div>
            ),
          },
          { key: "action", label: "Action", render: (e) => <span className="mono">{e.action}</span> },
          { key: "resource", label: "Target", render: (e) => e.resource ?? "—" },
          {
            key: "outcome",
            label: "Result",
            render: (e) =>
              e.outcome === "success" ? <span className="pill good">Success</span>
                : e.outcome === "failure" ? <span className="pill bad">Failure</span>
                : <span className="pill info">{e.outcome}</span>,
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search audit events…"
        pageSize={15}
      />
    </div>
  );
}
