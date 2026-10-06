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
import { Button, Card, ConfirmDialog, EmptyState, Modal, StatusPill } from "@/app/_components/ds";
import { DataSourceBadge } from "@/app/_components/DataSourceBadge";
import type { CourtOrder, Hearing } from "../_data/types";
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

/**
 * GAP-COURT-ORDERS-02 — structural validation of a pasted detached DSC blob.
 *
 * The judicial issuance act hinges on this signature, so we no longer accept
 * "any non-empty string". Until a signer-token / eSign integration lands
 * (see the HUMAN REVIEW note in the batch report), the field is an explicit,
 * clearly-labelled PASTE fallback — but it must at least be a well-formed
 * PKCS#7 blob: either PEM-armoured (-----BEGIN PKCS7/CMS/CERTIFICATE-----)
 * or raw base64 of a plausible length. This catches a mis-paste (a password,
 * a filename, a truncated blob) before the irreversible server round-trip.
 * The court-service still stores the blob verbatim; true cryptographic
 * verification (signer CN, cert chain, validity) is a backend/PKI task.
 *
 * Returns an error message string when invalid, or null when it looks like a
 * structurally-valid signature blob.
 */
export function validateDscBlob(raw: string): string | null {
  const s = raw.trim();
  if (!s) return "Paste the DSC signature blob to pronounce this order.";

  const isPem = /-----BEGIN (PKCS7|CMS|CERTIFICATE|SIGNED MESSAGE)-----/.test(s);
  // PEM armour is itself a strong signal of intent (you don't type
  // "-----BEGIN PKCS7-----" by accident); accept it. The server stores the
  // blob verbatim and true crypto verification is a backend/PKI task.
  if (isPem) return null;

  // Raw (un-armoured) paste: reject the obvious mis-pastes (a password, a
  // filename, a truncated blob). A detached PKCS#7 signature is sizeable and
  // base64; a mistyped word is neither.
  const body = s.replace(/\s+/g, "");
  if (body.length < 64) {
    return "That doesn't look like a DSC signature blob. Paste the full PKCS#7 signature from your signing token.";
  }
  if (!/^[A-Za-z0-9+/=]+$/.test(body)) {
    return "The DSC signature must be a base64 PKCS#7 blob (optionally PEM-armoured). Check what you pasted.";
  }
  if (body.length % 4 !== 0) {
    return "The DSC signature doesn't decode as valid base64. Paste the complete signature from your token.";
  }
  return null;
}

export function OrdersConsole({
  caseId,
  caseSummary,
  initialOrders,
  ordersSource,
  currentUserId = null,
  hearings = [],
}: {
  caseId: string;
  caseSummary: { title: string | null; cnrNumber: string | null };
  initialOrders: CourtOrder[];
  ordersSource: "api" | "error";
  /** GAP-COURT-ORDERS-01: the signed-in officer's id (JWT sub), for the
   *  maker-checker UX hint. null when unknown — the server stays the authority. */
  currentUserId?: string | null;
  /** GAP-COURT-ORDERS-05: the case's hearings, for the optional draft link. */
  hearings?: Hearing[];
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
        hearings={hearings}
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
                currentUserId={currentUserId}
                hearings={hearings}
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
  hearings,
  onDone,
}: {
  caseId: string;
  hearings: Hearing[];
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [orderType, setOrderType] = useState("");
  const [orderText, setOrderText] = useState("");
  const [orderDate, setOrderDate] = useState(todayIso());
  const [hearingId, setHearingId] = useState("");
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
  const hearingSelId = useId();
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
        ...(hearingId ? { hearingId } : {}),
      });
      setOrderType("");
      setOrderText("");
      setHearingId("");
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
          {hearings.length > 0 && (
            <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
              <label htmlFor={hearingSelId} style={{ fontSize: 12.5, fontWeight: 600 }}>
                Linked hearing
              </label>
              <select
                id={hearingSelId}
                value={hearingId}
                onChange={(e) => setHearingId(e.target.value)}
                style={fieldStyle}
              >
                <option value="">No linked hearing</option>
                {hearings.map((h) => (
                  <option key={h.id} value={h.id}>
                    {fmtDate(h.scheduledDate)}
                    {h.purpose ? ` · ${h.purpose}` : ""} ({humanize(h.status)})
                  </option>
                ))}
              </select>
            </div>
          )}
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
          <Button type="submit" variant="primary" disabled={busy}>
            {busy ? "Drafting…" : "Draft order"}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ─── Order row ───────────────────────────────────────────────────────────────

