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
