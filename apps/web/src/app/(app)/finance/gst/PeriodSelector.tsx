"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../../_components/ds";

export function PeriodSelector({ period }: { period: string }) {
  const router = useRouter();
  const [value, setValue] = useState(period);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const errId = useId();
  const ref = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!/^\d{4}-\d{2}$/.test(value)) {
      setError("Choose a period (YYYY-MM) to view.");
      ref.current?.focus();
      return;
    }
    setError(null);
    router.push(`/finance/gst?period=${encodeURIComponent(value)}`);
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 16 }}>
      <Card padding>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label htmlFor={id} style={{ fontSize: 13, fontWeight: 600 }}>
              Period <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>*</span>
            </label>
            <input
              id={id}
              ref={ref}
              type="month"
              value={value}
              onChange={(e) => { setValue(e.target.value); }}
              aria-required="true"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errId : undefined}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
          </div>
          <button type="submit" className="btn" style={{ minHeight: 44 }}>View Period</button>
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
