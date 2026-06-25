"use client";

import Link from "next/link";

interface KnowledgeErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function KnowledgeError({ error, reset }: KnowledgeErrorProps) {
  return (
    <div
      className="wrap"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 24,
        textAlign: "center",
      }}
    >
      <span style={{ fontSize: 48 }} role="img" aria-label="Warning">
        ⚠️
      </span>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: "var(--ink2)", maxWidth: 480, margin: "0 auto" }}>
          {error.message || "An unexpected error occurred in the Knowledge module."}
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, color: "var(--ink3)", marginTop: 8 }}>Error ID: {error.digest}</p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn primary" onClick={reset}>
          Try again
        </button>
        <Link href="/knowledge" className="btn ghost">
          Back to Knowledge
        </Link>
      </div>
    </div>
  );
}
