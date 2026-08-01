"use client";

/**
 * OrdersConsole — the standalone, cross-case-selectable Orders screen
 * (court/orders). Orders are case-scoped server-side for listing (no flat
 * "all orders" GET — see order/routes.ts), so this console works one case at
 * a time: the page.tsx picks the case (via CaseSelector) and hands this
 * component that case's orders. Drafting, submitting, approving/issuing,
 * sending back and recalling reuse the same court/_data/client.ts actions
 * CaseConsole uses.
 *
 * §35.5 — approve+issue is a HUMAN, DSC-signed, irreversible pronouncement
 * act (draft -> pending_approval -> issued has no way back except recall),
 * and recall is likewise a deliberate, reason-carrying reversal of an issued
 * order. Both go through <ConfirmDialog> naming the case and order acted on,
 * and surface the server's real error (including the maker-checker rejection
 * of a self-approval).
 */
import { useCallback, useId, useRef, useState } from "react";
import Link from "next/link";
import { Card, ConfirmDialog, EmptyState, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { CourtOrder } from "../_data/types";
import { fmtDate, fmtDateTime, humanize, orderPillStatus, todayIso } from "../_data/format";
import {
  approveAndIssueOrder,
  fetchCaseOrders,
  recallOrder,
  recordOrder,
  sendBackOrder,
  submitOrderForApproval,
} from "../_data/client";

const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
  minHeight: 40,
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const errStyle: React.CSSProperties = { color: "var(--bad, #c0392b)", fontSize: 12, margin: "4px 0 0" };

function caseLabel(caseSummary: { title: string | null; cnrNumber: string | null }): string {
  return caseSummary.title || caseSummary.cnrNumber || "this case";
}

export function OrdersConsole({
  caseId,
  caseSummary,
  initialOrders,
  ordersSource,
}: {
  caseId: string;
  caseSummary: { title: string | null; cnrNumber: string | null };
  initialOrders: CourtOrder[];
  ordersSource: "api" | "error";
}) {
  const [orders, setOrders] = useState<CourtOrder[]>(initialOrders);
  const [source, setSource] = useState<"api" | "error">(ordersSource);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setOrders(await fetchCaseOrders(caseId));
      setSource("api");
    } catch {
      // Keep the current rows (don't wipe them), but stop claiming they're
      // live — a failed re-fetch after a write leaves them possibly stale.
      setSource("error");
    }
  }, [caseId]);

  const flash = useCallback((msg: string) => setToast(msg), []);

  return (
    <>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)" }}>
          ✓ {toast}
        </div>
      )}

      <Card title={caseLabel(caseSummary)} padding>
        <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0 }}>
          {caseSummary.cnrNumber && <span style={mono}>{caseSummary.cnrNumber}</span>}{" "}
          <Link className="btn ghost sm" href={`/court/cases/${caseId}`} style={{ marginLeft: 8 }}>
            Open full case console →
          </Link>
        </p>
      </Card>

      <DraftOrderForm
        caseId={caseId}
        onDone={async (msg) => {
          flash(msg);
          await reload();
        }}
      />

      <Card title={source === "error" ? "Orders" : `Orders (${orders.length})`} padding>
        <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
          Orders follow a maker-checker flow: draft → submit for approval → a{" "}
          <strong>different</strong> officer approves &amp; issues with a DSC signature (a
          self-approval is rejected). Send back returns a pending order to its maker; recall
          withdraws an issued order.
        </p>
        {/* A failed reload keeps showing the last-known rows (stale, not
            wiped) — the badge is the honesty signal, not an empty state. */}
        {source === "error" && <DataSourceBadge source="error" />}
        {orders.length === 0 ? (
          source === "error" ? (
            <EmptyState
              icon="📜"
              title="Could not load orders"
              message="Live data couldn't be reached. Drafted orders will appear once it returns."
            />
          ) : (
            <EmptyState icon="📜" title="No orders yet" message="Draft the first order above." />
          )
        ) : (
          <div style={{ display: "grid", gap: 10 }}>
            {orders.map((o) => (
              <OrderRow
                key={o.id}
                order={o}
                caseLabel={caseLabel(caseSummary)}
                onDone={async (msg) => {
                  flash(msg);
                  await reload();
                }}
              />
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

// ─── Draft form ──────────────────────────────────────────────────────────────

function DraftOrderForm({
  caseId,
  onDone,
}: {
  caseId: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [orderType, setOrderType] = useState("");
  const [orderText, setOrderText] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [typeError, setTypeError] = useState<string | undefined>();
  const [textError, setTextError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const typeId = useId();
  const typeErrId = useId();
  const textId = useId();
  const textErrId = useId();
  const dateId = useId();
  const dateErrId = useId();
  const typeRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    let firstInvalid: HTMLElement | null = null;

    if (!orderType.trim()) {
      setTypeError("Enter the order type (e.g. interim, final).");
      firstInvalid ??= typeRef.current;
    } else if (orderType.trim().length > 32) {
      setTypeError("Order type must be 32 characters or fewer.");
      firstInvalid ??= typeRef.current;
    } else {
      setTypeError(undefined);
    }

    if (!orderText.trim()) {
      setTextError("Enter the order text.");
      firstInvalid ??= textRef.current;
    } else {
      setTextError(undefined);
    }

    if (orderDate) {
      const d = new Date(`${orderDate}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        setDateError("That order date isn't valid.");
        firstInvalid ??= dateRef.current;
      } else {
        setDateError(undefined);
      }
    } else {
      setDateError(undefined);
    }

    if (firstInvalid) {
      firstInvalid.focus();
      return false;
    }
    return true;
  }

  async function draft(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await recordOrder(caseId, {
        orderType: orderType.trim(),
        orderText: orderText.trim(),
        ...(orderDate ? { orderDate } : {}),
      });
      setOrderType("");
      setOrderText("");
      // Writes are command-bus backed (202 Accepted) — say "submitted", not
      // a completed fact the UI hasn't actually confirmed yet.
      await onDone("Order draft submitted.");
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not draft the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Draft an order" padding>
      <form onSubmit={draft} style={{ display: "grid", gap: 10 }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
            <label htmlFor={typeId} style={{ fontSize: 12.5, fontWeight: 600 }}>
              Order type <span aria-hidden="true">*</span>
            </label>
            <input
              id={typeId}
              ref={typeRef}
              placeholder="interim, final, injunction…"
              value={orderType}
              onChange={(e) => setOrderType(e.target.value)}
              aria-required="true"
              aria-invalid={!!typeError || undefined}
              aria-describedby={typeError ? typeErrId : undefined}
              style={fieldStyle}
            />
            {typeError && (
              <p id={typeErrId} role="alert" style={errStyle}>
                {typeError}
              </p>
            )}
          </div>
          <div style={{ display: "grid", gap: 4, maxWidth: 200 }}>
            <label htmlFor={dateId} style={{ fontSize: 12.5, fontWeight: 600 }}>
              Order date
            </label>
            <input
              id={dateId}
              ref={dateRef}
              type="date"
              value={orderDate}
              onChange={(e) => setOrderDate(e.target.value)}
              aria-invalid={!!dateError || undefined}
              aria-describedby={dateError ? dateErrId : undefined}
              style={fieldStyle}
            />
            {dateError && (
              <p id={dateErrId} role="alert" style={errStyle}>
                {dateError}
              </p>
            )}
          </div>
        </div>
        <div style={{ display: "grid", gap: 4 }}>
          <label htmlFor={textId} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Order text <span aria-hidden="true">*</span>
          </label>
          <textarea
            id={textId}
            ref={textRef}
            value={orderText}
            onChange={(e) => setOrderText(e.target.value)}
            rows={3}
            aria-required="true"
            aria-invalid={!!textError || undefined}
            aria-describedby={textError ? textErrId : undefined}
            style={{ ...fieldStyle, resize: "vertical" }}
          />
          {textError && (
            <p id={textErrId} role="alert" style={errStyle}>
              {textError}
            </p>
          )}
        </div>
        {serverError && (
          <p role="alert" style={errStyle}>
            {serverError}
          </p>
        )}
        <div>
          <button type="submit" className="btn primary" disabled={busy}>
            {busy ? "Drafting…" : "Draft order"}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ─── Order row ───────────────────────────────────────────────────────────────

function OrderRow({
  order,
  caseLabel,
  onDone,
}: {
  order: CourtOrder;
  caseLabel: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showIssue, setShowIssue] = useState(false);
  const [showSendBack, setShowSendBack] = useState(false);
  const [showRecall, setShowRecall] = useState(false);

  // Include a short id suffix — two same-type orders drafted the same day on
  // the same case would otherwise collide and give every row action button
  // (submit/approve/send-back/recall) the same accessible name.
  const rowLabel = `${humanize(order.orderType)} order (${fmtDate(order.orderDate)}) for ${caseLabel} (#${order.id.slice(0, 8)})`;

  async function doSubmit() {
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      await submitOrderForApproval(order.id, order.version);
      await onDone("Order submitted for approval.");
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "Could not submit the order.");
    } finally {
      setSubmitBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 320px" }}>
          <div style={{ fontWeight: 600 }}>
            {humanize(order.orderType)}
            <span style={{ color: "var(--ink2)", fontWeight: 400, ...mono }}> · {fmtDate(order.orderDate)}</span>
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
          {submitError && (
            <p role="alert" style={errStyle}>
              {submitError}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <StatusPill status={orderPillStatus(order.status)} label={humanize(order.status)} />
          {order.status === "draft" && (
            <button
              type="button"
              className="btn ghost sm"
              disabled={submitBusy}
              aria-label={`Submit the ${rowLabel} for approval`}
              onClick={() => void doSubmit()}
            >
              {submitBusy ? "Submitting…" : "Submit for approval"}
            </button>
          )}
          {order.status === "pending_approval" && (
            <>
              <button
                type="button"
                className="btn primary sm"
                aria-label={`Approve and issue the ${rowLabel}`}
                onClick={() => setShowIssue(true)}
              >
                Approve &amp; issue
              </button>
              <button
                type="button"
                className="btn ghost sm"
                aria-label={`Send back the ${rowLabel}`}
                onClick={() => setShowSendBack(true)}
              >
                Send back
              </button>
            </>
          )}
          {order.status === "issued" && (
            <button
              type="button"
              className="btn ghost sm"
              aria-label={`Recall the ${rowLabel}`}
              onClick={() => setShowRecall(true)}
            >
              Recall
            </button>
          )}
        </div>
      </div>

      {showIssue && (
        <ApproveIssueDialog
          order={order}
          rowLabel={rowLabel}
          onClose={() => setShowIssue(false)}
          onDone={onDone}
        />
      )}
      {showSendBack && (
        <SendBackPanel order={order} onClose={() => setShowSendBack(false)} onDone={onDone} />
      )}
      {showRecall && (
        <RecallDialog
          order={order}
          rowLabel={rowLabel}
          onClose={() => setShowRecall(false)}
          onDone={onDone}
        />
      )}
    </div>
  );
}

// ─── Approve & issue (ConfirmDialog — human, DSC-signed, irreversible) ───────

function ApproveIssueDialog({
  order,
  rowLabel,
  onClose,
  onDone,
}: {
  order: CourtOrder;
  rowLabel: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [dsc, setDsc] = useState("");
  const [issuedDate, setIssuedDate] = useState(todayIso());
  const [dscError, setDscError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();

  const dscId = useId();
  const dscErrId = useId();
  const dateId = useId();
  const dateErrId = useId();
  const dscRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  function validate(): boolean {
    let ok = true;
    if (!dsc.trim()) {
      setDscError("Paste the DSC signature blob to pronounce this order.");
      dscRef.current?.focus();
      ok = false;
    } else {
      setDscError(undefined);
    }
    if (issuedDate) {
      const d = new Date(`${issuedDate}T00:00:00`);
      if (Number.isNaN(d.getTime())) {
        setDateError("That issued date isn't valid.");
        if (ok) dateRef.current?.focus();
        ok = false;
      } else {
        setDateError(undefined);
      }
    }
    return ok;
  }

  function proceed() {
    setServerError(undefined);
    if (!validate()) return;
    setConfirmOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setServerError(undefined);
    try {
      await approveAndIssueOrder(order.id, {
        dscSignature: dsc.trim(),
        expectedVersion: order.version,
        ...(issuedDate ? { issuedDate } : {}),
      });
      setConfirmOpen(false);
      // Writes are command-bus backed (202 Accepted) — say "submitted", not
      // a completed pronouncement the UI hasn't actually confirmed yet.
      await onDone("Approval & issuance submitted — pending confirmation.");
      onClose();
    } catch (err) {
      setServerError(
        err instanceof Error
          ? err.message
          : "Could not issue the order (a self-approval is rejected — the approver must differ from the maker).",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <p style={{ fontSize: 12.5, color: "var(--ink2)", margin: 0 }}>
        Issuance is a human, DSC-signed act by an officer other than the drafter. The service
        rejects a self-approval.
      </p>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={dscId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Digital Signature Certificate (DSC) <span aria-hidden="true">*</span>
        </label>
        <textarea
          id={dscId}
          ref={dscRef}
          placeholder="-----BEGIN PKCS7----- …"
          value={dsc}
          onChange={(e) => setDsc(e.target.value)}
          rows={2}
          aria-required="true"
          aria-invalid={!!dscError || undefined}
          aria-describedby={dscError ? dscErrId : undefined}
          style={{ ...fieldStyle, resize: "vertical", ...mono }}
        />
        {dscError && (
          <p id={dscErrId} role="alert" style={errStyle}>
            {dscError}
          </p>
        )}
      </div>
      <div style={{ display: "grid", gap: 4, maxWidth: 200 }}>
        <label htmlFor={dateId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Pronouncement date
        </label>
        <input
          id={dateId}
          ref={dateRef}
          type="date"
          value={issuedDate}
          onChange={(e) => setIssuedDate(e.target.value)}
          aria-invalid={!!dateError || undefined}
          aria-describedby={dateError ? dateErrId : undefined}
          style={fieldStyle}
        />
        {dateError && (
          <p id={dateErrId} role="alert" style={errStyle}>
            {dateError}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary sm" onClick={proceed}>
          Approve &amp; issue
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Approve &amp; issue this order?"
        confirmLabel="Confirm approve & issue"
        danger
        busy={busy}
        errorMessage={serverError}
        description={
          <>
            Pronounce the {rowLabel} with the pasted DSC signature. This is a human, irreversible
            act of the court and cannot be undone (an issued order may only be recalled, not
            un-issued).
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Send back (procedural — returns to maker, not terminal) ────────────────

function SendBackPanel({
  order,
  onClose,
  onDone,
}: {
  order: CourtOrder;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remarksId = useId();

  async function send() {
    setBusy(true);
    setError(null);
    try {
      await sendBackOrder(order.id, {
        expectedVersion: order.version,
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      await onDone("Send-back submitted.");
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the order back.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={remarksId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Remarks for the maker (optional)
        </label>
        <input id={remarksId} value={remarks} onChange={(e) => setRemarks(e.target.value)} style={fieldStyle} />
      </div>
      {error && (
        <p role="alert" style={errStyle}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary sm" disabled={busy} onClick={() => void send()}>
          {busy ? "…" : "Confirm send back"}
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// ─── Recall (ConfirmDialog — deliberate, reason-carrying reversal) ──────────

function RecallDialog({
  order,
  rowLabel,
  onClose,
  onDone,
}: {
  order: CourtOrder;
  rowLabel: string;
  onClose: () => void;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();

  const reasonId = useId();
  const reasonErrId = useId();
  const reasonRef = useRef<HTMLInputElement>(null);

  function proceed() {
    setServerError(undefined);
    if (!reason.trim()) {
      setReasonError("Enter the reason for recalling this order.");
      reasonRef.current?.focus();
      return;
    }
    setReasonError(undefined);
    setConfirmOpen(true);
  }

  async function confirm() {
    setBusy(true);
    setServerError(undefined);
    try {
      await recallOrder(order.id, { recallReason: reason.trim(), expectedVersion: order.version });
      setConfirmOpen(false);
      await onDone("Recall submitted.");
      onClose();
    } catch (err) {
      setServerError(err instanceof Error ? err.message : "Could not recall the order.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
      <div style={{ display: "grid", gap: 4 }}>
        <label htmlFor={reasonId} style={{ fontSize: 12.5, fontWeight: 600 }}>
          Recall reason <span aria-hidden="true">*</span>
        </label>
        <input
          id={reasonId}
          ref={reasonRef}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          aria-required="true"
          aria-invalid={!!reasonError || undefined}
          aria-describedby={reasonError ? reasonErrId : undefined}
          style={fieldStyle}
        />
        {reasonError && (
          <p id={reasonErrId} role="alert" style={errStyle}>
            {reasonError}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button type="button" className="btn primary sm" onClick={proceed}>
          Recall order
        </button>
        <button type="button" className="btn ghost sm" onClick={onClose}>
          Cancel
        </button>
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Recall this issued order?"
        confirmLabel="Confirm recall"
        danger
        busy={busy}
        errorMessage={serverError}
        description={
          <>
            Recall the {rowLabel}. This withdraws an already-pronounced order — record the reason
            carefully, it is retained on the order.
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}
