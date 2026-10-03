"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button, Card } from "../../../_components/ds";
import { PERIOD_PATTERN } from "@/lib/finance/gstTotals";

export function PeriodSelector({ period }: { period: string }) {
  const router = useRouter();
  const [value, setValue] = useState(period);
  const [error, setError] = useState<string | null>(null);
  const id = useId();
  const errId = useId();
  const hintId = useId();
  const ref = useRef<HTMLInputElement>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!PERIOD_PATTERN.test(value)) {
      setError("Enter a valid period as YYYY-MM, with a month from 01 to 12 (for example 2026-07).");
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
              placeholder="YYYY-MM"
              pattern="\d{4}-(0[1-9]|1[0-2])"
              aria-describedby={error ? `${hintId} ${errId}` : hintId}
              style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44 }}
            />
            <span id={hintId} style={{ fontSize: 12, color: "var(--mut)" }}>Format YYYY-MM, e.g. 2026-07.</span>
          </div>
          <Button type="submit" style={{ minHeight: 44 }}>View Period</Button>
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