function OrderRow({
  order,
  caseLabel,
  currentUserId,
  hearings,
  onDone,
}: {
  order: CourtOrder;
  caseLabel: string;
  currentUserId: string | null;
  hearings: Hearing[];
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [submitBusy, setSubmitBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [showIssue, setShowIssue] = useState(false);
  const [showSendBack, setShowSendBack] = useState(false);
  const [showRecall, setShowRecall] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [showPrint, setShowPrint] = useState(false);

  // GAP-COURT-ORDERS-01: the viewer drafted this order themselves, so a
  // self-approval would be rejected by the service (approver ≠ maker). Offer
  // the maker-checker hint and disable the control. createdBy may be null on
  // older rows; only disable when we can positively match the signed-in id.
  const isOwnDraft =
    !!currentUserId && !!order.createdBy && order.createdBy === currentUserId;

  // GAP-COURT-ORDERS-05: resolve the linked hearing (if any) for display.
  const linkedHearing = order.hearingId
    ? hearings.find((h) => h.id === order.hearingId) ?? null
    : null;

  // GAP-COURT-ORDERS-03: long judgments make the list unusable; clamp the body
  // to a few lines with a "Show full order" toggle. A short order is never
  // clamped (nothing to expand).
  const orderTextStr = order.orderText ?? "";
  const isLongText = orderTextStr.length > 320 || orderTextStr.split("\n").length > 4;

  const bodyId = useId();

  // Include a short id suffix — two same-type orders drafted the same day on
  // the same case would otherwise collide and give every row action button
  // (submit/approve/send-back/recall) the same accessible name.
  const rowLabel = `${humanize(order.orderType)} order (${fmtDate(order.orderDate)}) for ${caseLabel} (#${order.id.slice(0, 8)})`;

  async function doSubmit() {
    setSubmitBusy(true);
    setSubmitError(null);
    try {
      await submitOrderForApproval(order.id, order.version);
      setShowSubmitConfirm(false);
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
            <div style={{ marginTop: 2 }}>
              <div
                id={bodyId}
                style={{
                  fontSize: 13,
                  color: "var(--ink2)",
                  whiteSpace: "pre-wrap",
                  ...(isLongText && !expanded
                    ? {
                        display: "-webkit-box",
                        WebkitLineClamp: 4,
                        WebkitBoxOrient: "vertical" as const,
                        overflow: "hidden",
                      }
                    : {}),
                }}
              >
                {order.orderText}
              </div>
              {isLongText && (
                <button
                  type="button"
                  className="btn ghost sm"
                  aria-expanded={expanded}
                  aria-controls={bodyId}
                  onClick={() => setExpanded((v) => !v)}
                  style={{ marginTop: 4, padding: "2px 6px", fontSize: 12 }}
                >
                  {expanded ? "Show less" : "Show full order"}
                </button>
              )}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, ...mono }}>
            v{order.version}
            {order.hasDsc && " · DSC signed"}
            {order.issuedAt && ` · issued ${fmtDateTime(order.issuedAt)}`}
            {linkedHearing && ` · hearing: ${fmtDate(linkedHearing.scheduledDate)}`}
            {!linkedHearing && order.hearingId && " · hearing linked"}
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
            <Button
              variant="ghost"
              size="sm"
              disabled={submitBusy}
              aria-label={`Submit the ${rowLabel} for approval`}
              onClick={() => setShowSubmitConfirm(true)}
            >
              {submitBusy ? "Submitting…" : "Submit for approval"}
            </Button>
          )}
          {order.status === "pending_approval" && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={isOwnDraft}
                aria-label={`Approve and issue the ${rowLabel}`}
                title={
                  isOwnDraft
                    ? "You drafted this order; another officer must approve it"
                    : undefined
                }
                aria-describedby={isOwnDraft ? `${bodyId}-maker` : undefined}
                onClick={() => setShowIssue(true)}
              >
                Approve &amp; issue
              </Button>
              {isOwnDraft && (
                <p
                  id={`${bodyId}-maker`}
                  style={{ ...errStyle, flexBasis: "100%", margin: 0 }}
                >
                  You drafted this order; another officer must approve it.
                </p>
              )}
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Send back the ${rowLabel}`}
                onClick={() => setShowSendBack(true)}
              >
                Send back
              </Button>
            </>
          )}
          {order.status === "issued" && (
            <>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`View or print the ${rowLabel}`}
                onClick={() => setShowPrint(true)}
              >
                View / Print
              </Button>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Recall the ${rowLabel}`}
                onClick={() => setShowRecall(true)}
              >
                Recall
              </Button>
            </>
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

      {/* GAP-COURT-ORDERS-04: Submit for approval locks the draft (draft →
          pending_approval), so confirm the irreversible-within-the-step move
          before firing. Cancel makes no request. */}
      <ConfirmDialog
        open={showSubmitConfirm}
        title="Submit this order for approval?"
        confirmLabel="Confirm submit for approval"
        busy={submitBusy}
        errorMessage={submitError ?? undefined}
        description={
          <>
            Submit the {rowLabel} for approval. The draft is locked for editing and moves to a
            different officer to approve &amp; issue (or send back). You can&apos;t edit it again
            unless it is sent back to you.
          </>
        }
        onConfirm={() => void doSubmit()}
        onCancel={() => !submitBusy && setShowSubmitConfirm(false)}
      />

      {/* GAP-COURT-ORDERS-03: official print view of an ISSUED order only. */}
      {showPrint && order.status === "issued" && (
        <PrintOrderDialog
          order={order}
          caseLabel={caseLabel}
          linkedHearing={linkedHearing}
          onClose={() => setShowPrint(false)}
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
    const dscProblem = validateDscBlob(dsc);
    if (dscProblem) {
      setDscError(dscProblem);
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
      <p style={{ fontSize: 12, color: "var(--ink2)", margin: 0 }}>
        Paste the detached PKCS#7 signature produced by your signing token for this order. This
        pasted-blob step is an interim fallback: the signer-token / eSign integration and
        server-side certificate verification (signer identity, validity) are pending — see the
        order-issuance workflow note. The blob is checked for structural validity here; it is not
        yet cryptographically verified in the browser.
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
        <Button variant="primary" size="sm" onClick={proceed}>
          Approve &amp; issue
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
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
  const [remarksError, setRemarksError] = useState<string | undefined>();
  const remarksId = useId();
  const remarksErrId = useId();
  const remarksRef = useRef<HTMLInputElement>(null);

  async function send() {
    // GAP-COURT-ORDERS-04: a send-back must tell the maker WHY, so remarks are
    // required (the maker-checker loop is useless without the reason).
    if (!remarks.trim()) {
      setRemarksError("Enter remarks so the maker knows what to revise.");
      remarksRef.current?.focus();
      return;
    }
    setRemarksError(undefined);
    setBusy(true);
    setError(null);
    try {
      await sendBackOrder(order.id, {
        expectedVersion: order.version,
        remarks: remarks.trim(),
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
          Remarks for the maker <span aria-hidden="true">*</span>
        </label>
        <input
          id={remarksId}
          ref={remarksRef}
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
          aria-required="true"
          aria-invalid={!!remarksError || undefined}
          aria-describedby={remarksError ? remarksErrId : undefined}
          style={fieldStyle}
        />
        {remarksError && (
          <p id={remarksErrId} role="alert" style={errStyle}>
            {remarksError}
          </p>
        )}
      </div>
      {error && (
        <p role="alert" style={errStyle}>
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8 }}>
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void send()}>
          {busy ? "…" : "Confirm send back"}
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
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
        <Button variant="primary" size="sm" onClick={proceed}>
          Recall order
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
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

// ─── Print view (GAP-COURT-ORDERS-03 — official copy of an ISSUED order) ─────

/**
 * A print-styled dialog for an ISSUED order only. The caller gates on
 * `order.status === "issued"` so a draft/pending/recalled order can never be
 * printed as an official copy. `window.print()` with print CSS keeps the
 * dependency-free DS Modal shell; the @media print rules (in globals) hide
 * everything except the `.court-order-print` region.
 */
function PrintOrderDialog({
  order,
  caseLabel,
  linkedHearing,
  onClose,
}: {
  order: CourtOrder;
  caseLabel: string;
  linkedHearing: Hearing | null;
  onClose: () => void;
}) {
  const labelStyle: React.CSSProperties = {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.4,
    color: "var(--ink2)",
  };
  return (
    <Modal open onClose={onClose} title="Issued order" size="lg">
      <div className="court-order-print" style={{ display: "grid", gap: 10 }}>
        <style>{`@media print {
          body * { visibility: hidden !important; }
          .court-order-print, .court-order-print * { visibility: visible !important; }
          .court-order-print { position: absolute; left: 0; top: 0; width: 100%; padding: 24px; }
          .court-order-noprint { display: none !important; }
        }`}</style>
        <div style={{ borderBottom: "1px solid var(--line)", paddingBottom: 8 }}>
          <div style={{ fontWeight: 700, fontSize: 16 }}>{caseLabel}</div>
          <div style={{ ...labelStyle }}>
            {humanize(order.orderType)} order · {fmtDate(order.orderDate)}
          </div>
        </div>
        <div>
          <div style={labelStyle}>Order</div>
          <div style={{ whiteSpace: "pre-wrap", fontSize: 13.5, marginTop: 2 }}>
            {order.orderText || "—"}
          </div>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, ...mono, fontSize: 12 }}>
          <span>
            <span style={labelStyle}>Status</span>
            <br />
            {humanize(order.status)}
          </span>
          <span>
            <span style={labelStyle}>Issued</span>
            <br />
            {fmtDateTime(order.issuedAt)}
          </span>
          <span>
            <span style={labelStyle}>DSC</span>
            <br />
            {order.hasDsc ? "Signed" : "Not signed"}
          </span>
          {linkedHearing && (
            <span>
              <span style={labelStyle}>Linked hearing</span>
              <br />
              {fmtDate(linkedHearing.scheduledDate)}
            </span>
          )}
        </div>
      </div>
      <div className="court-order-noprint" style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" onClick={() => window.print()}>
          Print
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Modal>
  );
}
