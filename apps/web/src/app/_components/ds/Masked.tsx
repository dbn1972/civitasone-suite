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
 *
 * F1-05 update: `Masked` now accepts an optional `onReveal` config. When the
 * viewer is allowed to reveal, it renders the client `MaskedReveal` control
 * (audited reveal-with-reason against /api/v1/crm/pii/reveal). Without
 * `onReveal` it stays a pure Server-Component-safe static render as before.
 */
import { MaskedReveal, type PiiResourceType } from "./MaskedReveal";

export type MaskedKind = "pan" | "account" | "last4" | "phone" | "email";

/**
 * GAP-PAYROLL-PENSIONERS-NEW-02 / GAP-PAYROLL-NPS-02: show only the last four
 * characters of an account-style identifier (bank account number, PRAN).
 * Works whether the caller holds the full value or -- as for PRAN, which
 * hrms-service never sends in full -- only the last four already. Exported
 * as a plain function too, so Server Components can pre-format a DataTable
 * cell string (DataTable cells cannot take a component across the client
 * boundary).
 *
 *   maskLast4("123456789012") -> "•••• 9012"
 *   maskLast4("9012")         -> "•••• 9012"
 *   maskLast4("12")           -> "••••"
 */
export function maskLast4(value: string): string {
  const v = value.trim();
  if (v.length < 4) return "••••";
  return `•••• ${v.slice(-4)}`;
}

export function maskPan(value: string): string {
  // Indian PAN: 5 letters + 4 digits + 1 letter (10 chars). Show the first 5
  // and the last 1 (matches the gap's own acceptance example,
  // "ABCDE1234F" -> "ABCDE****F"); anything that doesn't look like a real
  // PAN (wrong length) is masked in full rather than partially exposed.
  if (value.length !== 10) return "*".repeat(Math.min(value.length, 10)) || "**********";
  return `${value.slice(0, 5)}****${value.slice(9)}`;
}

/**
 * GAP-CRM-CONTACTS-02 / GAP-CRM-CONTACTS-DETAIL-02: mask an Indian phone number
 * for DPDP, keeping only the last 3 digits ("98XXXXX210"). The leading 2 digits
 * are kept for recognisability; everything in between is X-ed. Non-digit
 * characters are stripped first. Values too short to mask meaningfully are
 * masked in full.
 *
 *   maskPhone("9876543210") -> "98XXXXX210"
 */
export function maskPhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7) return "X".repeat(Math.max(digits.length, 4));
  const head = digits.slice(0, 2);
  const tail = digits.slice(-3);
  const middle = "X".repeat(digits.length - 5);
  return `${head}${middle}${tail}`;
}

/**
 * GAP-CRM-CONTACTS-02 / GAP-CRM-CONTACTS-DETAIL-02: mask an email, showing only
 * the first character of the local part and the first character of each domain
 * label ("asha@dept.gov.in" -> "a***@d***.g**.i*"). Anything that is not a
 * plausible email (no "@") is masked in full.
 *
 *   maskEmail("asha@example.com") -> "a***@e***.c**"
 */
export function maskEmail(value: string): string {
  const v = value.trim();
  const at = v.indexOf("@");
  if (at <= 0 || at === v.length - 1) return "*".repeat(Math.min(Math.max(v.length, 4), 10));
  const local = v.slice(0, at);
  const domain = v.slice(at + 1);
  const maskedLocal = `${local[0]}***`;
  const maskedDomain = domain
    .split(".")
    .map((label) => (label ? `${label[0]}${"*".repeat(Math.max(label.length - 1, 1))}` : ""))
    .join(".");
  return `${maskedLocal}@${maskedDomain}`;
}

/**
 * GAP-CITIZEN-GRIEVANCES-03: mask a person's name for DPDP-sensitive staff
 * lists. Keeps the first character of each whitespace-separated part and the
 * last character of the final part, masking the rest, so a masked name stays
 * recognisable-at-a-glance without exposing the full identity to every
 * signed-in user. A single short token is masked in full. Exported as a plain
 * string function so a DataTable cell (which cannot take a component across
 * the client boundary) can pre-format it.
 *
 *   maskName("Ramesh Kumar") -> "R••••• K•••r"
 *   maskName("Sita")         -> "S••a"
 *   maskName("A")            -> "•"
 */
export function maskName(value: string): string {
  const v = value.trim();
  if (!v) return "";
  const parts = v.split(/\s+/);
  const maskPart = (p: string, keepLast: boolean): string => {
    if (p.length <= 1) return "•";
    if (p.length === 2) return `${p[0]}•`;
    const last = keepLast ? p[p.length - 1] : "•";
    return `${p[0]}${"•".repeat(p.length - 2)}${last}`;
  };
  return parts.map((p, i) => maskPart(p, i === parts.length - 1)).join(" ");
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
  /**
   * F1-05: optional audited-reveal config. When present AND the viewer is
   * allowed to reveal (`onReveal.canReveal`), the masked value gains a "Reveal"
   * control that opens a reason dialog and calls the server's audited
   * `/api/v1/crm/pii/reveal` endpoint before showing the clear value (see
   * MaskedReveal). Absent (or canReveal=false) -> the static masked render,
   * unchanged, so existing callers and Server Components are untouched.
   *
   * `value` here is the SERVER-MASKED string (the page never holds the clear
   * value for an unprivileged viewer); the reveal round-trips to the server.
   */
  onReveal?: {
    canReveal: boolean;
    resourceType: PiiResourceType;
    resourceId: string;
    field: string;
    label: string;
  };
}

export function Masked({ value, kind, fallback = null, className, ariaLabel, onReveal }: MaskedProps) {
  if (!value) return <>{fallback}</>;
  // F1-05/F1-06: when an onReveal config is present, `value` is already the
  // SERVER-masked string, so it is shown verbatim (never re-masked client-side).
  if (onReveal) {
    if (onReveal.canReveal) {
      return (
        <MaskedReveal
          maskedText={value}
          resourceType={onReveal.resourceType}
          resourceId={onReveal.resourceId}
          field={onReveal.field}
          label={onReveal.label}
          className={className}
        />
      );
    }
    return (
      <span className={className} style={{ fontFamily: "monospace" }} aria-label={ariaLabel}>
        {value}
      </span>
    );
  }
  const masked =
    kind === "pan"
      ? maskPan(value)
      : kind === "account"
        ? maskAccount(value)
        : kind === "phone"
          ? maskPhone(value)
          : kind === "email"
            ? maskEmail(value)
            : maskLast4(value);
  return (
    <span className={className} style={{ fontFamily: "monospace" }} aria-label={ariaLabel}>
      {masked}
    </span>
  );
}
