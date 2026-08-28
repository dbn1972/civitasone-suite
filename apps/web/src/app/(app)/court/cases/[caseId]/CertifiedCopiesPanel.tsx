"use client";

/**
 * CertifiedCopiesPanel — certified-copy applications on a case (§30).
 *
 * A citizen-facing clerk applies for a certified copy of an order / judgment /
 * case document; the server resolves the SERVER-AUTHORITATIVE fee. The copy
 * then moves requested → fee_paid → prepared → issued (reject from any
 * pre-terminal state). Moving to fee_paid REQUIRES a payment reference AND a
 * receipted amount — the service rejects a bare status flip with no proof of
 * payment, and separately verifies the receipted amount matches the fee
 * recorded on the copy (a mismatch is rejected, not silently accepted).
 * Rejecting a copy REQUIRES a remarks reason — an adverse, irreversible
 * decision on a citizen's application always carries a reason on record.
 */
import { useCallback, useId, useRef, useState } from "react";
import { Card, EmptyState, StatusPill } from "@/app/_components/ds";
import type { CertifiedCopy, CopyStatus } from "../../_data/types";
import { COPY_TRANSITIONS } from "../../_data/types";
import { fmtDateTime, humanize, copyPillStatus } from "../../_data/format";
import { fetchCaseCertifiedCopies, requestCertifiedCopy, transitionCertifiedCopy } from "../../_data/client";

const fieldStyle: React.CSSProperties = {
  padding: 8,
  borderRadius: 8,
  border: "1px solid var(--line)",
  fontSize: 13.5,
  width: "100%",
};
const mono: React.CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  fontVariantNumeric: "tabular-nums",
};
const errStyle: React.CSSProperties = { color: "var(--bad, #c0392b)", fontSize: 12, margin: "4px 0 0" };

/** Render a BigInt-paise string as rupees, e.g. "1500" → "₹15.00". */
function fmtPaise(minor: string | null): string {
  if (minor === null) return "—";
  try {
    const n = BigInt(minor);
    const rupees = n / 100n;
    const paise = (n % 100n).toString().padStart(2, "0");
    return `₹${rupees}.${paise}`;
  } catch {
    return minor;
  }
}

