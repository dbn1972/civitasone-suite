"use client";

import { useMemo, useState } from "react";
import { Segmented, DataTable, StatusPill } from "../../../_components/ds";
import { maskEmail } from "../../../_components/ds/Masked";
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

/**
 * Format an ISO timestamp as a GFR-compliant Indian date plus 24h time, both
 * resolved in Asia/Kolkata regardless of the browser timezone.
 * GAP-TENANT-ADMIN-AUDIT-01: the time part used to use the browser's local
 * timezone (no explicit timeZone), so an event stamped 00:30 IST could show a
 * different day/time on a machine in another zone.
 */
function formatWhen(iso: string): string {
  const time = new Date(iso);
  const hhmm = isNaN(time.getTime())
    ? ""
    : ` ${time.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Kolkata" })}`;
  return `${formatIndianDate(iso)}${hhmm}`;
}

/**
 * GAP-TENANT-ADMIN-AUDIT-03 (DPDP): mask a source IP by default, keeping only
 * the first octet (IPv4) or first hextet (IPv6) for coarse recognisability.
 * There is no audited reveal endpoint for the audit log today, so these are
 * masked statically rather than behind a reveal control that would give a
 * false sense of logged access (same philosophy as ds/Masked).
 */
function maskIp(ip: string): string {
  const v = ip.trim();
  if (v.includes(":")) {
    const head = v.split(":")[0] ?? "";
    return `${head}:••••`;
  }
  const parts = v.split(".");
  if (parts.length === 4) return `${parts[0]}.•.•.•`;
  return "•••";
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
            render: (e) => {
              // GAP-TENANT-ADMIN-AUDIT-03: actor identifiers are often emails
              // (PII); mask them by default. Non-email identifiers (service
              // ids, usernames) are shown as-is.
              const isEmail = e.actor.includes("@");
              const display = isEmail ? maskEmail(e.actor) : e.actor;
              return (
                <div className="who">
                  <div className="av" aria-hidden="true">{e.actor.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="nm">
                      <span className={isEmail ? "mono" : undefined} aria-label={isEmail ? "actor email (masked)" : undefined}>{display}</span>
                    </div>
                    {e.ipAddress && <div className="ml"><span className="mono" aria-label="source IP (masked)">{maskIp(e.ipAddress)}</span></div>}
                  </div>
                </div>
              );
            },
          },
          { key: "action", label: "Action", render: (e) => <span className="mono">{e.action}</span> },
          { key: "resource", label: "Target", render: (e) => e.resource ?? "—" },
          {
            key: "outcome",
            label: "Result",
            // GAP-TENANT-ADMIN-AUDIT-05: an outcome other than success/failure
            // used to render as a raw, un-humanised "info" pill. Route the two
            // known outcomes to their explicit tone and everything else
            // through StatusPill (humanised label + STATUS_MAP tone).
            render: (e) =>
              e.outcome === "success" ? <span className="pill good">Success</span>
                : e.outcome === "failure" ? <span className="pill bad">Failure</span>
                : <StatusPill status={e.outcome} />,
          },
        ]}
        rows={rows}
        sortable
        filterable
        filterPlaceholder="Search audit events…"
        pageSize={15}
        emptyIcon="📋"
        emptyTitle={filter === "Failures" ? "No failures recorded" : "No audit events yet"}
        emptyMessage={filter === "Failures" ? "No failed actions in the loaded events." : "Audit events will appear here as actions are taken."}
      />
    </div>
  );
}
