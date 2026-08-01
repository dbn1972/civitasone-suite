"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function RefundLookupForm() {
  const router = useRouter();
  const [refundId, setRefundId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();
  const errorId = `${inputId}-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = refundId.trim();
    if (!UUID_RE.test(trimmed)) {
      setError("Enter a valid refund ID (UUID).");
      return;
    }
    setError(undefined);
    router.push(`/revenue/refunds/${trimmed}/decide`);
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Look up a refund to decide" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
          Refund ID{" "}
          <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
            *
          </span>
        </label>
        <input
          id={inputId}
          value={refundId}
          onChange={(e) => setRefundId(e.target.value)}
          placeholder="e.g. 3fa85f64-5717-4562-b3fc-2c963f66afa6"
          aria-required="true"
          aria-invalid={!!error || undefined}
          aria-describedby={error ? errorId : undefined}
          style={{ padding: "10px 12px", borderRadius: 10, border: "1px solid var(--line)", minHeight: 44, minWidth: 320 }}
        />
        {error && (
          <p id={errorId} role="alert" style={{ margin: 0, fontSize: 12.5, color: "var(--bad, #c0392b)" }}>
            {error}
          </p>
        )}
      </div>
      <button type="submit" className="btn ghost" style={{ minHeight: 44 }}>
        Go to decision
      </button>
    </form>
  );
}
