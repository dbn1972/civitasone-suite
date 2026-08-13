"use client";

/**
 * Waivers page — raise penalty/interest waivers (maker-checker).
 * Command-only: no list endpoint yet (CQRS pattern, worker handles projection).
 */
import { useId, useState } from "react";
import { PageHeader, Card } from "@/app/_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type FieldErrors = {
  assesseeId?: string;
  demandId?: string;
  waiverType?: string;
  amountMinor?: string;
  reason?: string;
};

export default function WaiversPage() {
  const [assesseeId, setAssesseeId] = useState("");
  const [demandId, setDemandId] = useState("");
  const [waiverType, setWaiverType] = useState("");
  const [amountMinor, setAmountMinor] = useState("");
  const [reason, setReason] = useState("");

  const [errors, setErrors] = useState<FieldErrors>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [apiError, setApiError] = useState<string | null>(null);

  const assesseeId_id = useId();
  const demandId_id = useId();
  const waiverType_id = useId();
  const amountMinor_id = useId();
  const reason_id = useId();

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  function validate(): boolean {
    const next: FieldErrors = {};
    if (!UUID_RE.test(assesseeId.trim())) next.assesseeId = "Enter a valid assessee UUID.";
    if (!UUID_RE.test(demandId.trim())) next.demandId = "Enter a valid demand UUID.";
    if (!waiverType) next.waiverType = "Select a waiver type.";
    if (!amountMinor.trim() || !/^\d+$/.test(amountMinor.trim())) next.amountMinor = "Enter a valid amount in paise (digits only).";
    if (!reason.trim()) next.reason = "Reason is required.";
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setApiError(null);
    if (!validate()) return;
    setBusy(true);
    try {
      await browserJson("v1/revenue/waivers", {
        method: "POST",
        body: JSON.stringify({
          assesseeId: assesseeId.trim(),
          demandId: demandId.trim(),
          waiverType,
          amountMinor: amountMinor.trim(),
          reason: reason.trim(),
        }),
      });
      setMessage("Waiver submitted for checker approval.");
      setAssesseeId(""); setDemandId(""); setWaiverType(""); setAmountMinor(""); setReason("");
      setErrors({});
    } catch (err) {
      setApiError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  const inputStyle = { padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, width: "100%", boxSizing: "border-box" as const };
  const labelStyle = { fontSize: 13, fontWeight: 600 as const };
  const errStyle = { color: "var(--bad)", fontSize: 12, margin: 0 };
  const req = <span aria-hidden="true" style={{ color: "var(--bad)" }}>*</span>;

  return (
    <main className="page-main wrap" aria-labelledby="page-heading">
      <PageHeader
        title="Waivers"
        subtitle="Raise penalty and interest waivers for assessee demands (maker-checker workflow)."
        back="/revenue"
      />

      <form onSubmit={handleSubmit}>
        <Card title="Raise Waiver" padding>
          <div style={{ display: "grid", gap: 14 }}>
            <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))" }}>
              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={assesseeId_id} style={labelStyle}>Assessee ID (UUID) {req}</label>
                <input id={assesseeId_id} value={assesseeId} onChange={(e) => setAssesseeId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  aria-required="true" aria-invalid={!!errors.assesseeId || undefined} style={inputStyle} />
                {errors.assesseeId && <p role="alert" style={errStyle}>{errors.assesseeId}</p>}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={demandId_id} style={labelStyle}>Demand ID (UUID) {req}</label>
                <input id={demandId_id} value={demandId} onChange={(e) => setDemandId(e.target.value)}
                  placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                  aria-required="true" aria-invalid={!!errors.demandId || undefined} style={inputStyle} />
                {errors.demandId && <p role="alert" style={errStyle}>{errors.demandId}</p>}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={waiverType_id} style={labelStyle}>Waiver Type {req}</label>
                <select id={waiverType_id} value={waiverType} onChange={(e) => setWaiverType(e.target.value)}
                  aria-required="true" aria-invalid={!!errors.waiverType || undefined}
                  style={{ ...inputStyle, appearance: "auto" }}>
                  <option value="" disabled>Select…</option>
                  <option value="penalty">Penalty</option>
                  <option value="interest">Interest</option>
                  <option value="both">Both (Penalty + Interest)</option>
                </select>
                {errors.waiverType && <p role="alert" style={errStyle}>{errors.waiverType}</p>}
              </div>

              <div style={{ display: "grid", gap: 6 }}>
                <label htmlFor={amountMinor_id} style={labelStyle}>Amount (paise) {req}</label>
                <input id={amountMinor_id} value={amountMinor} onChange={(e) => setAmountMinor(e.target.value.replace(/\D/g, ""))}
                  inputMode="numeric" placeholder="e.g. 50000 = ₹500"
                  aria-required="true" aria-invalid={!!errors.amountMinor || undefined} style={inputStyle} />
                {errors.amountMinor && <p role="alert" style={errStyle}>{errors.amountMinor}</p>}
              </div>
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label htmlFor={reason_id} style={labelStyle}>Reason {req}</label>
              <textarea id={reason_id} value={reason} onChange={(e) => setReason(e.target.value)}
                maxLength={500} rows={3}
                aria-required="true" aria-invalid={!!errors.reason || undefined}
                style={{ ...inputStyle, minHeight: 80, resize: "vertical" }} />
              {errors.reason && <p role="alert" style={errStyle}>{errors.reason}</p>}
            </div>

            <div>
              <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
                {busy ? "Submitting…" : "Submit Waiver"}
              </button>
            </div>

            {message && <p role="status" className="pill good" style={{ width: "fit-content" }}>{message}</p>}
            {apiError && <p role="alert" className="pill bad" style={{ width: "fit-content" }}>{apiError}</p>}
          </div>
        </Card>
      </form>

      <Card title="About Waivers" padding>
        <p style={{ fontSize: 13, color: "var(--ink2)", margin: 0, lineHeight: 1.6 }}>
          A waiver is a partial remission of penalty or interest — it does not write off the principal demand.
          Submitted waivers require checker approval before they take effect. Use Write-offs for principal
          demand remission.
        </p>
      </Card>
    </main>
  );
}
