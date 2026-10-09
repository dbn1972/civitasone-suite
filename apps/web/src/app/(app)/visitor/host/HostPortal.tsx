"use client";

import { useEffect, useState } from "react";
import {
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  RefreshErrorState,
  StatCard,
  StatGrid,
  StatusPill,
} from "@/app/_components/ds";
import { fmtDateTime, fmtTime } from "../_data/format";
import { VisitorPhone } from "../_data/VisitorPhone";
import type { VisitRequest } from "../_data/types";
import { approveVisitRequest, fetchVisitRequests, rejectVisitRequest } from "../_data/client";

type Props = {
  pending: VisitRequest[];
  pendingSource: "api" | "error";
  expectedToday: VisitRequest[];
  expectedTodaySource: "api" | "error";
  /** Signed-in user's id (= hostEmployeeId server-side), or null. */
  currentHostId?: string | null;
  /** True for elevated roles that may approve/reject any host's request. */
  canApproveAny?: boolean;
  /** locationId -> display name, for the premises label. */
  locationNames?: Record<string, string>;
};

function titleCase(s: string): string {
  return s.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
};

const monoStyle: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};

export function HostPortal({ pending, pendingSource, expectedToday, expectedTodaySource, currentHostId, canApproveAny = false, locationNames = {} }: Props) {
  const [queue, setQueue] = useState<VisitRequest[]>(pending);
  const [queueError, setQueueError] = useState(pendingSource === "error");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "approve" | "reject"; req: VisitRequest }>(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);
  // GAP-VISITOR-HOST-06: a non-blocking notice when a post-action background
  // refresh fails (so the list may be stale) — no longer silently swallowed.
  const [staleNotice, setStaleNotice] = useState(false);

  // GAP-VISITOR-HOST-06: auto-dismiss the success toast after ~5s instead of
  // leaving it on screen until the next reload.
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast]);

  // GAP-VISITOR-HOST-01: only offer Approve/Reject on a request the signed-in
  // user actually hosts (or any, for an elevated role). visitor-service also
  // enforces this (assertOwnsRequest → 403), so this is honest UX + defence.
  function canAction(r: VisitRequest): boolean {
    return canApproveAny || !currentHostId || r.hostEmployeeId === currentHostId;
  }

  function premisesLabel(r: VisitRequest): string | null {
    if (!r.locationId) return null;
    return locationNames[r.locationId] ?? null;
  }

  /**
   * Reload the pending queue. `surfaceErrorOnFailure` distinguishes the two
   * call sites: a background resync after a successful approve/reject should
   * keep showing the current queue on failure (existing behaviour), while an
   * explicit retry from the error state itself should re-surface the error
   * so Retry doesn't silently no-op.
   */
  async function refresh(surfaceErrorOnFailure = false) {
    try {
      const rows = await fetchVisitRequests("pending_approval");
      setQueue(rows);
      setQueueError(false);
      setStaleNotice(false);
    } catch {
      if (surfaceErrorOnFailure) setQueueError(true);
      else setStaleNotice(true); // background resync failed; list may be stale
    }
  }

  async function runConfirmed(reason?: string) {
    if (!confirm) return;
    setBusyId(confirm.req.id);
    setConfirmErr(undefined);
    try {
      if (confirm.kind === "approve") {
        await approveVisitRequest(confirm.req.id);
        setToast(`Approved ${confirm.req.visitorName}.`);
      } else {
        await rejectVisitRequest(confirm.req.id, reason ?? "");
        setToast(`Rejected ${confirm.req.visitorName}.`);
      }
      setQueue((q) => q.filter((r) => r.id !== confirm.req.id));
      setConfirm(null);
      void refresh();
    } catch (err) {
      setConfirmErr(err instanceof Error ? err.message : "Action failed. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  const restricted = queue.filter((r) => r.permittedAreas.length > 0).length;

  return (
    <>
      <StatGrid>
        <StatCard icon="🕓" iconBg="#fff7ed" label="Awaiting Your Approval" value={queue.length.toLocaleString("en-IN")} />
        <StatCard icon="🔐" iconBg="#fef2f2" label="Restricted-zone" value={restricted.toLocaleString("en-IN")} />
        <StatCard icon="📅" iconBg="#ecfeff" label="Expected Today" value={expectedToday.length.toLocaleString("en-IN")} />
      </StatGrid>

      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {staleNotice && (
        <div className="alert" role="status" style={{ borderColor: "#fcd34d" }}>
          This list may be out of date.{" "}
          <button type="button" className="btn ghost sm" onClick={() => void refresh(true)}>Refresh</button>
        </div>
      )}

      <Card
        title={`Awaiting approval (${queue.length})`}
        link={<button type="button" className="btn ghost sm" onClick={() => void refresh(true)}>Refresh</button>}
        padding
      >
        {queueError ? (
          <ErrorState
            error={{
              what: "Could not load the approval queue.",
              next: "Live data couldn't be reached. Check your connection and try again.",
              actions: ["retry", "help"],
            }}
            onRetry={() => void refresh(true)}
          />
        ) : queue.length === 0 ? (
          <EmptyState icon="✅" title="Nothing awaiting approval" message="New visit requests raised for you will appear here." />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {queue.map((r) => (
              <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{r.visitorName}</div>
                    {/* GAP-VISITOR-HOST-02 (DPDP): mask the visitor phone. */}
                    <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
                      <VisitorPhone value={r.visitorPhone} ariaLabel="Visitor phone (masked)" />
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <StatusPill status={r.visitorCategory === "vip" ? "pending" : "info"} label={r.visitorCategory} />
                    {r.permittedAreas.length > 0 && <StatusPill status="overdue" label="Restricted zone" />}
                  </div>
                </div>
                <p style={{ fontSize: 13.5, margin: "10px 0", color: "var(--ink)" }}>{r.purpose ?? "No purpose stated."}</p>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--ink2)", marginBottom: 12, flexWrap: "wrap" }}>
                  <span>Scheduled: <span style={monoStyle}>{fmtDateTime(r.scheduledAt)}</span></span>
                  {premisesLabel(r) && <span>Premises: {premisesLabel(r)}</span>}
                  {r.passType && <span>Pass: {titleCase(r.passType)}</span>}
                  {r.trackingRef && <span>Ref: <span style={monoStyle}>{r.trackingRef}</span></span>}
                </div>
                {r.permittedAreas.length > 0 && (
                  <p style={{ fontSize: 12.5, color: "#b45309", marginBottom: 10 }}>
                    ⚠ Touches a restricted zone ({r.permittedAreas.join(", ")}) — after your approval this is routed to a second approver per policy.
                  </p>
                )}
                {canAction(r) ? (
                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" className="btn primary" disabled={busyId === r.id} onClick={() => { setConfirmErr(undefined); setConfirm({ kind: "approve", req: r }); }}>
                      Approve
                    </button>
                    <button type="button" className="btn ghost" disabled={busyId === r.id} onClick={() => { setConfirmErr(undefined); setConfirm({ kind: "reject", req: r }); }}>
                      Reject
                    </button>
                  </div>
                ) : (
                  <p style={{ fontSize: 12.5, color: "var(--ink2)", fontStyle: "italic" }}>
                    Raised for another host — only that host (or an approver) can action it.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Expected today (${expectedToday.length})`} padding>
        {expectedTodaySource === "error" ? (
          <RefreshErrorState
            error={{
              what: "We couldn't load today's expected visitors.",
              next: "Check your connection and try again.",
              actions: ["retry", "help"],
            }}
          />
        ) : expectedToday.length === 0 ? (
          <EmptyState icon="📅" title="No visitors expected today" message="Your approved visitors scheduled for today will appear here." />
        ) : (
          <div className="tbl-wrap">
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Visitor</th>
                  <th style={labelStyle}>Purpose</th>
                  <th style={labelStyle}>Premises</th>
                  <th style={labelStyle}>Scheduled</th>
                  <th style={labelStyle}>Zone</th>
                </tr>
              </thead>
              <tbody>
                {expectedToday.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.visitorName}</td>
                    <td style={{ maxWidth: 280 }}>{v.purpose ?? "—"}</td>
                    <td>{premisesLabel(v) ?? "—"}</td>
                    <td style={monoStyle}>{fmtTime(v.scheduledAt)}</td>
                    <td>
                      {v.permittedAreas.length > 0 ? (
                        <StatusPill
                          status="pending"
                          label={v.permittedAreas.length === 1 ? v.permittedAreas[0] : `${v.permittedAreas[0]} +${v.permittedAreas.length - 1}`}
                        />
                      ) : (
                        <span style={{ color: "var(--ink2)" }}>General</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={confirm?.kind === "approve"}
        title="Approve this visit?"
        description={confirm ? `${confirm.req.visitorName} will be issued a pass for their scheduled visit.${confirm.req.permittedAreas.length > 0 ? ` This visit touches restricted zone(s): ${confirm.req.permittedAreas.join(", ")}.` : ""}` : ""}
        confirmLabel="Approve"
        busy={busyId !== null}
        errorMessage={confirmErr}
        onConfirm={() => void runConfirmed()}
        onCancel={() => { if (busyId === null) setConfirm(null); }}
      />
      <ConfirmDialog
        open={confirm?.kind === "reject"}
        title="Reject this visit?"
        description={confirm ? `Record a brief reason. ${confirm.req.visitorName} will be notified their request was declined.` : ""}
        confirmLabel="Reject request"
        danger
        requireReason
        reasonLabel="Reason for rejection"
        busy={busyId !== null}
        errorMessage={confirmErr}
        onConfirm={(reason) => void runConfirmed(reason)}
        onCancel={() => { if (busyId === null) setConfirm(null); }}
      />
    </>
  );
}
