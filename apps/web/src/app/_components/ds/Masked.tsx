/**
 * GAP-PAYROLL-STATUTORY-PERQUISITE-04: shared display-only masking for
 * DPDP-sensitive identifiers (PAN today; `kind` is extensible). Deliberately
 * has no interactive "reveal" control: the gap's own fix steps call for
 * reveal-on-click to fire a server-audited event through an endpoint "to be
 * defined with backend; do not invent one here" -- a reveal control with no
 * real audit behind it would be worse than no reveal at all (a false sense
 * of logged access). This component only renders the masked form; building
 * a real reveal is a separate, backend-dependent follow-up.
 *
 * No "use client" needed -- this is a pure, static render, so it works
 * directly inside a Server Component (e.g. perquisite/page.tsx) with no
 * client-boundary wrapper required.
 */
export type MaskedKind = "pan" | "account";

function maskPan(value: string): string {
  // Indian PAN: 5 letters + 4 digits + 1 letter (10 chars). Show the first 5
  // and the last 1 (matches the gap's own acceptance example,
  // "ABCDE1234F" -> "ABCDE****F"); anything that doesn't look like a real
  // PAN (wrong length) is masked in full rather than partially exposed.
  if (value.length !== 10) return "*".repeat(Math.min(value.length, 10)) || "**********";
  return `${value.slice(0, 5)}****${value.slice(9)}`;
}

/**
 * GAP-PAYROLL-DISBURSEMENT-01: bank account numbers show only the last 4
 * digits ("••••1234"). Values of 4 characters or fewer are masked in full --
 * there is nothing safe to show.
 */
export function maskAccount(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length <= 4) return "••••";
  return `••••${trimmed.slice(-4)}`;
}

export interface MaskedProps {
  /** The raw sensitive value. Render nothing (or a caller-supplied fallback) when absent. */
  value: string | null | undefined;
  kind: MaskedKind;
  /** Shown when `value` is null/empty (e.g. a "PANNOTAVBL" flag's own label). */
  fallback?: React.ReactNode;
  className?: string;
  /** Accessible name, e.g. "Account ending 1234" -- screen readers otherwise read the bullet glyphs. */
  ariaLabel?: string;
}

export function Masked({ value, kind, fallback = null, className, ariaLabel }: MaskedProps) {
  if (!value) return <>{fallback}</>;
  const masked = kind === "pan" ? maskPan(value) : kind === "account" ? maskAccount(value) : "****";
  return (
    <span className={className} style={{ fontFamily: "monospace" }} aria-label={ariaLabel}>
      {masked}
    </span>
  );
}
