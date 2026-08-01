"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function WriteOffLookupForm() {
  const router = useRouter();
  const [writeOffId, setWriteOffId] = useState("");
  const [error, setError] = useState<string | undefined>();
  const inputId = useId();
  const errorId = `${inputId}-error`;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = writeOffId.trim();
    if (!UUID_RE.test(trimmed)) {
      setError("Enter a valid write-off ID (UUID).");
      return;
    }
    setError(undefined);
    router.push(`/revenue/write-offs/${trimmed}/decide`);
  }

  return (
    <form onSubmit={handleSubmit} aria-label="Look up a write-off to decide" style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
      <div style={{ display: "grid", gap: 6 }}>
        <label htmlFor={inputId} style={{ fontSize: 13, fontWeight: 600 }}>
          Write-off ID{" "}
          <span aria-hidden="true" style={{ color: "var(--bad, #c0392b)" }}>
            *
          </span>
        </label>
        <input
          id={inputId}
          value={writeOffId}
          onChange={(e) => setWriteOffId(e.target.value)}
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
