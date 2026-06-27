"use client";

import Link from "next/link";
import { useEffect } from "react";
import { SUPPORT_REFERENCE_PREFIX } from "@/lib/messages";

/**
 * RouteError — the one standard error boundary UI for every route.
 *
 * It never shows the clerk raw server text, status codes, stack traces, or the
 * underlying error message (Requirement 5.1). It says what happened and what to
 * do next (Requirement 6.1, 6.2), always offers Try again + a safe way back
 * (Requirement 6.3), and shows the support code only with a plain label
 * (Requirement 5.3). The raw error is logged to the console for developers only.
 */
export function RouteError({
  error,
  reset,
  backHref = "/dashboard",
  backLabel = "Back to dashboard",
  area,
}: {
  error: Error & { digest?: string };
  reset: () => void;
  backHref?: string;
  backLabel?: string;
  /** Plain noun for the area, e.g. "HR page". Used only in the friendly sentence. */
  area?: string;
}) {
  useEffect(() => {
    // Developer-only: never shown to the clerk.
    console.error("Route error:", error);
  }, [error]);

  return (
    <div
      className="wrap"
      role="alert"
      aria-live="assertive"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24, textAlign: "center" }}
    >
      <span style={{ fontSize: 48 }} role="img" aria-label="Warning">⚠️</span>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
          Something went wrong
        </h1>
        <p style={{ color: "var(--ink2)", maxWidth: 480, margin: "0 auto" }}>
          We couldn&apos;t open this {area ?? "page"}. Please try again — your information is safe.
        </p>
        {error.digest && (
          <p style={{ fontSize: 12, color: "var(--ink3)", marginTop: 8 }}>
            {SUPPORT_REFERENCE_PREFIX} {error.digest}
          </p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <button type="button" className="btn primary" onClick={reset}>
          Try again
        </button>
        <Link href={backHref} className="btn ghost">
          {backLabel}
        </Link>
        <Link href="/help" className="btn ghost">
          Open help
        </Link>
      </div>
    </div>
  );
}
