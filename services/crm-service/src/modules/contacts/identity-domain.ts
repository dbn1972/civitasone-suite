/**
 * Contact identity resolution domain logic (CH-18).
 * Pure functions: phone normalization, email normalization, match scoring.
 */

/**
 * Normalize a phone number: strip spaces, dashes, parens, and leading country codes.
 * Returns digits only (with optional leading +).
 */
export function normalizePhone(phone: string): string {
  // Strip all non-digit characters except leading +
  let cleaned = phone.trim();
  if (cleaned.startsWith("+")) {
    cleaned = "+" + cleaned.slice(1).replace(/\D/g, "");
  } else {
    cleaned = cleaned.replace(/\D/g, "");
  }
  // Remove leading 0 for Indian numbers
  if (cleaned.startsWith("0") && cleaned.length === 11) {
    cleaned = cleaned.slice(1);
  }
  return cleaned;
}

/**
 * Normalize email: lowercase, trim whitespace, strip dots from gmail-style local parts.
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const atIdx = trimmed.indexOf("@");
  if (atIdx < 0) return trimmed;
  const local = trimmed.slice(0, atIdx);
  const domain = trimmed.slice(atIdx + 1);
  // Remove dots in local for gmail (common dedup trick)
  // Keep as-is for other domains
  if (domain === "gmail.com" || domain === "googlemail.com") {
    const cleanLocal = local.replace(/\./g, "").split("+")[0] ?? local;
    return `${cleanLocal}@${domain}`;
  }
  return trimmed;
}

/**
 * Compute a match score (0-100) between two names using simple token overlap.
 * Used for fuzzy matching when email/phone don't match exactly.
 */
export function matchScore(nameA: string, nameB: string): number {
  const tokensA = nameA.toLowerCase().split(/\s+/).filter(Boolean);
  const tokensB = nameB.toLowerCase().split(/\s+/).filter(Boolean);

  if (tokensA.length === 0 || tokensB.length === 0) return 0;

  const setA = new Set(tokensA);
  const setB = new Set(tokensB);

  let matches = 0;
  for (const t of setA) {
    if (setB.has(t)) matches++;
  }

  const maxPossible = Math.max(setA.size, setB.size);
  return Math.round((matches / maxPossible) * 100);
}
