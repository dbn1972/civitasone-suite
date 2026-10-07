"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import type { ChangeStatus } from "../_data/types";
import { ActionButton } from "../../../_components/ds";
import { useFormError } from "@/lib/useFormError";
import { formatIndianDateTime } from "@/lib/formatters";

/**
 * POST a change-request action. Returns the Response (never throws on a non-ok
 * status) so the caller can map a typed { code } body to specific copy
 * (GAP-CHANGE-DETAIL-05) instead of collapsing every failure — a freeze
 * overlap, a maker-checker rejection, a stale transition — into one generic
 * message. A thrown value here is a genuine network/connection failure.
 */
async function post(path: string, body?: unknown): Promise<Response> {
  return fetch(`/api/proxy/v1/admin/change/${path}`, {
    method: "POST",
    ...(body ? { headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : {}),
  });
}

export function ChangeActions({ id, status, hasRollbackPlan }: { id: string; status: ChangeStatus; hasRollbackPlan: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const formError = useFormError("change request");
  const error = formError.message;

  // schedule inputs
  const [winStart, setWinStart] = useState("");
  const [winEnd, setWinEnd] = useState("");
  // draft rollback-plan input
  const [rollback, setRollback] = useState("");
  // in_progress PIR inputs
  const [pirNotes, setPirNotes] = useState("");
  const [releaseNotes, setReleaseNotes] = useState("");

  /**
   * Run an action that returns a Response. A non-ok response is mapped to a
   * specific message via the shared error catalogue (freeze overlap, maker-
   * checker, invalid transition …); a thrown exception is a connection
   * failure. Throws so a calling <ActionButton>'s ConfirmDialog surfaces the
   * mapped message inside the dialog (its errorMessage) and keeps it open.
   */
  const runConfirmed = useCallback(
    async (fn: () => Promise<Response>) => {
      formError.clear();
      let res: Response;
      try {
        res = await fn();
      } catch (caught) {
        const state = formError.fromException("save", caught);
        throw new Error(state.message);
      }
      if (!res.ok) {
        const state = await formError.fromResponse(res, "save");
        throw new Error(state.message);
      }
      router.refresh();
    },
    [formError, router],
  );

  /** Plain (non-confirmed) action for the low-risk draft steps. */
  const runPlain = useCallback(
    async (fn: () => Promise<Response>) => {
      formError.clear();
      setBusy(true);
      try {
        const res = await fn();
        if (!res.ok) {
          await formError.fromResponse(res, "save");
          return;
        }
        router.refresh();
      } catch (caught) {
        formError.fromException("save", caught);
      } finally {
        setBusy(false);
      }
    },
    [formError, router],
  );

  // Schedule validation (GAP-CHANGE-DETAIL-04): block submit until both values
  // parse and end is strictly after start, so new Date("").toISOString() can
  // never throw a swallowed RangeError and a 22:00→02:00 window is well-formed.
  const startMs = winStart ? Date.parse(winStart) : NaN;
  const endMs = winEnd ? Date.parse(winEnd) : NaN;
  const windowValid = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs;
  const windowError =
    winStart && winEnd && !windowValid ? "The window end must be after its start." : null;

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
            {!hasRollbackPlan && (
              <button
                type="button"
                className="btn"
                disabled={busy || rollback.trim().length < 10}
                onClick={() => void runPlain(() => post(`requests/${id}/rollback-plan`, { rollbackPlan: rollback.trim() }))}
              >
                Save rollback plan
              </button>
            )}
            <ActionButton
              label="Submit for CAB"
              confirmTitle="Submit this change for CAB review?"
              confirmDescription="This moves the change into the CAB queue for approval. You can't edit it while it's awaiting review."
              confirmLabel="Submit for CAB"
              onConfirm={() => runConfirmed(() => post(`requests/${id}/submit`))}
            />
          </div>
        )}

        {status === "submitted" && (
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end" }}>
            <ActionButton
              label="Approve (CAB)"
              confirmTitle="Approve this change?"
              confirmDescription="Approval records your CAB decision in the audit trail. Maker-checker is enforced: you cannot approve a change you raised yourself."
              confirmLabel="Approve"
              optionalReason
              reasonLabel="Approval rationale (recorded in the audit trail)"
              onConfirm={(reason) => runConfirmed(() => post(`requests/${id}/approve`, reason ? { note: reason } : {}))}
            />
            <ActionButton
              label="Reject"
              danger
              confirmTitle="Reject this change?"
              confirmDescription="Rejection is a terminal decision. The reason is recorded in the audit trail and shown to the requester."
              confirmLabel="Reject"
              requireReason
              minReasonLength={10}
              reasonLabel="Rejection reason"
              onConfirm={(reason) => runConfirmed(() => post(`requests/${id}/reject`, { reason }))}
            />
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
            <ActionButton
              label="Schedule release"
              disabled={!windowValid}
              confirmTitle="Schedule this release window?"
              confirmDescription={
                windowValid
                  ? `Release window: ${formatIndianDateTime(new Date(startMs).toISOString())} → ${formatIndianDateTime(new Date(endMs).toISOString())}. Scheduling is blocked if the window overlaps a change freeze.`
                  : "Pick a valid window first."
              }
              confirmLabel="Schedule"
              onConfirm={() => runConfirmed(() => post(`requests/${id}/schedule`, {
                windowStart: new Date(startMs).toISOString(),
                windowEnd: new Date(endMs).toISOString(),
              }))}
            />
            {windowError && <div role="alert" style={{ color: "#b42318", fontSize: 12, flexBasis: "100%" }}>{windowError}</div>}
            <div style={{ fontSize: 12, color: "#667085", flexBasis: "100%" }}>
              Scheduling is blocked if the window overlaps a change freeze.
            </div>
          </div>
        )}

        {status === "scheduled" && (
          <ActionButton
            label="Start execution"
            confirmTitle="Start executing this change?"
            confirmDescription="This marks the release as in progress. Record the outcome once it completes."
            confirmLabel="Start execution"
            onConfirm={() => runConfirmed(() => post(`requests/${id}/start`))}
          />
        )}

        {status === "in_progress" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label className="lbl" htmlFor="pir">Post-implementation review notes</label>
            <input id="pir" className="inp" value={pirNotes} onChange={(e) => setPirNotes(e.target.value)} placeholder="Outcome, smoke tests, observations…" />
            <label className="lbl" htmlFor="rn">Release notes (broadcast to users on success)</label>
            <input id="rn" className="inp" value={releaseNotes} onChange={(e) => setReleaseNotes(e.target.value)} placeholder="What changed for users…" />
            <div style={{ display: "flex", gap: 8 }}>
              <ActionButton
                label="Complete (success)"
                disabled={pirNotes.trim().length < 3}
                confirmTitle="Mark this change complete?"
                confirmDescription="This records a successful release. If release notes are present they are broadcast to users. This is a terminal state."
                confirmLabel="Complete"
                onConfirm={() => runConfirmed(() => post(`requests/${id}/complete`, { outcome: "success", notes: pirNotes.trim(), releaseNotes: releaseNotes.trim() || undefined }))}
              />
              <ActionButton
                label="Mark rolled back"
                danger
                confirmTitle="Mark this change as rolled back?"
                confirmDescription="This records that the release was reverted. It is a terminal state and cannot be undone from here."
                confirmLabel="Mark rolled back"
                requireReason
                minReasonLength={3}
                reasonLabel="What was rolled back and why"
                onConfirm={(reason) => runConfirmed(() => post(`requests/${id}/complete`, { outcome: "rolled_back", notes: reason ?? pirNotes.trim() }))}
              />
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
