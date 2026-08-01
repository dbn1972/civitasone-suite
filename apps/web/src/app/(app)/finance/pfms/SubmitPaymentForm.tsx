"use client";

import { useId, useRef, useState } from "react";
import { Card, ConfirmDialog } from "../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type SubmitResult = {
  referenceId: string;
  pfmsTransactionId: string;
  status: "accepted" | "rejected";
  message?: string;
  timestamp: string;
};

type FieldKey = "referenceId" | "beneficiaryCode" | "amount" | "purposeCode";

/**
 * POST /v1/finance/pfms/payments — submits a payment to PFMS/e-Kuber via the
 * finance-service adapter (services/finance-service/src/modules/pfms/adapter-routes.ts).
 * `amount` is a numeric PAISE string per the backend's submitPaymentBody schema
 * (regex ^\d+$, "amount must be numeric paise string") — not rupees.
 * The adapter fails closed with 503 INTEGRATION_DISABLED when PFMS_ENABLED is
 * not set in this environment; that surfaces as a server error in the dialog.
 */
export function SubmitPaymentForm() {
  const [referenceId, setReferenceId] = useState("");
  const [beneficiaryCode, setBeneficiaryCode] = useState("");
  const [amount, setAmount] = useState("");
  const [purposeCode, setPurposeCode] = useState("");
  const [schemeCode, setSchemeCode] = useState("");
  const [ddoCode, setDdoCode] = useState("");
  const [remarks, setRemarks] = useState("");
  const [invalid, setInvalid] = useState<Partial<Record<FieldKey, boolean>>>({});
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const ids: Record<FieldKey | "scheme" | "ddo" | "remarks", string> = {
    referenceId: useId(),
    beneficiaryCode: useId(),
    amount: useId(),
    purposeCode: useId(),
    scheme: useId(),
    ddo: useId(),
    remarks: useId(),
  };
  const errId = useId();
  const refInput = useRef<HTMLInputElement>(null);
  const beneficiaryInput = useRef<HTMLInputElement>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const purposeInput = useRef<HTMLInputElement>(null);
  const focusRefs: Record<FieldKey, React.RefObject<HTMLInputElement>> = {
    referenceId: refInput,
    beneficiaryCode: beneficiaryInput,
    amount: amountInput,
    purposeCode: purposeInput,
  };

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setResult(null);
    const nextInvalid: Partial<Record<FieldKey, boolean>> = {
      referenceId: !referenceId.trim(),
      beneficiaryCode: !beneficiaryCode.trim(),
      amount: !/^\d+$/.test(amount.trim()),
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
      const res = await browserJson<{ data: SubmitResult }>("v1/finance/pfms/payments", {
        method: "POST",
        body: JSON.stringify({
          referenceId: referenceId.trim(),
          beneficiaryCode: beneficiaryCode.trim(),
          amount: amount.trim(),
          purposeCode: purposeCode.trim(),
          schemeCode: schemeCode.trim() || undefined,
          ddoCode: ddoCode.trim() || undefined,
          remarks: remarks.trim() || undefined,
        }),
      });
      setConfirmOpen(false);
      setResult(res.data);
      setMessage(`Payment ${res.data.referenceId} submitted to PFMS — status: ${res.data.status}.`);
      setReferenceId("");
      setBeneficiaryCode("");
      setAmount("");
      setPurposeCode("");
      setSchemeCode("");
      setDdoCode("");
      setRemarks("");
      setInvalid({});
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card title="Submit Payment to PFMS" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.referenceId} style={{ fontSize: 13, fontWeight: 600 }}>
                Reference ID <span aria-hidden="true">*</span>
              </label>
              <input
                id={ids.referenceId}
                ref={refInput}
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={invalid.referenceId || undefined}
                aria-describedby={invalid.referenceId ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.beneficiaryCode} style={{ fontSize: 13, fontWeight: 600 }}>
                Beneficiary Code <span aria-hidden="true">*</span>
              </label>
              <input
                id={ids.beneficiaryCode}
                ref={beneficiaryInput}
                value={beneficiaryCode}
                onChange={(e) => setBeneficiaryCode(e.target.value)}
                maxLength={64}
                aria-required="true"
                aria-invalid={invalid.beneficiaryCode || undefined}
                aria-describedby={invalid.beneficiaryCode ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.amount} style={{ fontSize: 13, fontWeight: 600 }}>
                Amount, in paise <span aria-hidden="true">*</span>
              </label>
              <input
                id={ids.amount}
                ref={amountInput}
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                inputMode="numeric"
                maxLength={32}
                aria-required="true"
                aria-invalid={invalid.amount || undefined}
                aria-describedby={invalid.amount ? errId : undefined}
                placeholder="e.g. 1500000 for ₹15,000.00"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.purposeCode} style={{ fontSize: 13, fontWeight: 600 }}>
                Purpose Code <span aria-hidden="true">*</span>
              </label>
              <input
                id={ids.purposeCode}
                ref={purposeInput}
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
              <label htmlFor={ids.scheme} style={{ fontSize: 13, fontWeight: 600 }}>Scheme Code</label>
              <input
                id={ids.scheme}
                value={schemeCode}
                onChange={(e) => setSchemeCode(e.target.value)}
                maxLength={32}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={ids.ddo} style={{ fontSize: 13, fontWeight: 600 }}>DDO Code</label>
              <input
                id={ids.ddo}
                value={ddoCode}
                onChange={(e) => setDdoCode(e.target.value)}
                maxLength={32}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={ids.remarks} style={{ fontSize: 13, fontWeight: 600 }}>Remarks</label>
            <input
              id={ids.remarks}
              value={remarks}
              onChange={(e) => setRemarks(e.target.value)}
              maxLength={2000}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>

          {(invalid.referenceId || invalid.beneficiaryCode || invalid.amount || invalid.purposeCode) && (
            <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content" }}>
              Reference ID, beneficiary code, amount (numeric paise), and purpose code are required.
            </p>
          )}

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Submit Payment
            </button>
          </div>

          {message && (
            <p role="status" className="pill good" style={{ width: "fit-content" }}>
              {message}
              {result?.pfmsTransactionId ? ` (PFMS txn ${result.pfmsTransactionId})` : ""}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Submit this payment to PFMS?"
        confirmLabel="Submit payment"
        danger
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit payment <strong>{referenceId}</strong> for beneficiary{" "}
            <strong>{beneficiaryCode}</strong> to PFMS/e-Kuber. This initiates a real payment
            submission and cannot be recalled from this console.
          </>
        }
        onConfirm={() => void submit()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
