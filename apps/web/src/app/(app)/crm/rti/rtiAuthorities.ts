/**
 * GAP-CRM-RTI-NEW-04 / GAP-CRM-RTI-DETAIL-04: a shared, canonical list of RTI
 * public authorities, reused by both "New RTI request" (department of first
 * receipt) and the Forward action (s.6(3) transfer target), so the two can
 * never drift and a typo on one screen cannot fracture the register.
 *
 * DECISION (recorded in the fixer report): there is no tenant/org
 * public-authority endpoint in this snapshot to source from, so this is a
 * conservative built-in fallback list of commonly-addressed authorities plus
 * an explicit "Other" escape hatch. When a backend list lands, this module is
 * the single place to swap the source. Free-text entered via "Other" is
 * normalised (trimmed, inner whitespace collapsed) so "ministry of finance "
 * and "Ministry  of  Finance" fold to one canonical string.
 */

/** The explicit free-text escape-hatch option value. */
export const RTI_AUTHORITY_OTHER = "__other__";

/**
 * Built-in fallback authorities. Kept deliberately short and central/common;
 * a state department not listed here is entered via "Other".
 */
export const RTI_PUBLIC_AUTHORITIES = [
  "Ministry of Finance",
  "Department of Revenue",
  "Ministry of Home Affairs",
  "Ministry of Health & Family Welfare",
  "Ministry of Education",
  "Department of Posts",
  "UIDAI",
] as const;

/** Trim and collapse inner whitespace so equivalent spellings fold to one. */
export function normaliseAuthority(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * True when `value` (after normalisation) matches a known authority
 * case-insensitively. Used to decide whether a typed value needs the "Other"
 * free-text path.
 */
export function isKnownAuthority(value: string): boolean {
  const n = normaliseAuthority(value).toLowerCase();
  return RTI_PUBLIC_AUTHORITIES.some((a) => a.toLowerCase() === n);
}

/** Canonical casing for a known authority, else the normalised input. */
export function canonicaliseAuthority(value: string): string {
  const n = normaliseAuthority(value);
  const match = RTI_PUBLIC_AUTHORITIES.find((a) => a.toLowerCase() === n.toLowerCase());
  return match ?? n;
}
