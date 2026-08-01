"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

export function LoanSearchForm({ initialEmpId }: { initialEmpId: string }) {
  const router = useRouter();
  const [empId, setEmpId] = useState(initialEmpId);
  const [error, setError] = useState<string | null>(null);
  const fieldId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId.trim()) {
      setError("Enter an employee ID to search.");
      return;
    }
    setError(null);
    router.push(`/hr/payroll/loans?empId=${encodeURIComponent(empId.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", gap: 10, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6, flex: 1, minWidth: 240 }}>
        <label htmlFor={fieldId} style={{ fontSize: 13, fontWeight: 600 }}>
          Employee ID (UUID) <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
        </label>
        <input
          id={fieldId}
          value={empId}
          onChange={(e) => setEmpId(e.target.value)}
          aria-required="true"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? `${fieldId}-err` : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
        />
      </div>
      <button type="submit" className="btn primary" style={{ minHeight: 44 }}>
        Search
      </button>
      {error && (
        <p id={`${fieldId}-err`} role="alert" className="pill bad" style={{ width: "fit-content" }}>
          {error}
        </p>
      )}
    </form>
  );
}