export function CertifiedCopiesPanel({
  caseId,
  initialCopies,
  source,
}: {
  caseId: string;
  initialCopies: CertifiedCopy[];
  source: "api" | "error";
}) {
  const [copies, setCopies] = useState<CertifiedCopy[]>(initialCopies);
  const [copiesSource, setCopiesSource] = useState<"api" | "error">(source);
  const [toast, setToast] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setCopies(await fetchCaseCertifiedCopies(caseId));
      setCopiesSource("api");
    } catch {
      setCopiesSource("error");
    }
  }, [caseId]);

  const flash = useCallback((msg: string) => setToast(msg), []);

  return (
    <Card title={copiesSource === "error" ? "Certified copies" : `Certified copies (${copies.length})`} padding>
      {toast && (
        <div className="alert" role="status" style={{ borderColor: "var(--primary)", marginBottom: 10 }}>
          ✓ {toast}
        </div>
      )}
      <p style={{ fontSize: 12.5, color: "var(--ink2)", marginBottom: 10 }}>
        Applications for a certified copy of an order, judgment, or case document (§30). The fee is
        server-computed; moving a copy to <strong>fee paid</strong> requires a payment reference and
        a receipted amount that matches the fee — a mismatch is rejected, not silently accepted.
      </p>

      <RequestCopyForm
        caseId={caseId}
        onDone={async (msg) => {
          flash(msg);
          await reload();
        }}
      />

      {copiesSource === "error" && copies.length === 0 ? (
        <EmptyState
          icon="🧾"
          title="Could not load certified copies"
          message="Live data couldn't be reached. Newly requested copies will appear once it returns."
        />
      ) : copies.length === 0 ? (
        <EmptyState icon="🧾" title="No certified copies yet" message="Apply for the first copy above." />
      ) : (
        <div style={{ display: "grid", gap: 10 }}>
          {copies.map((c) => (
            <CopyRow
              key={c.id}
              copy={c}
              onDone={async (msg) => {
                flash(msg);
                await reload();
              }}
            />
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Request form ────────────────────────────────────────────────────────────

function RequestCopyForm({
  caseId,
  onDone,
}: {
  caseId: string;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const [documentRef, setDocumentRef] = useState("");
  const [applicantName, setApplicantName] = useState("");
  const [copiesCount, setCopiesCount] = useState("1");
  const [urgent, setUrgent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const docId = useId();
  const nameId = useId();
  const countId = useId();
  const urgentId = useId();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const n = Number.parseInt(copiesCount, 10);
    if (!Number.isFinite(n) || n < 1) {
      setError("Enter a valid number of copies (1 or more).");
      return;
    }
    setBusy(true);
    try {
      await requestCertifiedCopy(caseId, {
        ...(documentRef.trim() ? { documentRef: documentRef.trim() } : {}),
        ...(applicantName.trim() ? { applicantName: applicantName.trim() } : {}),
        copiesCount: n,
        urgent,
      });
      setDocumentRef("");
      setApplicantName("");
      setCopiesCount("1");
      setUrgent(false);
      await onDone("Certified copy application submitted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not submit the application.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 8, marginBottom: 14 }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
        <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
          <label htmlFor={docId} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Document / order ref (optional)
          </label>
          <input
            id={docId}
            placeholder="e.g. order id or filing ref"
            value={documentRef}
            onChange={(e) => setDocumentRef(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
          <label htmlFor={nameId} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Applicant name (optional)
          </label>
          <input
            id={nameId}
            placeholder="Applicant's name"
            value={applicantName}
            onChange={(e) => setApplicantName(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ display: "grid", gap: 4, maxWidth: 120 }}>
          <label htmlFor={countId} style={{ fontSize: 12.5, fontWeight: 600 }}>
            Copies
          </label>
          <input
            id={countId}
            type="number"
            min={1}
            max={100}
            value={copiesCount}
            onChange={(e) => setCopiesCount(e.target.value)}
            style={fieldStyle}
          />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 20 }}>
          <input id={urgentId} type="checkbox" checked={urgent} onChange={(e) => setUrgent(e.target.checked)} />
          <label htmlFor={urgentId} style={{ fontSize: 12.5 }}>
            Urgent
          </label>
        </div>
      </div>
      {error && (
        <p role="alert" style={errStyle}>
          {error}
        </p>
      )}
      <div>
        <button type="submit" className="btn primary" disabled={busy}>
          {busy ? "Submitting…" : "Apply for certified copy"}
        </button>
      </div>
    </form>
  );
}

// ─── Copy row ────────────────────────────────────────────────────────────────

function CopyRow({
  copy,
  onDone,
}: {
  copy: CertifiedCopy;
  onDone: (msg: string) => Promise<void> | void;
}) {
  const nextStates = COPY_TRANSITIONS[copy.status] ?? [];
  const [mode, setMode] = useState<"none" | CopyStatus>("none");
  const [paymentRef, setPaymentRef] = useState("");
  const [receiptMinor, setReceiptMinor] = useState("");
  const [deliveryMode, setDeliveryMode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const paymentRefRef = useRef<HTMLInputElement>(null);
  const remarksRef = useRef<HTMLInputElement>(null);
  const paymentRefId = useId();
  const receiptMinorId = useId();
  const deliveryModeId = useId();
  const remarksId = useId();

  async function apply(target: CopyStatus) {
    setError(null);
    if (target === "fee_paid" && (!paymentRef.trim() || !receiptMinor.trim())) {
      setError("Enter both the payment reference and the receipted amount to record fee_paid.");
      paymentRefRef.current?.focus();
      return;
    }
    if (target === "rejected" && !remarks.trim()) {
      setError("Enter a reason for rejecting this certified copy.");
      remarksRef.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await transitionCertifiedCopy(copy.id, {
        target,
        expectedVersion: copy.version,
        ...(target === "fee_paid" ? { paymentRef: paymentRef.trim(), receiptMinor: receiptMinor.trim() } : {}),
        ...(target === "issued" && deliveryMode.trim() ? { deliveryMode: deliveryMode.trim() } : {}),
        ...(remarks.trim() ? { remarks: remarks.trim() } : {}),
      });
      setMode("none");
      setPaymentRef("");
      setReceiptMinor("");
      setDeliveryMode("");
      setRemarks("");
      await onDone(`Certified copy moved to “${humanize(target)}”.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : `Could not move the copy to "${humanize(target)}".`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ border: "1px solid var(--line2)", borderRadius: 10, padding: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 260px" }}>
          <div style={{ fontWeight: 600 }}>
            {copy.documentRef ? copy.documentRef : `Copy #${copy.id.slice(0, 8)}`}
            {copy.urgent && <span style={{ color: "var(--ink2)", fontWeight: 400 }}> · urgent</span>}
          </div>
          <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 2, ...mono }}>
            {copy.copiesCount} {copy.copiesCount === 1 ? "copy" : "copies"} · fee {fmtPaise(copy.feeMinor)}
            {copy.feeSource ? ` (${copy.feeSource})` : ""}
          </div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 4, ...mono }}>
            v{copy.version}
            {copy.paymentRef && ` · paid ref ${copy.paymentRef} (${fmtPaise(copy.receiptMinor)})`}
            {copy.issuedAt && ` · issued ${fmtDateTime(copy.issuedAt)}`}
            {copy.deliveryMode && ` · via ${copy.deliveryMode}`}
          </div>
          {copy.remarks && (
            <div style={{ fontSize: 12.5, color: "var(--ink2)", marginTop: 4 }}>{copy.remarks}</div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}>
          <StatusPill status={copyPillStatus(copy.status)} label={humanize(copy.status)} />
          {mode === "none" &&
            nextStates.map((s) => (
              <button
                key={s}
                type="button"
                className={s === "rejected" ? "btn ghost sm" : "btn primary sm"}
                onClick={() => setMode(s)}
              >
                {s === "fee_paid" ? "Record fee paid" : s === "rejected" ? "Reject" : `Mark ${humanize(s)}`}
              </button>
            ))}
        </div>
      </div>

      {mode !== "none" && (
        <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
          {mode === "fee_paid" && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
              <div style={{ display: "grid", gap: 4, flex: "1 1 200px" }}>
                <label htmlFor={paymentRefId} style={{ fontSize: 12.5, fontWeight: 600 }}>
                  Payment reference <span aria-hidden="true">*</span>
                </label>
                <input
                  id={paymentRefId}
                  ref={paymentRefRef}
                  placeholder="Gateway / challan reference"
                  value={paymentRef}
                  onChange={(e) => setPaymentRef(e.target.value)}
                  style={fieldStyle}
                />
              </div>
              <div style={{ display: "grid", gap: 4, flex: "1 1 160px" }}>
                <label htmlFor={receiptMinorId} style={{ fontSize: 12.5, fontWeight: 600 }}>
                  Receipted amount (paise) <span aria-hidden="true">*</span>
                </label>
                <input
                  id={receiptMinorId}
                  placeholder={copy.feeMinor}
                  value={receiptMinor}
                  onChange={(e) => setReceiptMinor(e.target.value)}
                  style={{ ...fieldStyle, ...mono }}
                />
              </div>
            </div>
          )}
          {mode === "issued" && (
            <div style={{ display: "grid", gap: 4 }}>
              <label htmlFor={deliveryModeId} style={{ fontSize: 12.5, fontWeight: 600 }}>
                Delivery mode (optional)
              </label>
              <input
                id={deliveryModeId}
                placeholder="e.g. post, in-person"
                value={deliveryMode}
                onChange={(e) => setDeliveryMode(e.target.value)}
                style={fieldStyle}
              />
            </div>
          )}
          <div style={{ display: "grid", gap: 4 }}>
            <label htmlFor={remarksId} style={{ fontSize: 12.5, fontWeight: 600 }}>
              Remarks {mode === "rejected" ? <span aria-hidden="true">*</span> : "(optional)"}
            </label>
            <input
              id={remarksId}
              ref={remarksRef}
              placeholder={mode === "rejected" ? "Reason for rejecting this application" : undefined}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              style={fieldStyle}
            />
          </div>
          {error && (
            <p role="alert" style={errStyle}>
              {error}
            </p>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={() => void apply(mode)}
            >
              {busy ? "…" : `Confirm ${mode === "fee_paid" ? "fee paid" : humanize(mode).toLowerCase()}`}
            </button>
            <button type="button" className="btn ghost sm" onClick={() => { setMode("none"); setError(null); }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
