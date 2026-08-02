"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { CaseStatus, CertifiedCopy, CourtCaseDetail, CourtOrder, Hearing } from "../../_data/types";
import { CASE_TRANSITIONS } from "../../_data/types";
import { CertifiedCopiesPanel } from "./CertifiedCopiesPanel";
import {
  casePillStatus,
  fmtDate,
  fmtDateTime,
  hearingPillStatus,
  humanize,
  orderPillStatus,
  todayIso,
} from "../../_data/format";
import {
  adjournHearing,
  approveAndIssueOrder,
  fetchCaseHearings,
  fetchCaseOrders,
  recallOrder,
  recordHearingOutcome,
  recordOrder,
  scheduleHearing,
  sendBackOrder,
  submitOrderForApproval,
  transitionCase,
} from "../../_data/client";

const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const labelStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 700,
  letterSpacing: ".13em",
  textTransform: "uppercase",
  color: "var(--ink2)",
  textAlign: "left",
};
const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
};

export function CaseConsole({
  caseDetail,
  initialOrders,
  ordersSource,
  initialHearings,
  hearingsSource,
  initialCertifiedCopies,
  certifiedCopiesSource,
}: {
  caseDetail: CourtCaseDetail;
  initialOrders: CourtOrder[];
  ordersSource: "api" | "error";
  initialHearings: Hearing[];
  hearingsSource: "api" | "error";
  initialCertifiedCopies: CertifiedCopy[];
  certifiedCopiesSource: "api" | "error";
}) {
  const router = useRouter();
  const [orders, setOrders] = useState<CourtOrder[]>(initialOrders);
  const [hearings, setHearings] = useState<Hearing[]>(initialHearings);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const flash = useCallback((msg: string) => {
    setToast(msg);
    setError(null);
  }, []);
  const fail = useCallback((err: unknown, fallback: string) => {
    setError(err instanceof Error ? err.message : fallback);
    setToast(null);
  }, []);

  const reloadOrders = useCallback(async () => {
    try {
      setOrders(await fetchCaseOrders(caseDetail.id));
    } catch {
      /* keep current on reload failure */
    }
  }, [caseDetail.id]);

  const reloadHearings = useCallback(async () => {
    try {
      setHearings(await fetchCaseHearings(caseDetail.id));
    } catch {
      /* keep current on reload failure */
    }
  }, [caseDetail.id]);

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}
      {error && (
        <div className="alert" role="alert" style={{ borderColor: "#fca5a5", color: "#b91c1c" }}>
          ⚠ {error}
        </div>
      )}

      <CaseSummary caseDetail={caseDetail} />
      <LifecyclePanel
        caseDetail={caseDetail}
        onDone={(msg) => {
          flash(msg);
          router.refresh();
        }}
        onError={fail}
      />
      <PartiesPanel caseDetail={caseDetail} />
      <HearingsPanel
        caseId={caseDetail.id}
        hearings={hearings}
        source={hearingsSource}
        onDone={async (msg) => {
          flash(msg);
          await reloadHearings();
        }}
        onError={fail}
      />
      <OrdersPanel
        caseId={caseDetail.id}
        orders={orders}
        source={ordersSource}
        onDone={async (msg) => {
          flash(msg);
          await reloadOrders();
        }}
        onError={fail}
      />
      <CertifiedCopiesPanel
        caseId={caseDetail.id}
        initialCopies={initialCertifiedCopies}
        source={certifiedCopiesSource}
      />
    </>
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div style={labelStyle}>{label}</div>
      <div style={{ fontSize: 14, marginTop: 2 }}>{value}</div>
    </div>
  );
}

