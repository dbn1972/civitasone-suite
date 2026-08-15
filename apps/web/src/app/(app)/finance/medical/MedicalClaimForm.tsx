"use client";

import { useId, useState } from "react";
import type { CSSProperties } from "react";
import { useRouter } from "next/navigation";

/**
 * MedicalClaimForm — CGHS / CS(MA) Rules 1944 reimbursement claim form.
 * Captures: date of treatment, hospital name, diagnosis, amount,
 * indoor/outdoor type, CGHS ward entitlement, and referral status.
 */

const CGHS_WARDS = [
  "Private",
  "Semi-Private",
  "General",
] as const;
type CghsWard = (typeof CGHS_WARDS)[number];

const CLAIM_TYPES = ["Indoor", "Outdoor"] as const;
type ClaimType = (typeof CLAIM_TYPES)[number];

const REFERRAL_STATUSES = [
  "Not Required",
  "Referred — CGHS Approved",
  "Emergency (No Referral Needed)",
  "Referred — Pending Approval",
] as const;
type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

const inputBase: CSSProperties = {
  width: "100%",
  padding: "8px 12px",
  border: "1px solid var(--line)",
  borderRadius: 8,
  background: "var(--bg2)",
  color: "var(--ink)",
  fontSize: 14,
  boxSizing: "border-box",
};
const inputErr: CSSProperties = { ...inputBase, border: "1px solid #ef4444" };
const fieldErr: CSSProperties = { color: "#b91c1c", fontSize: 12, marginTop: 3 };
const labelStyle: CSSProperties = { fontSize: 13, fontWeight: 500, display: "block", marginBottom: 4 };
const req = <span aria-hidden="true" style={{ color: "#ef4444" }}>*</span>;

