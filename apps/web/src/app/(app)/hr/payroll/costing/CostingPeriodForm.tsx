"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export function CostingPeriodForm({ initialPeriod }: { initialPeriod: string }) {
  const router = useRouter();
  const [period, setPeriod] = useState(initialPeriod);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(period.trim())) {
      setError("Enter a period in YYYY-MM format.");
      return;
    }
    setError(null);
    router.push(`/hr/payroll/costing?period=${encodeURIComponent(period.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap", marginBottom: 14 }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={fieldId} style={{ fontSize: 13, fontWeight: 600 }}>
          Period (YYYY-MM) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={fieldId}
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="2026-08"
          aria-required="true"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-err` : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
      </div>
      <button type="submit" className="btn primary" style={{ minHeight: 44 }}>
        View Report
      </button>
      {error && (
        <p id={`${fieldId}-err`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {error}
        </p>
      )}
    </form>
  );
}