function CaseSummary({ caseDetail }: { caseDetail: CourtCaseDetail }) {
  return (
    <Card title="Case summary" padding>
      <div
        style={{
          display: "grid",
          gap: 16,
          gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))",
        }}
      >
        <Field label="CNR" value={<span style={mono}>{caseDetail.cnrNumber || "—"}</span>} />
        <Field label="Filing no." value={<span style={mono}>{caseDetail.filingNumber || "—"}</span>} />
        <Field label="Case type" value={humanize(caseDetail.caseType)} />
        <Field
          label="Status"
          value={
            <StatusPill
              status={casePillStatus(caseDetail.status)}
              label={humanize(caseDetail.status)}
            />
          }
        />
        <Field label="Filed" value={<span style={mono}>{fmtDate(caseDetail.filingDate)}</span>} />
        <Field
          label="SLA target"
          value={<span style={mono}>{fmtDate(caseDetail.targetDisposalDate)}</span>}
        />
        <Field label="Disposed" value={<span style={mono}>{fmtDate(caseDetail.disposalDate)}</span>} />
        <Field label="Version" value={<span style={mono}>v{caseDetail.version}</span>} />
      </div>
    </Card>
  );
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

function LifecyclePanel({
  caseDetail,
  onDone,
  onError,
}: {
  caseDetail: CourtCaseDetail;
  onDone: (msg: string) => void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const nextStates = CASE_TRANSITIONS[caseDetail.status] ?? [];
  const [toStatus, setToStatus] = useState<CaseStatus | "">("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  async function move() {
    if (!toStatus) return;
    setBusy(true);
    try {
      await transitionCase(caseDetail.id, {
        toStatus,
        expectedVersion: caseDetail.version,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason("");
      setToStatus("");
      onDone(`Case moved to “${humanize(toStatus)}”.`);
    } catch (err) {
      onError(err, "Could not move the case.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Lifecycle" padding>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
        Advance the matter along its lifecycle. Only the moves the registry permits from the
        current status are offered; the service enforces the transition and role
        (registrar / court admin / judge) server-side.
      </p>
      {nextStates.length === 0 ? (
        <EmptyState
          icon="🔚"
          title="No further transition"
          message={`A case in “${humanize(caseDetail.status)}” has no onward move from here.`}
        />
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
          <select
            aria-label="Move to status"
            value={toStatus}
            onChange={(e) => setToStatus(e.target.value as CaseStatus | "")}
            style={{ ...fieldStyle, width: "auto", minWidth: 180 }}
          >
            <option value="">Move to…</option>
            {nextStates.map((s) => (
              <option key={s} value={s}>
                {humanize(s)}
              </option>
            ))}
          </select>
          <input
            aria-label="Reason (optional)"
            placeholder="Reason (optional)"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 240px" }}
          />
          <button
            type="button"
            className="btn primary"
            disabled={busy || !toStatus}
            onClick={() => void move()}
          >
            {busy ? "Moving…" : "Apply transition"}
          </button>
        </div>
      )}
    </Card>
  );
}

// ─── Parties ─────────────────────────────────────────────────────────────────

function PartiesPanel({ caseDetail }: { caseDetail: CourtCaseDetail }) {
  return (
    <Card title={`Parties (${caseDetail.parties.length})`} padding>
      {caseDetail.parties.length === 0 ? (
        <EmptyState icon="👥" title="No parties recorded" message="No parties are on this case." />
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table className="tbl" style={{ width: "100%" }}>
            <thead>
              <tr>
                <th style={labelStyle}>Role</th>
                <th style={labelStyle}>Name</th>
                <th style={labelStyle}>Advocate</th>
                <th style={labelStyle}>Bar ID</th>
              </tr>
            </thead>
            <tbody>
              {caseDetail.parties.map((p) => (
                <tr key={p.id}>
                  <td>{humanize(p.partyRole)}</td>
                  <td>{p.name ?? "—"}</td>
                  <td>{p.advocateName ?? "—"}</td>
                  <td style={mono}>{p.advocateBarId ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

// ─── Hearings ────────────────────────────────────────────────────────────────

function HearingsPanel({
  caseId,
  hearings,
  source,
  onDone,
  onError,
}: {
  caseId: string;
  hearings: Hearing[];
  source: "api" | "error";
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [scheduledAt, setScheduledAt] = useState("");
  const [purpose, setPurpose] = useState("");
  const [busy, setBusy] = useState(false);

  async function schedule() {
    if (!scheduledAt) return;
    setBusy(true);
    try {
      // datetime-local yields "YYYY-MM-DDTHH:mm"; send as an ISO instant.
      const iso = new Date(scheduledAt).toISOString();
      await scheduleHearing(caseId, {
        scheduledAt: iso,
        ...(purpose.trim() ? { purpose: purpose.trim() } : {}),
      });
      setScheduledAt("");
      setPurpose("");
      await onDone("Hearing scheduled.");
    } catch (err) {
      onError(err, "Could not schedule the hearing.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Hearings (${hearings.length})`} padding>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 8,
          alignItems: "center",
          marginBottom: 14,
        }}
      >
        <input
          type="datetime-local"
          aria-label="Hearing date & time"
          value={scheduledAt}
          onChange={(e) => setScheduledAt(e.target.value)}
          style={{ ...fieldStyle, width: "auto" }}
        />
        <input
          aria-label="Purpose (optional)"
          placeholder="Purpose (e.g. arguments)"
          value={purpose}
          onChange={(e) => setPurpose(e.target.value)}
          style={{ ...fieldStyle, width: "auto", flex: "1 1 200px" }}
        />
        <button
          type="button"
          className="btn primary"
          disabled={busy || !scheduledAt}
          onClick={() => void schedule()}
        >
          {busy ? "Scheduling…" : "Schedule hearing"}
        </button>
      </div>

      {source === "error" ? (
        <EmptyState
          icon="📅"
          title="Could not load hearings"
          message="Live data couldn't be reached. Newly scheduled hearings will appear once it returns."
        />
      ) : hearings.length === 0 ? (
        <EmptyState icon="📅" title="No hearings yet" message="Schedule the first hearing above." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {hearings.map((h) => (
            <HearingRow key={h.id} hearing={h} onDone={onDone} onError={onError} />
          ))}
        </div>
      )}
    </Card>
  );
}

function HearingRow({
  hearing,
  onDone,
  onError,
}: {
  hearing: Hearing;
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [mode, setMode] = useState<"none" | "adjourn" | "outcome">("none");
  const [reason, setReason] = useState("");
  const [nextDate, setNextDate] = useState(todayIso());
  const [outcome, setOutcome] = useState<"held" | "cancelled">("held");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const canAct = hearing.status === "scheduled";

  async function doAdjourn() {
    if (!reason.trim() || !nextDate) return;
    setBusy(true);
    try {
      await adjournHearing(hearing.id, {
        reason: reason.trim(),
        nextDate,
        expectedVersion: hearing.version,
      });
      setMode("none");
      setReason("");
      await onDone("Hearing adjourned.");
    } catch (err) {
      onError(err, "Could not adjourn the hearing.");
    } finally {
      setBusy(false);
    }
  }

  async function doOutcome() {
    setBusy(true);
    try {
      await recordHearingOutcome(hearing.id, {
        outcome,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        expectedVersion: hearing.version,
      });
      setMode("none");
      setNotes("");
      await onDone("Hearing outcome recorded.");
    } catch (err) {
      onError(err, "Could not record the outcome.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontWeight: 600 }}>
            {fmtDateTime(hearing.scheduledDate)}
            {hearing.purpose && (
              <span style={{ color: "var(--ink2)", fontWeight: 400 }}> · {humanize(hearing.purpose)}</span>
            )}
          </div>
          {hearing.nextDate && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)", ...mono }}>
              Next date: {fmtDate(hearing.nextDate)}
            </div>
          )}
          {hearing.adjournmentReason && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)" }}>
              Adjourned: {hearing.adjournmentReason}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
          <StatusPill status={hearingPillStatus(hearing.status)} label={humanize(hearing.status)} />
          {canAct && mode === "none" && (
            <>
              <button type="button" className="btn ghost sm" onClick={() => setMode("adjourn")}>
                Adjourn
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setMode("outcome")}>
                Record outcome
              </button>
            </>
          )}
        </div>
      </div>

      {mode === "adjourn" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <input
            aria-label="Adjournment reason"
            placeholder="Adjournment reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 220px" }}
          />
          <input
            type="date"
            aria-label="Next date"
            value={nextDate}
            onChange={(e) => setNextDate(e.target.value)}
            style={{ ...fieldStyle, width: "auto" }}
          />
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || !reason.trim()}
            onClick={() => void doAdjourn()}
          >
            {busy ? "…" : "Confirm adjourn"}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setMode("none")}>
            Cancel
          </button>
        </div>
      )}

      {mode === "outcome" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <select
            aria-label="Outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value as "held" | "cancelled")}
            style={{ ...fieldStyle, width: "auto" }}
          >
            <option value="held">Held</option>
            <option value="cancelled">Cancelled</option>
          </select>
          <input
            aria-label="Notes (optional)"
            placeholder="Notes (optional)"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 220px" }}
          />
          <button type="button" className="btn primary sm" disabled={busy} onClick={() => void doOutcome()}>
            {busy ? "…" : "Save outcome"}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setMode("none")}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Orders + issuance (maker-checker) ───────────────────────────────────────

function OrdersPanel({
  caseId,
  orders,
  source,
  onDone,
  onError,
}: {
  caseId: string;
  orders: CourtOrder[];
  source: "api" | "error";
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [orderType, setOrderType] = useState("");
  const [orderText, setOrderText] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [busy, setBusy] = useState(false);

  async function draft() {
    if (!orderType.trim() || !orderText.trim()) return;
    setBusy(true);
    try {
      await recordOrder(caseId, {
        orderType: orderType.trim(),
        orderText: orderText.trim(),
        orderDate,
      });
      setOrderType("");
      setOrderText("");
      await onDone("Order drafted.");
    } catch (err) {
      onError(err, "Could not draft the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title={`Orders (${orders.length})`} padding>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
        Orders follow a maker-checker flow: a judicial officer <strong>drafts</strong> an order,
        submits it for approval, and a <strong>different</strong> officer approve-issues it with a
        DSC signature (the service rejects self-approval). Send back returns a pending order to its
        maker; recall withdraws an issued order.
      </p>

      <div style={{ display: "grid", gap: 8, marginBottom: 14 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
          <input
            aria-label="Order type"
            placeholder="Order type (e.g. interim, final)"
            value={orderType}
            onChange={(e) => setOrderType(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 200px" }}
          />
          <input
            type="date"
            aria-label="Order date"
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            style={{ ...fieldStyle, width: "auto" }}
          />
        </div>
        <textarea
          aria-label="Order text"
          placeholder="Order text…"
          value={orderText}
          onChange={(e) => setOrderText(e.target.value)}
          rows={3}
          style={{ ...fieldStyle, resize: "vertical" }}
        />
        <div>
          <button
            type="button"
            className="btn primary"
            disabled={busy || !orderType.trim() || !orderText.trim()}
            onClick={() => void draft()}
          >
            {busy ? "Drafting…" : "Draft order"}
          </button>
        </div>
      </div>

      {source === "error" ? (
        <EmptyState
          icon="📜"
          title="Could not load orders"
          message="Live data couldn't be reached. Drafted orders will appear once it returns."
        />
      ) : orders.length === 0 ? (
        <EmptyState icon="📜" title="No orders yet" message="Draft the first order above." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {orders.map((o) => (
            <OrderRow key={o.id} order={o} onDone={onDone} onError={onError} />
          ))}
        </div>
      )}
    </Card>
  );
}

function OrderRow({
  order,
  onDone,
  onError,
}: {
  order: CourtOrder;
  onDone: (msg: string) => Promise<void> | void;
  onError: (err: unknown, fallback: string) => void;
}) {
  const [mode, setMode] = useState<"none" | "issue" | "sendback" | "recall">("none");
  const [dsc, setDsc] = useState("");
  const [remarks, setRemarks] = useState("");
  const [recallReason, setRecallReason] = useState("");
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (fn: () => Promise<void>, ok: string, bad: string) => {
      setBusy(true);
      try {
        await fn();
        setMode("none");
        setDsc("");
        setRemarks("");
        setRecallReason("");
        await onDone(ok);
      } catch (err) {
        onError(err, bad);
      } finally {
        setBusy(false);
      }
    },
    [onDone, onError],
  );

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontWeight: 600 }}>
            {humanize(order.orderType)}
            <span style={{ color: "var(--ink2)", fontWeight: 400, ...mono }}>
              {" "}· {fmtDate(order.orderDate)}
            </span>
          </div>
          {order.orderText && (
            <div style={{ fontSize: 13, color: "var(--ink2)", marginTop: 2, whiteSpace: "pre-wrap" }}>
              {order.orderText}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, ...mono }}>
            v{order.version}
            {order.hasDsc && " · DSC signed"}
            {order.issuedAt && ` · issued ${fmtDateTime(order.issuedAt)}`}
            {order.recallReason && ` · recalled: ${order.recallReason}`}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <StatusPill status={orderPillStatus(order.status)} label={humanize(order.status)} />
          {mode === "none" && order.status === "draft" && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={busy}
              onClick={() =>
                void run(
                  () => submitOrderForApproval(order.id, order.version),
                  "Order submitted for approval.",
                  "Could not submit the order.",
                )
              }
            >
              Submit for approval
            </button>
          )}
          {mode === "none" && order.status === "pending_approval" && (
            <>
              <button type="button" className="btn primary sm" onClick={() => setMode("issue")}>
                Approve &amp; issue
              </button>
              <button type="button" className="btn ghost sm" onClick={() => setMode("sendback")}>
                Send back
              </button>
            </>
          )}
          {mode === "none" && order.status === "issued" && (
            <button type="button" className="btn ghost sm" onClick={() => setMode("recall")}>
              Recall
            </button>
          )}
        </div>
      </div>

      {mode === "issue" && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          <label style={{ fontSize: 12.5, color: "var(--ink2)" }}>
            Digital Signature Certificate (DSC) — paste the detached signature blob. Issuance is a
            human, DSC-signed act by an officer other than the drafter.
          </label>
          <textarea
            aria-label="DSC signature"
            placeholder="-----BEGIN PKCS7----- …"
            value={dsc}
            onChange={(e) => setDsc(e.target.value)}
            rows={2}
            style={{ ...fieldStyle, resize: "vertical", ...mono }}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy || dsc.trim().length === 0}
              onClick={() =>
                void run(
                  () =>
                    approveAndIssueOrder(order.id, {
                      dscSignature: dsc.trim(),
                      expectedVersion: order.version,
                    }),
                  "Order approved & issued.",
                  "Could not issue the order (a self-approval is rejected — the approver must differ from the maker).",
                )
              }
            >
              {busy ? "Issuing…" : "Confirm approve & issue"}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => setMode("none")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {mode === "sendback" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <input
            aria-label="Send-back remarks (optional)"
            placeholder="Remarks for the maker (optional)"
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 240px" }}
          />
          <button
            type="button"
            className="btn primary sm"
            disabled={busy}
            onClick={() =>
              void run(
                () =>
                  sendBackOrder(order.id, {
                    expectedVersion: order.version,
                    ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
                  }),
                "Order sent back to the maker.",
                "Could not send the order back.",
              )
            }
          >
            {busy ? "…" : "Confirm send back"}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setMode("none")}>
            Cancel
          </button>
        </div>
      )}

      {mode === "recall" && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10, alignItems: "center" }}>
          <input
            aria-label="Recall reason"
            placeholder="Reason for recall (required)"
            value={recallReason}
            onChange={(e) => setRecallReason(e.target.value)}
            style={{ ...fieldStyle, width: "auto", flex: "1 1 240px" }}
          />
          <button
            type="button"
            className="btn primary sm"
            disabled={busy || recallReason.trim().length === 0}
            onClick={() =>
              void run(
                () =>
                  recallOrder(order.id, {
                    recallReason: recallReason.trim(),
                    expectedVersion: order.version,
                  }),
                "Order recalled.",
                "Could not recall the order.",
              )
            }
          >
            {busy ? "…" : "Confirm recall"}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => setMode("none")}>
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
