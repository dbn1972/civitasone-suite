"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../../../_components/ds";

export function PeriodSelector({ period }: { period: string }) {
  const router = useRouter();
  const [value, setValue] = useState(period);
  const id = useId();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (/^\d{4}-\d{2}$/.test(value)) {
      router.push(`/hr/payroll/statutory/challans?period=${encodeURIComponent(value)}`);
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>Period</label>
            <input
              id={id}
              type="month"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn" style={{ minHeight: 44 }}>View Period</button>
        </div>
      </Card>
    </form>
  );
}
