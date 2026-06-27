"use client";

import { useEffect } from "react";

export default function SubscriptionsError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Billing Subscriptions error:", error);
  }, [error]);

  return (
    <main style={{ padding: "32px 0" }}>
      <div className="card" role="alert" aria-live="assertive" style={{ maxWidth: 560 }}>
        <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}>
            <span aria-hidden="true">⚠️</span> Something went wrong
          </h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>
            We couldn&apos;t load subscriptions. You can retry or head back.
          </p>
          {error.digest ? (
            <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Reference: {error.digest}</p>
          ) : null}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="button" className="btn primary" onClick={reset} style={{ minHeight: 44 }}>
              Try again
            </button>
            <a className="btn ghost" href="/billing" style={{ minHeight: 44, display: "inline-flex", alignItems: "center" }}>
              Back to Billing
            </a>
          </div>
        </div>
      </div>
    </main>
  );
}
