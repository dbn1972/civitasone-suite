"use client";

import { useEffect } from "react";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[CivitasOne] Unhandled error:", error);
  }, [error]);

  return (
    <div
      role="alert"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        padding: "48px 24px",
        textAlign: "center",
        gap: 16,
      }}
    >
      {/* Brand mark */}
      <div style={{
        width: 48, height: 48, borderRadius: 14, background: "#00439C",
        color: "#fff", fontSize: 22, fontWeight: 800, display: "grid", placeItems: "center",
        marginBottom: 8,
      }}>
        C1
      </div>

      <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--ink, #101828)", margin: 0 }}>
        Something went wrong
      </h1>
      <p style={{ fontSize: 14, color: "var(--mut, #667085)", maxWidth: 400, margin: 0 }}>
        An unexpected error occurred. Please try reloading the page. If the problem persists, contact your system administrator.
      </p>

      {error.digest && (
        <p style={{ fontSize: 12, color: "var(--mut, #667085)", fontFamily: "monospace", margin: 0 }}>
          Reference: {error.digest}
        </p>
      )}

      <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
        <button
          type="button"
          onClick={reset}
          style={{
            padding: "9px 20px", fontSize: 13, fontWeight: 600,
            background: "#00439C", color: "#fff", border: "none",
            borderRadius: 8, cursor: "pointer",
          }}
        >
          Reload page
        </button>
        <a
          href="/dashboard"
          style={{
            padding: "9px 20px", fontSize: 13, fontWeight: 600,
            background: "var(--panel, #fff)", color: "var(--ink, #101828)",
            border: "1px solid var(--line, #eaecf0)", borderRadius: 8,
            textDecoration: "none",
          }}
        >
          Go to dashboard
        </a>
      </div>
    </div>
  );
}
