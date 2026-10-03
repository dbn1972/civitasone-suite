"use client";

import Link from "next/link";
import { useEffect } from "react";
import { formatReference, resolveHumanError } from "@/lib/errorCatalogue";
import { Button } from "./ds";

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
  /**
   * Plain label for the area, e.g. "HR page" or "Fleet Vehicles". Used only in
   * the friendly sentence below — rendered with no leading article/determiner,
   * because callers pass free text that is often plural or a list ("Insurance
   * Claims", "Condemnation, Auction & Disposal"), which "this X" reads as
   * broken ("this Insurance Claims"). Keep any new caller's value a bare noun
   * phrase; don't rely on "this"/"these"/"a"/"an" agreeing with it.
   */
  area?: string;
}) {
  useEffect(() => {
    // Developer-only: never shown to the clerk.
    // eslint-disable-next-line no-console -- error boundary logging
    console.error("Route error:", error);
  }, [error]);

  // A route that crashed is "a problem on our side" (5xx copy); a thrown network
  // failure reads as "couldn't connect". Never the error's own message.
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  const human = resolveHumanError({ status: offline ? undefined : 500, ctx: { area: area?.trim() || "page", intent: "load" } });

  return (
    <div
      className="wrap"
      role="alert"
      aria-live="assertive"
      style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "60vh", gap: 24, textAlign: "center" }}
    >
      <span style={{ fontSize: 48 }} aria-hidden="true">⚠️</span>
      <div>
        <h1 style={{ fontSize: "1.5rem", fontWeight: 600, color: "var(--ink)", marginBottom: 8 }}>
          {human.what}
        </h1>
        <p style={{ color: "var(--ink2)", maxWidth: 480, margin: "0 auto" }}>{human.next}</p>
        {error.digest && (
          <p style={{ fontSize: 12, color: "var(--mut)", marginTop: 8 }}>{formatReference(error.digest)}</p>
        )}
      </div>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center" }}>
        <Button variant="primary" onClick={reset}>
          Try again
        </Button>
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
