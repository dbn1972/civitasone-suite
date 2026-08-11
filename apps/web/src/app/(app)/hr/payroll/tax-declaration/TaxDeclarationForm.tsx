"use client";

import { useEffect, useId, useState } from "react";

/** Determine the current Indian financial year (Apr-Mar). */
function currentFy(): string {
  const now = new Date();
  const month = now.getMonth() + 1; // 1-12
  const year = month >= 4 ? now.getFullYear() : now.getFullYear() - 1;
  const suffix = String((year + 1) % 100).padStart(2, "0");
  return `${year}-${suffix}`;
}

/** Convert INR (rupees) input to paise. */
function toPaise(inr: string): number {
  const n = parseFloat(inr);
  return isNaN(n) ? 0 : Math.round(n * 100);
}

/** Convert paise to INR string for display. */
function toInr(paise: number): string {
  if (!paise) return "";
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function TaxDeclarationForm() {
  const fy = currentFy();

  const [regime, setRegime] = useState<"old" | "new">("new");
  const [section80c, setSection80c] = useState("");
  const [section80d, setSection80d] = useState("");
  const [otherDeductions, setOtherDeductions] = useState("");
  const [rentPaid, setRentPaid] = useState("");
  const [prevEmployerSalary, setPrevEmployerSalary] = useState("");
  const [otherSourcesIncome, setOtherSourcesIncome] = useState("");
  const [perquisites, setPerquisites] = useState("");

  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [tone, setTone] = useState<"good" | "bad">("good");

  const regimeNewId = useId();
  const regimeOldId = useId();
  const s80cId = useId();
  const s80dId = useId();
  const otherId = useId();
  const rentId = useId();
  const prevSalId = useId();
  const otherIncId = useId();
  const perqId = useId();

  // Fetch existing declaration on load
  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(`/api/proxy/v1/payroll/tax-declarations?fy=${fy}`);
        if (res.ok) {
          const data = await res.json();
          if (data) {
            setRegime(data.regime === "old" ? "old" : "new");
            setSection80c(toInr(data.section80c));
            setSection80d(toInr(data.section80d));
            setOtherDeductions(toInr(data.otherDeductions));
            setRentPaid(toInr(data.rentPaidMinor));
            setPrevEmployerSalary(toInr(data.prevEmployerSalaryMinor));
            setOtherSourcesIncome(toInr(data.otherSourcesIncomeMinor));
            setPerquisites(toInr(data.perquisitesMinor));
          }
        }
      } catch {
        setLoadFailed(true);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [fy]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    setBusy(true);

    try {
      const res = await fetch("/api/proxy/v1/payroll/tax-declarations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fy,
          regime,
          section80c: toPaise(section80c),
          section80d: toPaise(section80d),
          otherDeductions: toPaise(otherDeductions),
          rentPaidMinor: toPaise(rentPaid),
          prevEmployerSalaryMinor: toPaise(prevEmployerSalary) || undefined,
          otherSourcesIncomeMinor: toPaise(otherSourcesIncome) || undefined,
          perquisitesMinor: toPaise(perquisites) || undefined,
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        setTone("bad");
        setMessage(text || `Submission failed (${res.status})`);
        return;
      }
      setTone("good");
      setMessage("Declaration submitted successfully.");
    } catch (err) {
      setTone("bad");
      setMessage(err instanceof Error ? err.message : "Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="card">
        <div className="pad" style={{ textAlign: "center", padding: 32 }}>
          Loading declaration…
        </div>
      </div>
    );
  }

  return (
    <>
    {loadFailed && (
      <div role="alert" style={{ background: "#3d1c1c", border: "1px solid #f85149",
        borderRadius: 6, padding: "10px 14px", marginBottom: 16,
        color: "#f85149", fontSize: 13, lineHeight: 1.4 }}>
        ⚠ Could not load your existing declaration — blank amounts will overwrite previous values if you save.
        Refresh the page to retry.
      </div>
    )}
    <form onSubmit={handleSubmit} className="card" style={{ marginBottom: 16 }}>
      <div className="card-h">
        <h3>FY {fy} — Income Tax Declaration</h3>
      </div>
      <div className="pad" style={{ display: "grid", gap: 16 }}>
        {/* Regime Selection */}
        <fieldset style={{ border: "none", padding: 0, margin: 0 }}>
          <legend style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Tax Regime</legend>
          <div style={{ display: "flex", gap: 24 }}>
            <label htmlFor={regimeNewId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                id={regimeNewId}
                type="radio"
                name="regime"
                value="new"
                checked={regime === "new"}
                onChange={() => setRegime("new")}
                style={{ width: 18, height: 18 }}
              />
              New Regime
            </label>
            <label htmlFor={regimeOldId} style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer" }}>
              <input
                id={regimeOldId}
                type="radio"
                name="regime"
                value="old"
                checked={regime === "old"}
                onChange={() => setRegime("old")}
                style={{ width: 18, height: 18 }}
              />
              Old Regime
            </label>
          </div>
        </fieldset>

        {/* Amount fields */}
        <div style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={s80cId} style={{ fontSize: 13, fontWeight: 600 }}>Section 80C (₹)</label>
            <input
              id={s80cId}
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 150000"
              value={section80c}
              onChange={(e) => setSection80c(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={s80dId} style={{ fontSize: 13, fontWeight: 600 }}>Section 80D (₹)</label>
            <input
              id={s80dId}
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 25000"
              value={section80d}
              onChange={(e) => setSection80d(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={otherId} style={{ fontSize: 13, fontWeight: 600 }}>Other Deductions (₹)</label>
            <input
              id={otherId}
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 50000"
              value={otherDeductions}
              onChange={(e) => setOtherDeductions(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={rentId} style={{ fontSize: 13, fontWeight: 600 }}>Rent Paid Annually (₹)</label>
            <input
              id={rentId}
              type="number"
              min="0"
              step="1"
              placeholder="e.g. 120000"
              value={rentPaid}
              onChange={(e) => setRentPaid(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={prevSalId} style={{ fontSize: 13, fontWeight: 600 }}>Previous Employer Salary (₹)</label>
            <input
              id={prevSalId}
              type="number"
              min="0"
              step="1"
              placeholder="Optional"
              value={prevEmployerSalary}
              onChange={(e) => setPrevEmployerSalary(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={otherIncId} style={{ fontSize: 13, fontWeight: 600 }}>Other Sources Income (₹)</label>
            <input
              id={otherIncId}
              type="number"
              min="0"
              step="1"
              placeholder="Optional"
              value={otherSourcesIncome}
              onChange={(e) => setOtherSourcesIncome(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={perqId} style={{ fontSize: 13, fontWeight: 600 }}>Perquisites (₹)</label>
            <input
              id={perqId}
              type="number"
              min="0"
              step="1"
              placeholder="Optional"
              value={perquisites}
              onChange={(e) => setPerquisites(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
        </div>

        <div>
          <button type="submit" className="btn primary" style={{ minHeight: 44 }} disabled={busy}>
            {busy ? "Submitting…" : "Submit Declaration"}
          </button>
        </div>

        {message && (
          <p role="status" aria-live="polite" className={`pill ${tone}`} style={{ width: "fit-content" }}>
            {message}
          </p>
        )}

        <p style={{ fontSize: 12, color: "var(--ink2)" }}>
          All amounts are in INR. The system converts to paise internally. Submitting updates any existing declaration for FY {fy}.
        </p>
      </div>
    </form>
    </>
  );
}
