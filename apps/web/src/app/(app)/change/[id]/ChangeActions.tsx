"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeStatus } from "../_data/types";

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`/api/proxy/v1/admin/change/${path}`, {
    method: "POST",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
  if (!res.ok) {
    const t = await res.text();
    let msg = `Request failed (${res.status}).`;
    try { const j = JSON.parse(t); if (j.message) msg = j.message; } catch { /* keep default */ }
    throw new Error(msg);
  }
}

export function ChangeActions({ id, status, hasRollbackPlan }: { id: string; status: ChangeStatus; hasRollbackPlan: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // schedule inputs
  const [winStart, setWinStart] = useState("");
  const [winEnd, setWinEnd] = useState("");
  // reject / complete inputs
  const [reason, setReason] = useState("");
  const [pirNotes, setPirNotes] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");
  const [rollback, setRollback] = useState("");

  const run = useCallback(async (fn: () => Promise<void>) => {
    setError(null); setBusy(true);
    try { await fn(); router.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : "Action failed."); }
    finally { setBusy(false); }
  }, [router]);

  const btn = (label: string, fn: () => Promise<void>, primary = false) => (
    <button type="button" className={`btn ${primary ? "primary" : ""}`} disabled={busy} onClick={() => void run(fn)}>{label}</button>
  );

  return (
    <div className="card">
      <div className="card-h"><h3>Actions</h3></div>
      <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {error && <div role="alert" style={{ color: "#b42318", fontSize: 13 }}>{error}</div>}

        {status === "draft" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            {!hasRollbackPlan && (
              <div style={{ flex: 1, minWidth: 240 }}>
                <label className="lbl" htmlFor="rb">Rollback plan (required before approval)</label>
                <input id="rb" className="inp" value={rollback} onChange={(e) => setRollback(e.target.value)} placeholder="Revert to release N-1…" />
              </div>
            )}
            {!hasRollbackPlan && btn("Save rollback plan", () => post(`requests/${id}/rollback-plan`, { rollbackPlan: rollback }))}
            {btn("Submit for CAB", () => post(`requests/${id}/submit`), true)}
          </div>
        )}

        {status === "submitted" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div style={{ flex: 1, minWidth: 240 }}>
              <label className="lbl" htmlFor="rej">Rejection reason</label>
              <input id="rej" className="inp" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this rejected?" />
            </div>
            {btn("Approve (CAB)", () => post(`requests/${id}/approve`, { note: "Approved via console" }), true)}
            {btn("Reject", () => post(`requests/${id}/reject`, { reason }))}
            <div style={{ fontSize: 12, color: "#667085", flexBasis: "100%" }}>
              Maker-checker enforced server-side: the approver must differ from the requester, and a rollback plan is required.
            </div>
          </div>
        )}

        {status === "approved" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <div>
              <label className="lbl" htmlFor="ws">Window start</label>
              <input id="ws" type="datetime-local" className="inp" value={winStart} onChange={(e) => setWinStart(e.target.value)} />
            </div>
            <div>
              <label className="lbl" htmlFor="we">Window end</label>
              <input id="we" type="datetime-local" className="inp" value={winEnd} onChange={(e) => setWinEnd(e.target.value)} />
            </div>
            {btn("Schedule release", () => post(`requests/${id}/schedule`, {
              windowStart: new Date(winStart).toISOString(),
              windowEnd: new Date(winEnd).toISOString(),
            }), true)}
            <div style={{ fontSize: 12, color: "#667085", flexBasis: "100%" }}>
              Scheduling is blocked if the window overlaps a change freeze.
            </div>
          </div>
        )}

        {status === "scheduled" && btn("Start execution", () => post(`requests/${id}/start`), true)}

        {status === "in_progress" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="lbl" htmlFor="pir">Post-implementation review notes</label>
            <input id="pir" className="inp" value={pirNotes} onChange={(e) => setPirNotes(e.target.value)} placeholder="Outcome, smoke tests, observations…" />
            <label className="lbl" htmlFor="rn">Release notes (broadcast to users on success)</label>
            <input id="rn" className="inp" value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} placeholder="What changed for users…" />
            <div style={{ display: "flex", gap: 8 }}>
              {btn("Complete (success)", () => post(`requests/${id}/complete`, { outcome: "success", notes: pirNotes, releaseNotes: releaseNotes || undefined }), true)}
              {btn("Mark rolled back", () => post(`requests/${id}/complete`, { outcome: "rolled_back", notes: pirNotes }))}
            </div>
          </div>
        )}

        {["completed", "rejected", "rolled_back"].includes(status) && (
          <div style={{ color: "#667085", fontSize: 14 }}>This change has reached a terminal state ({status.replace(/_/g, " ")}). No further actions.</div>
        )}
      </div>
    </div>
  );
}
