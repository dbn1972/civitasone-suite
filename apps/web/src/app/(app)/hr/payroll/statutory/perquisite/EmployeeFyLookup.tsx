"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../../../_components/ds";

export function EmployeeFyLookup({ employeeId, fy }: { employeeId: string; fy: string }) {
  const router = useRouter();
  const [empId, setEmpId] = useState(employeeId);
  const [fyValue, setFyValue] = useState(fy);
  const empIdId = useId();
  const fyId = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!empId.trim() || !fyValue.trim()) return;
    router.push(`/hr/payroll/statutory/perquisite?employeeId=${encodeURIComponent(empId.trim())}&fy=${encodeURIComponent(fyValue.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card title="Look Up Form 12BA" padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={empIdId} style={{ fontSize: 13, fontWeight: 600 }}>Employee ID</label>
            <input
              id={empIdId}
              value={empId}
              onChange={(e) => setEmpId(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 220 }}
            />
          </div>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={fyId} style={{ fontSize: 13, fontWeight: 600 }}>Financial Year</label>
            <input
              id={fyId}
              value={fyValue}
              onChange={(e) => setFyValue(e.target.value)}
              placeholder="e.g. 2026-27"
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn" style={{ minHeight: 44 }}>View Form 12BA</button>
        </div>
      </Card>
    </form>
  );
}
