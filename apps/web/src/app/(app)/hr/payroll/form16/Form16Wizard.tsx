"use client";

import { useId, useState } from "react";

const STEPS = ["Select FY", "Review Deductions", "Generate & Download"] as const;

const DEDUCTIONS = [
  { section: "12B", label: "Employer Contribution (12B)" },
  { section: "80C", label: "80C — PF, PPF, LIC, ELSS, NSC" },
  { section: "80D", label: "80D — Health Insurance" },
  { section: "80E", label: "80E — Education Loan Interest" },
  { section: "80G", label: "80G — Charitable Donations" },
  { section: "24B", label: "24(b) — Home Loan Interest" },
  { section: "10HRA", label: "HRA Exemption" },
];

function StepBar({ step }: { step: number }) {
  return (
    <nav aria-label="Form 16 wizard steps" style={{ display: "flex", marginBottom: 28 }}>
      {STEPS.map((label, i) => {
        const done = i < step;
        const active = i === step;
        return (
          <div key={label} style={{ flex: 1, display: "flex", alignItems: "center" }}>
            <div style={{ flex: "none", display: "flex", flexDirection: "column", alignItems: "center" }}>
              <div
                style={{
                  width: 28, height: 28, borderRadius: "50%",
                  background: done ? "var(--good, #27ae60)" : active ? "var(--accent, #2563eb)" : "var(--line2)",
                  color: done || active ? "#fff" : "var(--ink2)",
                  display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 12, fontWeight: 700,
                }}
                aria-current={active ? "step" : undefined}
              >
                {done ? "✓" : i + 1}
              </div>
              <span style={{ fontSize: 11, marginTop: 4, color: active ? "var(--accent, #2563eb)" : "var(--ink2)", whiteSpace: "nowrap" }}>
                {label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ flex: 1, height: 2, background: done ? "var(--good, #27ae60)" : "var(--line2)", margin: "0 6px", marginBottom: 20 }} />
            )}
          </div>
        );
      })}
    </nav>
  );
}

