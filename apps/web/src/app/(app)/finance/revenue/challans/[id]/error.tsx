"use client";

import { useEffect } from "react";

export default function ErrorBoundary({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error("Finance error:", error); }, [error]);

  return (
    <main className="page-main wrap" role="alert" aria-live="assertive">
      <div className="card" style={{ maxWidth: 560, margin: "48px auto" }}>
        <div className="pad" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h1 style={{ margin: 0, fontSize: 20 }}><span aria-hidden="true">⚠️</span> Something went wrong</h1>
          <p style={{ margin: 0, fontSize: 14, color: "var(--muted)" }}>We couldn&apos;t load this page. Please try again.</p>
          {error.digest && <p style={{ margin: 0, fontSize: 12, color: "var(--muted)" }}>Reference: {error.digest}</p>}
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn primary" onClick={reset}>Try again</button>
            <a className="btn ghost" href="/finance/revenue/challans">Back to Challans</a>
          </div>
        </div>
      </div>
    </main>
  );
}