export function MedicalClaimForm() {
  const router = useRouter();
  const ids = {
    employeeId: useId(),
    treatmentDate: useId(),
    hospital: useId(),
    diagnosis: useId(),
    claimType: useId(),
    amount: useId(),
    cghsWard: useId(),
    referralStatus: useId(),
    remarks: useId(),
  };

  const [employeeId, setEmployeeId] = useState("");
  const [treatmentDate, setTreatmentDate] = useState("");
  const [hospital, setHospital] = useState("");
  const [diagnosis, setDiagnosis] = useState("");
  const [claimType, setClaimType] = useState<ClaimType>("Outdoor");
  const [amount, setAmount] = useState("");
  const [cghsWard, setCghsWard] = useState<CghsWard>("General");
  const [referralStatus, setReferralStatus] = useState<ReferralStatus>("Not Required");
  const [remarks, setRemarks] = useState("");
  const [errs, setErrs] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  function clearErr(f: string) {
    setErrs((s) => { const n = new Set(s); n.delete(f); return n; });
  }

  function validate() {
    const e = new Set<string>();
    if (!employeeId.trim()) e.add("employeeId");
    if (!treatmentDate) e.add("treatmentDate");
    if (!hospital.trim() || hospital.trim().length < 3) e.add("hospital");
    if (!diagnosis.trim() || diagnosis.trim().length < 3) e.add("diagnosis");
    const amt = Number(amount);
    if (!amount || isNaN(amt) || amt <= 0) e.add("amount");
    setErrs(e);
    return e.size === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch("/api/proxy/v1/finance/medical-claims", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          employeeId: employeeId.trim(),
          treatmentDate,
          hospital: hospital.trim(),
          diagnosis: diagnosis.trim(),
          claimType,
          amountMinor: Math.round(Number(amount) * 100),
          cghsWard,
          referralStatus,
          remarks: remarks.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { message?: string };
        setMessage({ tone: "bad", text: body.message ?? `Failed (${res.status})` });
        return;
      }
      setMessage({ tone: "good", text: "Medical reimbursement claim submitted." });
      setEmployeeId(""); setTreatmentDate(""); setHospital(""); setDiagnosis("");
      setAmount(""); setRemarks("");
      router.refresh();
    } catch (err) {
      setMessage({ tone: "bad", text: err instanceof Error ? err.message : "Network error." });
    } finally {
      setBusy(false);
    }
  }

  function handleCancel() {
    setEmployeeId(""); setTreatmentDate(""); setHospital(""); setDiagnosis("");
    setClaimType("Outdoor"); setAmount(""); setCghsWard("General");
    setReferralStatus("Not Required"); setRemarks(""); setErrs(new Set()); setMessage(null);
  }

  return (
    <div className="card">
      <div className="card-h" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h3>New Medical Reimbursement Claim</h3>
      </div>

      <p role="note" style={{ margin: "0 20px 12px", fontSize: 13, color: "var(--mut)" }}>
        CGHS / CS(MA) Rules 1944 — claim reimbursement for CGHS-empanelled or emergency hospital treatment.
        CGHS ward entitlement is determined by pay level; higher wards require referral.
      </p>

      {message && (
        <p role="alert" className={`pill ${message.tone}`} style={{ margin: "0 20px 8px" }}>
          {message.text}
        </p>
      )}

      <form onSubmit={handleSubmit} noValidate style={{ padding: "0 20px 24px", display: "grid", gap: 16 }}>
        {/* Employee + Date */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
          <div>
            <label htmlFor={ids.employeeId} style={labelStyle}>Employee ID {req}</label>
            <input
              id={ids.employeeId}
              type="text"
              value={employeeId}
              onChange={(e) => { setEmployeeId(e.target.value); clearErr("employeeId"); }}
              placeholder="e.g. EMP00123"
              style={errs.has("employeeId") ? inputErr : inputBase}
              aria-invalid={errs.has("employeeId")}
            />
            {errs.has("employeeId") && <p role="alert" style={fieldErr}>Enter employee ID.</p>}
          </div>
          <div>
            <label htmlFor={ids.treatmentDate} style={labelStyle}>Date of Treatment {req}</label>
            <input
              id={ids.treatmentDate}
              type="date"
              value={treatmentDate}
              onChange={(e) => { setTreatmentDate(e.target.value); clearErr("treatmentDate"); }}
              style={errs.has("treatmentDate") ? inputErr : inputBase}
              aria-invalid={errs.has("treatmentDate")}
            />
            {errs.has("treatmentDate") && <p role="alert" style={fieldErr}>Select date of treatment.</p>}
          </div>
        </div>

        {/* Hospital */}
        <div>
          <label htmlFor={ids.hospital} style={labelStyle}>Hospital / Clinic Name {req}</label>
          <input
            id={ids.hospital}
            type="text"
            value={hospital}
            onChange={(e) => { setHospital(e.target.value); clearErr("hospital"); }}
            placeholder="Name of CGHS-empanelled or approved hospital"
            style={errs.has("hospital") ? inputErr : inputBase}
            aria-invalid={errs.has("hospital")}
          />
          {errs.has("hospital") && <p role="alert" style={fieldErr}>Enter hospital name (min 3 chars).</p>}
        </div>

        {/* Diagnosis */}
        <div>
          <label htmlFor={ids.diagnosis} style={labelStyle}>Diagnosis / Ailment {req}</label>
          <input
            id={ids.diagnosis}
            type="text"
            value={diagnosis}
            onChange={(e) => { setDiagnosis(e.target.value); clearErr("diagnosis"); }}
            placeholder="e.g. Acute gastritis, Hypertension management"
            style={errs.has("diagnosis") ? inputErr : inputBase}
            aria-invalid={errs.has("diagnosis")}
          />
          {errs.has("diagnosis") && <p role="alert" style={fieldErr}>Enter diagnosis (min 3 chars).</p>}
        </div>

        {/* Claim Type + Amount + CGHS Ward */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
          <div>
            <label htmlFor={ids.claimType} style={labelStyle}>Claim Type</label>
            <select
              id={ids.claimType}
              value={claimType}
              onChange={(e) => setClaimType(e.target.value as ClaimType)}
              style={inputBase}
            >
              {CLAIM_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor={ids.amount} style={labelStyle}>Amount (₹) {req}</label>
            <input
              id={ids.amount}
              type="number"
              min={1}
              step={1}
              value={amount}
              onChange={(e) => { setAmount(e.target.value); clearErr("amount"); }}
              placeholder="e.g. 12500"
              style={errs.has("amount") ? inputErr : inputBase}
              aria-invalid={errs.has("amount")}
            />
            {errs.has("amount") && <p role="alert" style={fieldErr}>Enter a valid amount.</p>}
          </div>
          <div>
            <label htmlFor={ids.cghsWard} style={labelStyle}>CGHS Ward Entitlement</label>
            <select
              id={ids.cghsWard}
              value={cghsWard}
              onChange={(e) => setCghsWard(e.target.value as CghsWard)}
              style={inputBase}
            >
              {CGHS_WARDS.map((w) => <option key={w} value={w}>{w}</option>)}
            </select>
          </div>
        </div>

        {/* Referral Status */}
        <div>
          <label htmlFor={ids.referralStatus} style={labelStyle}>Referral Status</label>
          <select
            id={ids.referralStatus}
            value={referralStatus}
            onChange={(e) => setReferralStatus(e.target.value as ReferralStatus)}
            style={inputBase}
          >
            {REFERRAL_STATUSES.map((r) => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>

        {/* Remarks */}
        <div>
          <label htmlFor={ids.remarks} style={labelStyle}>Remarks</label>
          <textarea
            id={ids.remarks}
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder="Additional details (optional)"
            rows={2}
            style={inputBase}
          />
        </div>

        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
          <button type="button" className="btn ghost" onClick={handleCancel} style={{ minHeight: 44 }}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy} style={{ minHeight: 44, minWidth: 200 }}>
            {busy ? "Submitting…" : "Submit Claim"}
          </button>
        </div>
      </form>
    </div>
  );
}
