"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../../../_components/ds";

export function EmployeeFyLookup({ employeeId, fy }: { employeeId: string; fy: string }) {
  const router = useRouter();
  const [empId, setEmpId] = useState(employeeId);
  const [fyValue, setFyValue] = useState(fy);
  const [error, setError] = useState<string | null>(null);
  const empIdId = useId();
  const fyId = useId();
  const errId = useId();
  const empRef = useRef<HTMLInputElement>(null);
  const fyRef = useRef<HTMLInputElement>(null);
  const empInvalid = !!error && !empId.trim();
  const fyInvalid = !!error && !!empId.trim() && !fyValue.trim();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId.trim() || !fyValue.trim()) {
      setError("Employee ID and Financial Year are both required.");
      (!empId.trim() ? empRef : fyRef).current?.focus();
      return;
    }
    setError(null);
    router.push(`/hr/payroll/statutory/perquisite?employeeId=${encodeURIComponent(empId.trim())}&fy=${encodeURIComponent(fyValue.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Look Up Form 12BA" padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdId} style={{ fontSize: 13, fontWeight: 600 }}>
              Employee ID <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={empIdId}
              ref={empRef}
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              aria-required="true"
              aria-invalid={empInvalid || undefined}
              aria-describedby={empInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 220 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>
              Financial Year <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={fyId}
              ref={fyRef}
              value={fyValue}
              onChange={(e) => setFyValue(e.target.value)}
              placeholder="e.g. 2026-27"
              aria-required="true"
              aria-invalid={fyInvalid || undefined}
              aria-describedby={fyInvalid ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn" style={{ minHeight: 44 }}>View Form 12BA</button>
        </div>
        {error && (
          <p id={errId} role="alert" className="pill bad" style={{ width: "fit-content", marginTop: 10 }}>
            {error}
          </p>
        )}
      </Card>
    </form>
  );
}
