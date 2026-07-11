"use client";

import { useState } from "react";
import {
  Card,
  ConfirmDialog,
  EmptyState,
  StatCard,
  StatGrid,
  StatusPill,
} from "@/app/_components/ds";
import { fmtDateTime, fmtTime } from "../_data/format";
import type { VisitRequest } from "../_data/types";
import { approveVisitRequest, fetchVisitRequests, rejectVisitRequest } from "../_data/client";

type Props = {
  pending: VisitRequest[];
  pendingSource: "api" | "error";
  expectedToday: VisitRequest[];
  expectedTodaySource: "api" | "error";
};

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

export function HostPortal({ pending, pendingSource, expectedToday, expectedTodaySource }: Props) {
  const [queue, setQueue] = useState<VisitRequest[]>(pending);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | { kind: "approve" | "reject"; req: VisitRequest }>(null);
  const [confirmErr, setConfirmErr] = useState<string | undefined>(undefined);
  const [toast, setToast] = useState<string | null>(null);

  async function refresh() {
    try {
      const rows = await fetchVisitRequests("pending_approval");
      setQueue(rows);
    } catch {
      /* keep current queue on refresh failure */
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

      <Card
        title={`Awaiting approval (${queue.length})`}
        link={<button type="button" className="btn ghost sm" onClick={() => void refresh()}>Refresh</button>}
        padding
      >
        {pendingSource === "error" ? (
          <EmptyState icon="🕓" title="Could not load the approval queue" message="Live data couldn't be reached. Try again shortly." />
        ) : queue.length === 0 ? (
          <EmptyState icon="✅" title="Nothing awaiting approval" message="New visit requests raised for you will appear here." />
        ) : (
          <div style={{ display: "grid", gap: 12 }}>
            {queue.map((r) => (
              <div key={r.id} style={{ border: "1px solid var(--line)", borderRadius: 10, padding: 14 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15 }}>{r.visitorName}</div>
                    <div style={{ ...monoStyle, fontSize: 12.5, color: "var(--ink2)" }}>{r.visitorPhone}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <StatusPill status={r.visitorCategory === "vip" ? "pending" : "info"} label={r.visitorCategory} />
                    {r.permittedAreas.length > 0 && <StatusPill status="overdue" label="Restricted zone" />}
                  </div>
                </div>
                <p style={{ fontSize: 13.5, margin: "10px 0", color: "var(--ink)" }}>{r.purpose ?? "No purpose stated."}</p>
                <div style={{ display: "flex", gap: 16, fontSize: 12.5, color: "var(--ink2)", marginBottom: 12, flexWrap: "wrap" }}>
                  <span>Scheduled: <span style={monoStyle}>{fmtDateTime(r.scheduledAt)}</span></span>
                  {r.trackingRef && <span>Ref: <span style={monoStyle}>{r.trackingRef}</span></span>}
                </div>
                {r.permittedAreas.length > 0 && (
                  <p style={{ fontSize: 12.5, color: "#b45309", marginBottom: 10 }}>
                    ⚠ Touches a restricted zone — after your approval this is routed to a second approver per policy.
                  </p>
                )}
                <div style={{ display: "flex", gap: 8 }}>
                  <button type="button" className="btn primary" disabled={busyId === r.id} onClick={() => { setConfirmErr(undefined); setConfirm({ kind: "approve", req: r }); }}>
                    Approve
                  </button>
                  <button type="button" className="btn ghost" disabled={busyId === r.id} onClick={() => { setConfirmErr(undefined); setConfirm({ kind: "reject", req: r }); }}>
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title={`Expected today (${expectedToday.length})`} padding>
        {expectedTodaySource === "error" ? (
          <EmptyState icon="📅" title="Could not load expected visitors" message="Live data couldn't be reached. Try again shortly." />
        ) : expectedToday.length === 0 ? (
          <EmptyState icon="📅" title="No visitors expected today" message="Your approved visitors scheduled for today will appear here." />
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table className="tbl" style={{ width: "100%" }}>
              <thead>
                <tr>
                  <th style={labelStyle}>Visitor</th>
                  <th style={labelStyle}>Purpose</th>
                  <th style={labelStyle}>Scheduled</th>
                  <th style={labelStyle}>Zone</th>
                </tr>
              </thead>
              <tbody>
                {expectedToday.map((v) => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 600 }}>{v.visitorName}</td>
                    <td style={{ maxWidth: 280 }}>{v.purpose ?? "—"}</td>
                    <td style={monoStyle}>{fmtTime(v.scheduledAt)}</td>
                    <td>{v.permittedAreas.length > 0 ? <StatusPill status="pending" label="Restricted" /> : <span style={{ color: "var(--ink2)" }}>General</span>}</td>
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
        description={confirm ? `${confirm.req.visitorName} will be issued a pass for their scheduled visit.` : ""}
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
