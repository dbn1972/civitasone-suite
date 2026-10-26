"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Segmented, DataTable, StatusPill, Button, ConfirmDialog } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { maskEmail } from "../../../_components/ds/Masked";
import { formatIndianDateTime } from "@/lib/formatters";

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
  return formatIndianDateTime(iso);
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

/** The server already masks the actor email / IP in the list; mask here only if a clear value ever arrives. */
const alreadyMasked = (v: string) => v.includes("*") || v.includes("•");

type Revealed = { actor: string; ipAddress: string | null };

export function AuditLogTable({ events, canReveal = false }: { events: AuditEvent[]; canReveal?: boolean }) {
  const tw2 = useTranslations("tenantAdminW2.audit");
  const tr = useTranslations("tenantW3.audit");
  const formError = useFormError("audit event");
  const [filter, setFilter] = useState<string>("All");
  // OWNER DECISION #20: an audit officer may reveal one event's clear actor + IP
  // with a recorded reason. The server writes audit.viewed for every reveal; the
  // values live only in this component's memory and never reach the CSV export.
  const [revealed, setRevealed] = useState<Record<string, Revealed>>({});
  const [target, setTarget] = useState<AuditEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [revealError, setRevealError] = useState<string | undefined>(undefined);

  async function reveal(reason?: string) {
    if (!target || busy) return;
    setBusy(true);
    setRevealError(undefined);
    formError.clear();
    try {
      const res = await fetch(`/api/proxy/v1/audit/events/${target.id}/reveal`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!res.ok) {
        setRevealError((await formError.fromResponse(res, "load")).message);
        return;
      }
      const body = (await res.json()) as { actor: string; ipAddress: string | null };
      setRevealed((cur) => ({ ...cur, [target.id]: { actor: body.actor, ipAddress: body.ipAddress } }));
      setTarget(null);
    } catch (caught) {
      setRevealError(formError.fromException("load", caught).message);
    } finally {
      setBusy(false);
    }
  }

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
            // The audited CSV export must carry the same masked form as the screen,
            // otherwise export is a PII bypass (DPDP).
            csv: (e) => (e.actor.includes("@") ? maskEmail(e.actor) : e.actor),
            render: (e) => {
              // GAP-TENANT-ADMIN-AUDIT-03: actor identifiers are often emails
              // (PII); mask them by default. Non-email identifiers (service
              // ids, usernames) are shown as-is.
              const shown = revealed[e.id];
              const isEmail = e.actor.includes("@");
              const display = shown ? shown.actor : isEmail && !alreadyMasked(e.actor) ? maskEmail(e.actor) : e.actor;
              const ip = shown ? shown.ipAddress : e.ipAddress ? (alreadyMasked(e.ipAddress) ? e.ipAddress : maskIp(e.ipAddress)) : null;
              const maskedActor = isEmail || alreadyMasked(e.actor);
              return (
                <div className="who">
                  <div className="av" aria-hidden="true">{e.actor.slice(0, 2).toUpperCase()}</div>
                  <div>
                    <div className="nm">
                      <span className={isEmail || shown ? "mono" : undefined} aria-label={shown ? tr("revealedActor") : isEmail ? "actor email (masked)" : undefined}>{display}</span>
                    </div>
                    {ip && <div className="ml"><span className="mono" aria-label={shown ? tr("revealedIp") : "source IP (masked)"}>{ip}</span></div>}
                    {canReveal && (maskedActor || e.ipAddress) ? (
                      shown ? (
                        <Button
                          variant="ghost"
                          aria-label={tr("hideFor", { action: e.action })}
                          style={{ minHeight: 44, minWidth: 44 }}
                          onClick={() => setRevealed((cur) => { const next = { ...cur }; delete next[e.id]; return next; })}
                        >
                          {tr("hide")}
                        </Button>
                      ) : (
                        <Button
                          variant="ghost"
                          aria-label={tr("revealFor", { action: e.action })}
                          style={{ minHeight: 44, minWidth: 44 }}
                          onClick={() => { setRevealError(undefined); setTarget(e); }}
                        >
                          {tr("reveal")}
                        </Button>
                      )
                    ) : null}
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
        // GAP-TENANT-ADMIN-AUDIT-03: the page's old "Export" was window.print() of
        // the unmasked table with no record. Export is now the audited CSV export:
        // the audit write is awaited first and a failed audit blocks the file.
        exportable
        exportAudit="tenant-admin/audit"
        exportFilename="audit-log"
        exportNotice={tw2("exportNotice")}
        emptyIcon="📋"
        emptyTitle={filter === "Failures" ? "No failures recorded" : "No audit events yet"}
        emptyMessage={filter === "Failures" ? "No failed actions in the loaded events." : "Audit events will appear here as actions are taken."}
      />
      <ConfirmDialog
        open={target !== null}
        title={tr("dialogTitle")}
        description={tr("dialogBody")}
        confirmLabel={tr("reveal")}
        requireReason
        minReasonLength={10}
        maxReasonLength={1000}
        reasonLabel={tr("reasonLabel")}
        busy={busy}
        {...(revealError ? { errorMessage: revealError } : {})}
        onConfirm={(reason) => void reveal(reason)}
        onCancel={() => { if (!busy) { setTarget(null); setRevealError(undefined); } }}
      />
    </div>
  );
}
