"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

export function IngestChallanForm({ period }: { period: string }) {
  const router = useRouter();
  const [challanPeriod, setChallanPeriod] = useState(period);
  const [bsrCode, setBsrCode] = useState("");
  const [challanSerial, setChallanSerial] = useState("");
  const [depositDate, setDepositDate] = useState("");
  const [formType, setFormType] = useState<"24Q" | "26Q">("24Q");
  const [tdsAmount, setTdsAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const periodId = useId();
  const bsrId = useId();
  const serialId = useId();
  const dateId = useId();
  const formTypeId = useId();
  const amtId = useId();
  const errId = useId();
  const bsrRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const bsrInvalid = tone === "bad" && !!message && message.startsWith("BSR");
  const amtInvalid = tone === "bad" && !!message && message.startsWith("TDS amount");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!/^\d{7}$/.test(bsrCode)) {
      setTone("bad");
      setMessage("BSR code must be a 7-digit RBI code.");
      bsrRef.current?.focus();
      return;
    }
    const amt = parseFloat(tdsAmount);
    if (Number.isNaN(amt) || amt < 0) {
      setTone("bad");
      setMessage("TDS amount must be a valid rupee amount.");
      amtRef.current?.focus();
      return;
    }
    if (!challanSerial.trim() || !depositDate) {
      setTone("bad");
      setMessage("Challan serial and deposit date are required.");
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function ingestChallan() {
    setBusy(true);
    setDialogError(undefined);
    try {
      await browserJson("v1/payroll/statutory/challans", {
        method: "POST",
        body: JSON.stringify({
          period: challanPeriod,
          bsrCode,
          challanSerial: challanSerial.trim(),
          depositDate,
          formType,
          tdsAmount: parseFloat(tdsAmount),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Challan ingested for ${challanPeriod}.`);
      setBsrCode(""); setChallanSerial(""); setDepositDate(""); setTdsAmount("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Ingest TDS Challan" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                type="month"
                value={challanPeriod}
                onChange={(e) => setChallanPeriod(e.target.value)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={bsrId} style={{ fontSize: 13, fontWeight: 600 }}>
                BSR Code <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={bsrId}
                ref={bsrRef}
                value={bsrCode}
                onChange={(e) => setBsrCode(e.target.value)}
                maxLength={7}
                aria-required="true"
                aria-invalid={bsrInvalid || undefined}
                aria-describedby={bsrInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={serialId} style={{ fontSize: 13, fontWeight: 600 }}>
                Challan Serial <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={serialId}
                value={challanSerial}
                onChange={(e) => setChallanSerial(e.target.value)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>
                Deposit Date <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={dateId}
                type="date"
                value={depositDate}
                onChange={(e) => setDepositDate(e.target.value)}
                aria-required="true"
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={formTypeId} style={{ fontSize: 13, fontWeight: 600 }}>Form Type</label>
              <select
                id={formTypeId}
                value={formType}
                onChange={(e) => setFormType(e.target.value as "24Q" | "26Q")}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                <option value="24Q">24Q (Salary)</option>
                <option value="26Q">26Q (Non-salary)</option>
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                TDS Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number" min="0" step="0.01"
                value={tdsAmount}
                onChange={(e) => setTdsAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Ingest Challan
            </button>
          </div>

          {message && (
            <p
              id={errId}
              role={tone === "bad" ? "alert" : "status"}
              aria-live={tone === "bad" ? "assertive" : "polite"}
              className={`pill ${tone}`}
              style={{ width: "fit-content" }}
            >
              {message}
            </p>
          )}
        </div>
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Ingest this TDS challan?"
        confirmLabel="Confirm & Ingest"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Ingest {formType} challan for period <strong>{challanPeriod}</strong>: BSR {bsrCode}, serial {challanSerial},
            TDS ₹{tdsAmount || 0} deposited on {depositDate || "—"}.
          </>
        }
        onConfirm={() => void ingestChallan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
