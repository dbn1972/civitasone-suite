"use client";

import { useId, useState } from "react";
import { Card } from "../../../../_components/ds";
import { browserJson } from "@/lib/api/browserClient";
import { formatMoney } from "@/lib/formatters";

type CalcComponent = { code: string; name: string; amountMinor: number; isEmployerCost: boolean };
type CalcResult = { ctcMinor: number; grossMinor: number; employerCostMinor: number; components: CalcComponent[] };

export function CtcCalculatorForm() {
  const [ctc, setCtc] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CalcResult | null>(null);

  const ctcId = useId();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);

    const rupees = parseFloat(ctc);
    if (Number.isNaN(rupees) || rupees <= 0) {
      setError("Enter a valid annual CTC amount in rupees.");
      return;
    }
    const ctcMinor = Math.round(rupees * 100);

    setBusy(true);
    try {
      const res = await browserJson<CalcResult>("v1/payroll/ctc/calculate", {
        method: "POST",
        body: JSON.stringify({ ctcMinor }),
      });
      setResult(res);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Calculation failed. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="CTC Calculator">
      <form onSubmit={handleSubmit} style={{ display: "grid", gap: 14 }}>
        <div style={{ display: "grid", gap: 6, maxWidth: 320 }}>
          <label htmlFor={ctcId} style={{ fontSize: 13, fontWeight: 600 }}>Annual CTC (₹)</label>
          <input
            id={ctcId}
            type="number"
            min="0"
            step="0.01"
            value={ctc}
            onChange={(e) => setCtc(e.target.value)}
            placeholder="e.g. 1200000"
            style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
          />
        </div>

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? "Calculating…" : "Calculate Breakup"}
          </button>
        </div>

        {error && (
          <p role="alert" className="pill bad" style={{ width: "fit-content" }}>
            {error}
          </p>
        )}

        {result && (
          <div style={{ display: "grid", gap: 10 }}>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>Gross Pay</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatMoney(result.grossMinor)}</div>
              </div>
              <div>
                <div style={{ fontSize: 12, color: "var(--ink2)" }}>Employer Cost</div>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{formatMoney(result.employerCostMinor)}</div>
              </div>
            </div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", padding: "6px 8px", fontSize: 13 }}>Component</th>
                  <th style={{ textAlign: "right", padding: "6px 8px", fontSize: 13 }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {result.components.map((c) => (
                  <tr key={c.code}>
                    <td style={{ padding: "6px 8px", fontSize: 13 }}>
                      {c.name}{c.isEmployerCost ? " (employer)" : ""}
                    </td>
                    <td style={{ padding: "6px 8px", fontSize: 13, textAlign: "right" }}>
                      {formatMoney(c.amountMinor)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </form>
    </Card>
  );
}
