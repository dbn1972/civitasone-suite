"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type ReimbursementResponse = {
  data: { id: string; category: string; amount_minor: number | string; status: string };
};

const CATEGORIES = [
  { value: "medical", label: "Medical" },
  { value: "travel", label: "Travel" },
  { value: "lta", label: "LTA" },
  { value: "food", label: "Food" },
  { value: "telephone", label: "Telephone" },
  { value: "internet", label: "Internet" },
  { value: "fuel", label: "Fuel" },
  { value: "other", label: "Other" },
] as const;

export function CreateReimbursementForm() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]["value"]>("medical");
  const [amount, setAmount] = useState("");
  const [period, setPeriod] = useState("");
  const [billDate, setBillDate] = useState("");
  const [billRef, setBillRef] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const empId = useId();
  const catId = useId();
  const amtId = useId();
  const periodId = useId();
  const dateId = useId();
  const refId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const amtRef = useRef<HTMLInputElement>(null);
  const periodRef = useRef<HTMLInputElement>(null);

  const empInvalid = tone === "bad" && message === "Employee ID is required.";
  const amtInvalid = tone === "bad" && !!message && message.startsWith("Amount");
  const periodInvalid = tone === "bad" && !!message && message.startsWith("Period");

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!employeeId.trim()) {
      setTone("bad");
      setMessage("Employee ID is required.");
      empRef.current?.focus();
      return;
    }
    const rupees = parseFloat(amount);
    if (Number.isNaN(rupees) || rupees <= 0) {
      setTone("bad");
      setMessage("Amount must be a positive value in rupees.");
      amtRef.current?.focus();
      return;
    }
    if (!/^\d{4}-\d{2}$/.test(period.trim())) {
      setTone("bad");
      setMessage("Period must be in YYYY-MM format, e.g. 2026-08.");
      periodRef.current?.focus();
      return;
    }
    setDialogError(undefined);
    setConfirmOpen(true);
  }

  async function createReimbursement() {
    setBusy(true);
    setDialogError(undefined);
    try {
      const amountMinor = Math.round(parseFloat(amount) * 100);
      const res = await browserJson<ReimbursementResponse>("v1/payroll/reimbursements", {
        method: "POST",
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          category,
          amountMinor,
          billDate: billDate.trim() || undefined,
          billRef: billRef.trim() || undefined,
          period: period.trim(),
        }),
      });
      setConfirmOpen(false);
      setTone("good");
      setMessage(`Reimbursement claim of ${formatMoney(res.data.amount_minor)} submitted.`);
      setEmployeeId("");
      setAmount("");
      setBillRef("");
      router.refresh();
    } catch (err) {
      setDialogError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Create Reimbursement Claim" padding>
        <div style={{ display: "grid", gap: 14 }}>
          <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600 }}>
                Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={empId}
                ref={empRef}
                value={employeeId}
                onChange={(e) => setEmployeeId(e.target.value)}
                aria-required="true"
                aria-invalid={empInvalid || undefined}
                aria-describedby={empInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={catId} style={{ fontSize: 13, fontWeight: 600 }}>Category</label>
              <select
                id={catId}
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, background: "#fff" }}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={amtId} style={{ fontSize: 13, fontWeight: 600 }}>
                Amount (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={amtId}
                ref={amtRef}
                type="number"
                min="0"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                aria-required="true"
                aria-invalid={amtInvalid || undefined}
                aria-describedby={amtInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={periodId} style={{ fontSize: 13, fontWeight: 600 }}>
                Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
              </label>
              <input
                id={periodId}
                ref={periodRef}
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
                placeholder="2026-08"
                aria-required="true"
                aria-invalid={periodInvalid || undefined}
                aria-describedby={periodInvalid ? errId : undefined}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={dateId} style={{ fontSize: 13, fontWeight: 600 }}>Bill Date</label>
              <input
                id={dateId}
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={refId} style={{ fontSize: 13, fontWeight: 600 }}>Bill Reference</label>
              <input
                id={refId}
                value={billRef}
                onChange={(e) => setBillRef(e.target.value)}
                maxLength={128}
                style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
              />
            </div>
          </div>

          <div>
            <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
              Submit Claim
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
        title="Submit this reimbursement claim?"
        confirmLabel="Submit claim"
        busy={busy}
        errorMessage={dialogError}
        description={
          <>
            Submit a {category} claim of {formatMoney(Math.round((parseFloat(amount) || 0) * 100))} for employee{" "}
            <strong>{employeeId}</strong>, period {period}.
          </>
        }
        onConfirm={() => void createReimbursement()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
