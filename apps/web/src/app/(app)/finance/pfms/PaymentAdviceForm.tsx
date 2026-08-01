"use client";

import { useId, useRef, useState } from "react";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type AdviceResult = {
  adviceId: string;
  pfmsRef: string;
  billId: string;
  amountMinor: number;
  status: string;
  submittedAt: string;
  message?: string;
};

type AdviceStatusResult = {
  adviceId: string;
  status: string;
  pfmsTransactionId: string;
  processedAt: string;
  utrNumber: string;
  message?: string;
};

type FieldKey = "billId" | "payeeName" | "payeeAccountNo" | "payeeIfsc" | "amountMinor" | "purposeCode";

/**
 * POST /v1/finance/pfms/payment-advice — generates a treasury payment advice.
 * Backend note: registered as an INTEGRATION STUB
 * (services/finance-service/src/modules/pfms/treasury-stubs.ts) — real route,
 * synthetic PFMS reference. `amountMinor` is paise per the backend schema
 * comment. Payee account number is a POST body field only, never placed in a
 * URL/query string.
 */
export function PaymentAdviceForm() {
  const [billId, setBillId] = useState("");
  const [payeeName, setPayeeName] = useState("");
  const [payeeAccountNo, setPayeeAccountNo] = useState("");
  const [payeeIfsc, setPayeeIfsc] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [purposeCode, setPurposeCode] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [lastAdviceId, setLastAdviceId] = useState<string | null>(null);

  const billIdId = useId();
  const nameId = useId();
  const acctId = useId();
  const ifscId = useId();
  const amountId = useId();
  const purposeId = useId();
  const ddoId = useId();
  const errId = useId();

  const billRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const acctRef = useRef<HTMLInputElement>(null);
  const ifscRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const purposeRef = useRef<HTMLInputElement>(null);
  const focusRefs: Record<FieldKey, React.RefObject<HTMLInputElement | null>> = {
    billId: billRef,
    payeeName: nameRef,
    payeeAccountNo: acctRef,
    payeeIfsc: ifscRef,
    amountMinor: amountRef,
    purposeCode: purposeRef,
  };

  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    const nextInvalid: Partial<Record<FieldKey, boolean>> = {
      billId: !uuidRe.test(billId.trim()),
      payeeName: !payeeName.trim(),
      payeeAccountNo: !payeeAccountNo.trim(),
      payeeIfsc: payeeIfsc.trim().length !== 11,
      amountMinor: !/^\d+$/.test(amountMinor.trim()) || Number(amountMinor) < 1,
      purposeCode: !purposeCode.trim(),
    };
    setInvalid(nextInvalid);
    const firstInvalid = (Object.keys(nextInvalid) as FieldKey[]).find((k) => nextInvalid[k]);
    if (firstInvalid) {
      focusRefs[firstInvalid].current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function submit() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const res = await browserJson<{ data: AdviceResult }>("v1/finance/pfms/payment-advice", {
        method: "POST",
        body: JSON.stringify({
          billId: billId.trim(),
          payeeName: payeeName.trim(),
          payeeAccountNo: payeeAccountNo.trim(),
          payeeIfsc: payeeIfsc.trim().toUpperCase(),
          amountMinor: Number(amountMinor.trim()),
          purposeCode: purposeCode.trim(),
          ddoCode: ddoCode.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setLastAdviceId(res.data.adviceId);
      setMessage(`Payment advice ${res.data.pfmsRef} generated — status: ${res.data.status}.`);
      setBillId("");
      setPayeeName("");
      setPayeeAccountNo("");
      setPayeeIfsc("");
      setAmountMinor("");
      setPurposeCode("");
      setDdoCode("");
      setInvalid({});
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const previewAmount = /^\d+$/.test(amountMinor.trim()) ? formatMoney(amountMinor.trim()) : null;

  return (
    <>
      <form onSubmit={handleSubmit}>
        <Card title="Generate Payment Advice" padding>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={billIdId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Bill ID (UUID) <span aria-hidden="true">*</span>
                </label>
                <input
                  id={billIdId}
                  ref={billRef}
                  value={billId}
                  onChange={(e) => setBillId(e.target.value)}
                  aria-required="true"
                  aria-invalid={invalid.billId || undefined}
                  aria-describedby={invalid.billId ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={nameId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Payee Name <span aria-hidden="true">*</span>
                </label>
                <input
                  id={nameId}
                  ref={nameRef}
                  value={payeeName}
                  onChange={(e) => setPayeeName(e.target.value)}
                  maxLength={256}
                  aria-required="true"
                  aria-invalid={invalid.payeeName || undefined}
                  aria-describedby={invalid.payeeName ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={acctId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Payee Account No. <span aria-hidden="true">*</span>
                </label>
                <input
                  id={acctId}
                  ref={acctRef}
                  value={payeeAccountNo}
                  onChange={(e) => setPayeeAccountNo(e.target.value)}
                  maxLength={32}
                  aria-required="true"
                  aria-invalid={invalid.payeeAccountNo || undefined}
                  aria-describedby={invalid.payeeAccountNo ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ifscId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Payee IFSC (11 chars) <span aria-hidden="true">*</span>
                </label>
                <input
                  id={ifscId}
                  ref={ifscRef}
                  value={payeeIfsc}
                  onChange={(e) => setPayeeIfsc(e.target.value)}
                  maxLength={11}
                  aria-required="true"
                  aria-invalid={invalid.payeeIfsc || undefined}
                  aria-describedby={invalid.payeeIfsc ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, textTransform: "uppercase" }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={amountId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Amount, in paise <span aria-hidden="true">*</span>
                </label>
                <input
                  id={amountId}
                  ref={amountRef}
                  value={amountMinor}
                  onChange={(e) => setAmountMinor(e.target.value)}
                  inputMode="numeric"
                  aria-required="true"
                  aria-invalid={invalid.amountMinor || undefined}
                  aria-describedby={invalid.amountMinor ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
                {previewAmount && <span style={{ fontSize: 12, color: "var(--muted, #666)" }}>{previewAmount}</span>}
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={purposeId} style={{ fontSize: 13, fontWeight: 600 }}>
                  Purpose Code <span aria-hidden="true">*</span>
                </label>
                <input
                  id={purposeId}
                  ref={purposeRef}
                  value={purposeCode}
                  onChange={(e) => setPurposeCode(e.target.value)}
                  maxLength={32}
                  aria-required="true"
                  aria-invalid={invalid.purposeCode || undefined}
                  aria-describedby={invalid.purposeCode ? errId : undefined}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={ddoId} style={{ fontSize: 13, fontWeight: 600 }}>DDO Code</label>
                <input
                  id={ddoId}
                  value={ddoCode}
                  onChange={(e) => setDdoCode(e.target.value)}
                  maxLength={32}
                  style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
                />
              </div>
            </div>

            {Object.values(invalid).some(Boolean) && (
              <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
                Bill ID, payee name, account number, an 11-character IFSC, amount (paise), and
                purpose code are all required.
              </p>
            )}

            <div>
              <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
                Generate Payment Advice
              </button>
            </div>

            {message && (
              <p role="status" className="pill good" style={{ width: "fit-content" }}>
                {message}
              </p>
            )}
          </div>
        </Card>

        <ConfirmDialog
          open={confirmOpen}
          title="Generate this payment advice?"
          confirmLabel="Generate advice"
          danger
          busy={busy}
          errorMessage={dialogError}
          description={
            <>
              Generate a treasury payment advice for <strong>{payeeName}</strong> (
              {previewAmount ?? "amount above"}). This submits to the treasury workflow and cannot
              be undone.
            </>
          }
          onConfirm={() => void submit()}
          onCancel={() => !busy && setConfirmOpen(false)}
        />
      </form>

      <AdviceStatusLookup prefillAdviceId={lastAdviceId} />
    </>
  );
}

/** GET /v1/finance/pfms/payment-status/:adviceId — treasury advice status enquiry. */
function AdviceStatusLookup({ prefillAdviceId }: { prefillAdviceId: string | null }) {
  const [adviceId, setAdviceId] = useState(prefillAdviceId ?? "");
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AdviceStatusResult | null>(null);
  const idId = useId();
  const errId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    if (!adviceId.trim()) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    try {
      const res = await browserJson<{ data: AdviceStatusResult }>(
        `v1/finance/pfms/payment-status/${encodeURIComponent(adviceId.trim())}`,
        { method: "GET" },
      );
      setResult(res.data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not fetch advice status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Check Payment Advice Status" padding>
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6, flex: "1 1 240px" }}>
            <label htmlFor={idId} style={{ fontSize: 13, fontWeight: 600 }}>
              Advice ID <span aria-hidden="true">*</span>
            </label>
            <input
              id={idId}
              value={adviceId}
              onChange={(e) => setAdviceId(e.target.value)}
              aria-required="true"
              aria-invalid={invalid || undefined}
              aria-describedby={invalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? "Checking…" : "Check Status"}
          </button>
        </div>
        {invalid && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
            Enter an advice ID to look up.
          </p>
        )}
        {error && (
          <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {error}
          </p>
        )}
        {result && (
          <div className="fields">
            <div className="fld"><div className="l">Advice ID</div><div className="v">{result.adviceId}</div></div>
            <div className="fld"><div className="l">Status</div><div className="v">{result.status}</div></div>
            <div className="fld"><div className="l">PFMS Transaction ID</div><div className="v">{result.pfmsTransactionId}</div></div>
            <div className="fld"><div className="l">UTR</div><div className="v">{result.utrNumber}</div></div>
            <div className="fld"><div className="l">Processed At</div><div className="v">{result.processedAt}</div></div>
          </div>
        )}
      </form>
    </Card>
  );
}
