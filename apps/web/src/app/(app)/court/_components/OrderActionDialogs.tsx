"use client";

/**
 * Order action dialogs shared by the standalone Orders console and the case
 * console (GAP-COURT-CASES-CASEID-01): ONE implementation of approve & issue
 * (server-verified DSC, ConfirmDialog), send back (remarks required) and recall
 * (reason required, ConfirmDialog), so the two screens cannot drift into two
 * UX contracts for the same irreversible act.
 */
import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Button, ConfirmDialog } from "@/app/_components/ds";
import type { CourtOrder } from "../_data/types";
import { fmtDate, todayIso } from "../_data/format";
import {
  approveAndIssueOrder,
  recallOrder,
  sendBackOrder,
  verifyOrderDsc,
  type DscVerificationResult,
} from "../_data/client";
import { errStyle, fieldStyle, mono } from "./courtFormStyles";

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

// ─── Approve & issue (ConfirmDialog — human, DSC-signed, irreversible) ───────

export function ApproveIssueDialog({
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
  const tm = useTranslations("pqbMoney");
  const [dsc, setDsc] = useState("");
  const [issuedDate, setIssuedDate] = useState(todayIso());
  const [dscError, setDscError] = useState<string | undefined>();
  const [dateError, setDateError] = useState<string | undefined>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | undefined>();
  // GAP-COURT-ORDERS-02: server-side DSC verification before the irreversible issue.
  const [verifying, setVerifying] = useState(false);
  const [verification, setVerification] = useState<DscVerificationResult | null>(null);
  const [verifyError, setVerifyError] = useState<string | undefined>();

  const dscId = useId();
  const dscErrId = useId();
  const dateId = useId();
  const dateErrId = useId();
  const dscRef = useRef<HTMLTextAreaElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);

  // Any edit to the pasted blob invalidates a prior verification result.
  function onDscChange(v: string) {
    setDsc(v);
    if (verification) setVerification(null);
    if (verifyError) setVerifyError(undefined);
  }

  async function runVerify() {
    setVerifyError(undefined);
    setVerification(null);
    const dscProblem = validateDscBlob(dsc);
    if (dscProblem) {
      setDscError(dscProblem);
      dscRef.current?.focus();
      return;
    }
    setDscError(undefined);
    setVerifying(true);
    try {
      const result = await verifyOrderDsc(order.id, dsc.trim());
      setVerification(result);
    } catch (err) {
      setVerifyError(
        err instanceof Error ? err.message : "Could not verify the DSC signature on the server.",
      );
    } finally {
      setVerifying(false);
    }
  }

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
    // GAP-COURT-ORDERS-02: require a SUCCESSFUL server-side verification of the
    // pasted signature before allowing the irreversible issue — fail closed. The
    // server independently re-verifies and rejects a bad signature regardless, so
    // this is a UX guard, not the authority.
    if (!verification || !verification.ok) {
      setVerifyError(
        verification
          ? "The signature did not verify on the server — resolve the issues above before issuing."
          : "Verify the DSC signature before issuing this order.",
      );
      ok = false;
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
        Paste the detached PKCS#7 signature produced by your signing token for this order, then{" "}
        <strong>verify</strong> it. Verification is performed on the server: it parses the PKCS#7,
        checks the signer certificate&apos;s validity and key usage, and cryptographically verifies
        the signature over this order&apos;s content. Chain-of-trust is additionally checked when a
        trust store is configured. The order can only be issued after the signature verifies; the
        server independently re-verifies and rejects an invalid signature.
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
          onChange={(e) => onDscChange(e.target.value)}
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button variant="ghost" size="sm" disabled={verifying || !dsc.trim()} onClick={() => void runVerify()}>
          {verifying ? "Verifying…" : "Verify signature"}
        </Button>
        {verification?.ok && (
          <span style={{ fontSize: 12, color: "var(--good)" }}>
            ✓ Signature verified{verification.signerCN ? ` — signer: ${verification.signerCN}` : ""}
            {verification.notAfter ? ` · valid until ${fmtDate(verification.notAfter)}` : ""}
            {verification.trustStoreConfigured
              ? verification.chainTrusted
                ? " · chain trusted"
                : " · chain NOT trusted"
              : " · chain-of-trust not configured on server"}
          </span>
        )}
      </div>
      {/* GAP-COURT-ORDERS-02 interim: be honest that a pasted blob is only as strong as the trust store. */}
      {verification?.ok && !verification.chainTrusted && (
        <p role="alert" data-testid="dsc-untrusted-warning" style={errStyle}>
          {tm("dscUntrusted", { storeState: verification.trustStoreConfigured ? "configured" : "none" })}
        </p>
      )}
      {verifyError && (
        <p role="alert" style={errStyle}>
          {verifyError}
        </p>
      )}
      {verification && !verification.ok && (
        <p role="alert" style={errStyle}>
          Signature did not verify: {verification.issues.join(", ")}.
          {verification.signerCN ? ` Signer certificate CN: ${verification.signerCN}.` : ""}
        </p>
      )}
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
        <Button
          variant="primary"
          size="sm"
          disabled={!verification?.ok}
          title={verification?.ok ? undefined : "Verify the DSC signature first"}
          onClick={proceed}
        >
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
            Pronounce the {rowLabel} with the server-verified DSC signature
            {verification?.signerCN ? ` (signer: ${verification.signerCN})` : ""}. This is a human,
            irreversible act of the court and cannot be undone (an issued order may only be
            recalled, not un-issued).
          </>
        }
        onConfirm={() => void confirm()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </div>
  );
}

// ─── Send back (procedural — returns to maker, not terminal) ────────────────

export function SendBackPanel({
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

export function RecallDialog({
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
