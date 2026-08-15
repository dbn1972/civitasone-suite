"use client";

import { PageHeader } from "../../../_components/ds";

export default function RtiError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <>
      <PageHeader
        title="RTI Requests"
        subtitle="Right to Information Act 2005 — 30-day response register."
        back="/crm"
      />
      <div
        role="alert"
        style={{
          padding: "16px 20px",
          background: "color-mix(in srgb, var(--bad) 10%, transparent)",
          border: "1px solid var(--bad)",
          borderRadius: "var(--r)",
          color: "var(--bad)",
        }}
      >
        <strong>Could not load RTI requests.</strong>
        <span style={{ marginLeft: 8, fontSize: 13, opacity: 0.85 }}>
          {error.message}
        </span>
        <button
          onClick={reset}
          style={{
            marginLeft: 12,
            padding: "4px 12px",
            border: "1px solid var(--bad)",
            borderRadius: "var(--r)",
            background: "transparent",
            color: "var(--bad)",
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          Retry
        </button>
      </div>
    </>
  );
}
