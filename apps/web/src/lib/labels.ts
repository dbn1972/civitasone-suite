/**
 * Standardised, clerk-facing labels and a guard list of jargon that must never
 * reach a clerk. One concept = one label everywhere (Requirement 12.2, 14.7).
 *
 * Platform jargon ("Tenant", "enablement", "maker-checker", internal queues) is
 * replaced with everyday words or hidden; established government terms (Sanction,
 * Indent, UC, GRN) are retained and explained via HelpTip instead (Requirement 14).
 */
export const LABELS = {
  /** R14.1 — "Tenant" reads as the clerk's office/organisation. */
  tenant: "office",
  tenantTitle: "Office",
  organisation: "organisation",
  /** R14.2 — name the action, not the workflow pattern. */
  sendForApproval: "Send for approval",
  /** R14.3 — turning modules on/off, never "enablement". */
  moduleToggleOn: "Turn on",
  moduleToggleOff: "Turn off",
  modulesArea: "Choose the parts you use",
} as const;

export type LabelKey = keyof typeof LABELS;

/**
 * GAP-PLATFORM-ADMIN-TENANT-CONFIG-06: human module-feature names for the
 * tenant-config "Enabled features" badges. The raw keys are lowercase/snake
 * (e.g. "pfms_integration", "hrms", "mfa"); the card previously printed them
 * verbatim with underscores turned to spaces ("pfms integration"). An unknown
 * key falls back to Title Case via humanizeStatus so a newly-added feature is
 * never hidden, just un-prettified.
 */
export const FEATURE_LABELS: Record<string, string> = {
  hrms: "HRMS",
  payroll: "Payroll",
  finance: "Finance",
  procurement: "Procurement",
  audit: "Audit",
  pfms_integration: "PFMS integration",
  digilocker: "DigiLocker",
  mfa: "Multi-factor authentication",
  sso: "Single sign-on",
  gst: "GST",
  esign: "eSign",
};

/** Resolve a feature key to its display label, falling back to Title Case. */
export function featureLabel(key: string): string {
  const mapped = FEATURE_LABELS[key.trim().toLowerCase()];
  if (mapped) return mapped;
  return key
    .split(/[\s_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * GAP-TELEPHONY-DISPOSITIONS-05: humanise a snake_case code (e.g. a telephony
 * disposition "no_resolution" or a tenant-defined wrap-up code) into
 * sentence-case display text — "No resolution", "Callback scheduled". Replaces
 * the dispositions page's underscore-only transform that left codes lowercase.
 * Only the first word is capitalised (sentence case) so a multi-word code reads
 * naturally rather than Title-Casing every word. Empty input renders "—".
 *
 *   humaniseCode("no_answer")           -> "No answer"
 *   humaniseCode("callback_scheduled")  -> "Callback scheduled"
 *   humaniseCode("")                     -> "—"
 */
export function humaniseCode(code: string | null | undefined): string {
  if (!code || !code.trim()) return "—";
  const words = code.trim().toLowerCase().split(/[\s_]+/).filter(Boolean);
  if (words.length === 0) return "—";
  words[0] = words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1);
  return words.join(" ");
}

/**
 * Tokens that must not appear in any clerk-facing copy (help content, error
 * messages, status badges, screen subtitles). Enforced by a unit test.
 * Requirements 5.2, 14.4, 14.6.
 */
export const BANNED_CLERK_TERMS = [
  "tenant",
  "enablement",
  "maker-checker",
  "maker checker",
  "outbox",
  "dead-letter",
  "dead letter",
  "dlq",
  "idempotent",
  "cqrs",
  "api unavailable",
  "live api",
  "read-only list loaded",
  "loaded from the service api",
  "stack trace",
] as const;

/**
 * Returns the banned tokens found in a piece of clerk-facing copy (case-insensitive),
 * or an empty array when the copy is clean. Used by tests and lint-style checks.
 *
 * Note: established government terms and proper product words are not banned;
 * only the platform-jargon tokens above are checked.
 */
export function findBannedTerms(copy: string): string[] {
  const lower = copy.toLowerCase();
  return BANNED_CLERK_TERMS.filter((t) => lower.includes(t));
}