function TdsReconciliationTable({ fy }: { fy: string }) {
  const QUARTERS = ["Q1 (Apr–Jun)", "Q2 (Jul–Sep)", "Q3 (Oct–Dec)", "Q4 (Jan–Mar)"];
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: "2px solid var(--line2)" }}>
            {["Quarter", "Gross Salary", "TDS Deducted", "Challan Ref"].map((h) => (
              <th key={h} style={{ padding: "8px 10px", textAlign: "left", fontWeight: 600, color: "var(--ink2)" }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {QUARTERS.map((q, i) => (
            <tr key={q} style={{ borderBottom: "1px solid var(--line2)" }}>
              <td style={{ padding: "8px 10px" }}>{q}</td>
              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", textAlign: "right", color: "var(--ink2)" }}>—</td>
              <td style={{ padding: "8px 10px", fontFamily: "monospace", fontSize: 12, color: "var(--ink2)" }}>
                CHLN-FY{fy.replace("-", "")}-Q{i + 1}
              </td>
            </tr>
          ))}
          <tr style={{ borderTop: "2px solid var(--line2)", background: "var(--panel)" }}>
            <td style={{ padding: "8px 10px", fontWeight: 700 }}>Annual Total</td>
            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 700 }}>—</td>
            <td style={{ padding: "8px 10px" }} />
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export function Form16Wizard({ defaultFy }: { defaultFy: string }) {
  const [step, setStep] = useState(0);
  const [fy, setFy] = useState(defaultFy);
  const [employeeId, setEmployeeId] = useState("");
  const [deductionVals, setDeductionVals] = useState<Record<string, string>>(
    Object.fromEntries(DEDUCTIONS.map((d) => [d.section, ""])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [jobId, setJobId] = useState<string | null>(null);

  const fyId = useId();
  const empId = useId();

  async function generateForm16() {
    setBusy(true);
    setError(undefined);
    try {
      const body: Record<string, unknown> = { fy };
      if (employeeId.trim()) body.employeeIds = [employeeId.trim()];
      const res = await fetch("/api/proxy/v1/payroll/tax/form16/bulk-generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: { message?: string } };
        setError(d?.error?.message ?? "Generation failed.");
        return;
      }
      const d = await res.json().catch(() => ({})) as { data?: { jobId?: string } };
      setJobId(d?.data?.jobId ?? null);
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ padding: "20px 24px" }}>
      <StepBar step={step} />

      {/* Step 0 — Select FY */}
      {step === 0 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14, maxWidth: 500 }}>
            <div>
              <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>Financial Year</label>
              <input id={fyId} type="text" className="input" value={fy} onChange={(e) => setFy(e.target.value)} placeholder="2024-25" />
              <p style={{ fontSize: 11, color: "var(--ink2)", marginTop: 4 }}>Format: YYYY-YY (e.g. 2024-25)</p>
            </div>
            <div>
              <label htmlFor={empId} style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                Employee ID <span style={{ color: "var(--ink2)", fontWeight: 400 }}>(optional)</span>
              </label>
              <input id={empId} type="text" className="input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} placeholder="EMP001 — blank = all" />
            </div>
          </div>
          <div>
            <button type="button" className="btn" onClick={() => setStep(1)}>Next: Review Deductions →</button>
          </div>
        </div>
      )}

      {/* Step 1 — Review deductions + TDS reconciliation */}
      {step === 1 && (
        <div style={{ display: "grid", gap: 22 }}>
          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>Deduction Figures — FY {fy}</h3>
            <div style={{ display: "grid", gap: 8, maxWidth: 540 }}>
              {DEDUCTIONS.map((d) => (
                <div key={d.section} style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 12, alignItems: "center" }}>
                  <label style={{ fontSize: 13, color: "var(--ink2)" }}>{d.label}</label>
                  <input
                    type="number"
                    className="input"
                    style={{ width: 160, textAlign: "right" }}
                    value={deductionVals[d.section] ?? ""}
                    onChange={(e) => setDeductionVals((prev) => ({ ...prev, [d.section]: e.target.value }))}
                    placeholder="0.00"
                    min="0"
                  />
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 6 }}>Annual TDS Reconciliation — FY {fy}</h3>
            <p style={{ fontSize: 12, color: "var(--ink2)", marginBottom: 10 }}>Challan references from submitted 24Q returns. Amounts load after generation.</p>
            <TdsReconciliationTable fy={fy} />
          </div>

          {error && <p role="alert" style={{ color: "var(--bad, #c0392b)", fontSize: 13 }}>{error}</p>}
          <div style={{ display: "flex", gap: 10 }}>
            <button type="button" className="btn ghost" onClick={() => setStep(0)}>← Back</button>
            <button type="button" className="btn" onClick={() => void generateForm16()} disabled={busy}>
              {busy ? "Generating…" : "Generate Form 16 →"}
            </button>
          </div>
        </div>
      )}

      {/* Step 2 — Download */}
      {step === 2 && (
        <div style={{ display: "grid", gap: 16 }}>
          <div style={{ background: "var(--goodbg, #e6f7f0)", borderRadius: 12, padding: "28px", textAlign: "center" }}>
            <p style={{ fontSize: 36, margin: "0 0 10px" }}>✅</p>
            <p style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Form-16 generation started</p>
            {jobId && <p style={{ fontSize: 13, fontFamily: "monospace", color: "var(--ink2)" }}>Job ID: {jobId}</p>}
            <p style={{ fontSize: 13, color: "var(--ink2)", marginTop: 8 }}>
              Generation runs asynchronously. Download will be available once complete.
            </p>
            <div style={{ marginTop: 16, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
              <a className="btn" href={`/api/proxy/v1/payroll/tax/form16/bulk-download?fy=${encodeURIComponent(fy)}`}>
                ⬇ Download Form 16 ZIP
              </a>
              <button type="button" className="btn ghost" onClick={() => { setStep(0); setJobId(null); setError(undefined); }}>
                Generate another
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
