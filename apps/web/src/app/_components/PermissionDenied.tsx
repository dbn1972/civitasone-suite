"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ERROR_CATALOGUE, getClientLocale, resolveHumanError, type ErrorLocale } from "@/lib/errorCatalogue";

type Props = {
  /** Kept for caller compatibility; the standard 403 copy does not name the module. */
  module?: string;
  /** Kept for caller compatibility; internal role slugs are never shown. */
  requiredRoles?: readonly string[];
  /**
   * The service's own free-text reason. It is NEVER rendered (it can carry role
   * slugs and ownership detail); in development it is logged to the console.
   */
  reason?: string;
  /**
   * GAP-HR-ID-CARDS-06: first-party, already-localised copy that tells the user WHY this
   * screen is restricted (e.g. "this register is limited to HR administrators and security
   * administrators"). Unlike `reason` it is authored by the page itself, never by a
   * service, so it is safe to show -- but it must be plain language: no role slugs, no
   * ownership detail, nothing derived from a response.
   */
  explanation?: string;
  /** The service's machine-readable code (e.g. SELF_APPROVAL_FORBIDDEN, MAKER_CHECKER) for a specific message. */
  code?: string;
  /**
   * GAP-HR-ID-CARDS-07: the CTA was hard-wired to /dashboard, so a denied
   * user browsing within e.g. /hr always left the HR area entirely instead
   * of going back to where they came from. Optional and additive -- every
   * existing caller (no backHref passed) keeps today's exact "Return to
   * command center" -> /dashboard behavior.
   */
  backHref?: string;
  backLabel?: string;
};

/**
 * "Access restricted" card for a 403. Copy comes from the app-wide error
 * standard (apps/web/docs/ERROR-MESSAGES.md): the standard 403 sentences, or a
 * domain-code message (self-approval, maker-checker) when the service sent a
 * known code. Server render is English; the user's locale is applied after
 * hydration so markup matches.
 */
export function PermissionDenied({ reason, explanation, code, backHref = "/dashboard", backLabel = "Return to command center" }: Props) {
  const [locale, setLocale] = useState<ErrorLocale>("en");
  useEffect(() => {
    setLocale(getClientLocale());
  }, []);
  useEffect(() => {
    if (reason && process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console -- dev-only diagnostic; the reason is never shown to the user
      console.warn("[PermissionDenied] backend reason (not shown):", reason);
    }
  }, [reason]);

  const human = resolveHumanError({ status: 403, code, ctx: { locale } });
  return (
    <div className="card" style={{ maxWidth: 480, margin: "40px auto" }}>
      <div className="pad" style={{ textAlign: "center" }}>
        <div style={{ fontSize: 40, marginBottom: 12 }} aria-hidden>🔒</div>
        <h2 style={{ margin: "0 0 8px" }}>{ERROR_CATALOGUE[locale].accessRestricted}</h2>
        <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px" }}>
          {human.what} {human.next}
        </p>
        {explanation ? (
          <p style={{ fontSize: 14, color: "var(--muted)", margin: "0 0 16px" }}>{explanation}</p>
        ) : null}
        <Link href={backHref} className="btn primary">{backLabel}</Link>
      </div>
    </div>
  );
}
