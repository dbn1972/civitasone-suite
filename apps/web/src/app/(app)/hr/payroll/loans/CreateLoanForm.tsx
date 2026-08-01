"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, ConfirmDialog } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";

type AcceptedResponse = { id: string; status: string; correlationId?: string };

export function CreateLoanForm() {
  const router = useRouter();
  const [loanNo, setLoanNo] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [loanType, setLoanType] = useState("personal");
  const [principalRupees, setPrincipalRupees] = useState("");
  const [emiRupees, setEmiRupees] = useState("");
  const [tenureMonths, setTenureMonths] = useState("");
  const [interestRatePct, setInterestRatePct] = useState("0");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [message, setMessage] = useState<string | null>(null);

  const loanNoField = useId();
  const empIdField = useId();
  const typeField = useId();
  const principalField = useId();
  const emiField = useId();
  const tenureField = useId();
  const rateField = useId();

  function openConfirm(e: React.FormEvent) {
    e.preventDefault();
    setError(undefined);
    setMessage(null);
    if (!loanNo.trim() || !employeeId.trim() || !principalRupees || !emiRupees || !tenureMonths) {
      setError("Loan number, employee, principal, EMI and tenure are required.");
      return;
    }
    setConfirmOpen(true);
  }

  async function createLoan() {
    setBusy(true);
    setError(undefined);
    try {
      const res = await browserJson<AcceptedResponse>("v1/payroll/loans", {
        method: "POST",
        body: JSON.stringify({
          loanNo: loanNo.trim(),
          employeeId: employeeId.trim(),
          loanType,
          principalMinor: Math.round(Number(principalRupees) * 100),
          emiMinor: Math.round(Number(emiRupees) * 100),
          tenureMonths: Number(tenureMonths),
          interestRatePct: Number(interestRatePct || "0"),
          currency: "INR",
        }),
      });
      setConfirmOpen(false);
      setMessage(`Loan ${loanNo} submitted (id ${res.id}). It is processed asynchronously.`);
      setLoanNo("");
      setEmployeeId("");
      setPrincipalRupees("");
      setEmiRupees("");
      setTenureMonths("");
      setInterestRatePct("0");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={openConfirm} style={{ marginBottom: 16 }}>
      <Card title="Create Loan" padding>
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={loanNoField} style={{ fontSize: 13, fontWeight: 600 }}>
              Loan No. <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={loanNoField} value={loanNo} onChange={(e) => setLoanNo(e.target.value)} maxLength={64} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdField} style={{ fontSize: 13, fontWeight: 600 }}>
              Employee ID (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={empIdField} value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={typeField} style={{ fontSize: 13, fontWeight: 600 }}>Loan Type</label>
            <select id={typeField} value={loanType} onChange={(e) => setLoanType(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}>
              <option value="personal">Personal</option>
              <option value="vehicle">Vehicle</option>
              <option value="house_building">House Building</option>
              <option value="festival">Festival Advance</option>
            </select>
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={principalField} style={{ fontSize: 13, fontWeight: 600 }}>
              Principal (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={principalField} type="number" min={0} step="0.01" value={principalRupees} onChange={(e) => setPrincipalRupees(e.target.value)} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={emiField} style={{ fontSize: 13, fontWeight: 600 }}>
              EMI (₹) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={emiField} type="number" min={0} step="0.01" value={emiRupees} onChange={(e) => setEmiRupees(e.target.value)} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={tenureField} style={{ fontSize: 13, fontWeight: 600 }}>
              Tenure (months) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input id={tenureField} type="number" min={1} value={tenureMonths} onChange={(e) => setTenureMonths(e.target.value)} aria-required="true" style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={rateField} style={{ fontSize: 13, fontWeight: 600 }}>Interest Rate (%)</label>
            <input id={rateField} type="number" min={0} step="0.01" value={interestRatePct} onChange={(e) => setInterestRatePct(e.target.value)} style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }} />
          </div>
        </div>
        <div style={{ marginTop: 14 }}>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            Create Loan
          </button>
        </div>
        {error && !confirmOpen && (
          <p role="alert" className="pill bad" style={{ marginTop: 10, width: "fit-content" }}>{error}</p>
        )}
        {message && (
          <p role="status" aria-live="polite" className="pill good" style={{ marginTop: 10, width: "fit-content" }}>{message}</p>
        )}
      </Card>

      <ConfirmDialog
        open={confirmOpen}
        title="Create this loan?"
        confirmLabel="Create loan"
        busy={busy}
        errorMessage={error}
        description={
          <>
            Create loan <strong>{loanNo}</strong> for employee <strong>{employeeId}</strong> with principal ₹{principalRupees}, EMI ₹{emiRupees} over {tenureMonths} month(s).
          </>
        }
        onConfirm={() => void createLoan()}
        onCancel={() => !busy && setConfirmOpen(false)}
      />
    </form>
  );
}
