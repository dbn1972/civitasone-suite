/**
 * Shared certification status/mandatory-keyword logic (GAP-HR-CERTIFICATIONS-06).
 *
 * Previously duplicated in both page.tsx (a Server Component) and
 * CertificationCard.tsx (a Client Component), with two separate problems:
 *
 * 1. Status/expiry-day derivation was reimplemented in each file with no
 *    injectable "now", so neither could be unit-tested deterministically --
 *    both silently depended on the real wall clock. Consolidated here with
 *    an injectable `now` parameter instead.
 * 2. MANDATORY_KEYWORDS was matched with a raw case-insensitive substring
 *    test (`name.includes(kw)`), so short keywords matched as substrings of
 *    unrelated words -- 'rti' matched inside "ce-RTI-fied"/"certificate"/
 *    "pa-RTI-al", and 'conduct' matched inside "Conducted". That silently
 *    mislabels most certificate titles as Mandatory, which has real
 *    compliance-reporting implications. Matching is now done on word
 *    boundaries via a single compiled regex.
 */

export type CertificationStatus = "valid" | "expiring_soon" | "expired" | "no_expiry";

const EXPIRING_SOON_WINDOW_DAYS = 30;

/**
 * Mandatory certification keywords for government HRMS. Matched on word
 * boundaries (case-insensitive) so e.g. 'rti' matches the standalone word
 * "RTI" but not as a substring of "Certified"/"certificate"/"Partial", and
 * 'conduct' matches "Conduct Rules" but not "Conducted".
 *
 *   isMandatory("Certified Ethical Hacker") -> false
 *   isMandatory("RTI Act Awareness")         -> true
 *   isMandatory("Conducted Workshop")        -> false
 *   isMandatory("Conduct Rules Training")    -> true
 */
const MANDATORY_KEYWORDS = ["service rules", "conduct", "dopt", "rti", "data protection", "cyber security"];

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const MANDATORY_PATTERN = new RegExp(
  `\\b(?:${MANDATORY_KEYWORDS.map(escapeRegExp).join("|")})\\b`,
  "i",
);

export function isMandatory(certificationName: string | null | undefined): boolean {
  if (!certificationName) return false;
  return MANDATORY_PATTERN.test(certificationName);
}

/**
 * Whole calendar days from `now` until `expiryDate`, treated as a bare
 * calendar day (not an instant) at UTC-midnight granularity -- the same
 * date-only treatment lib/formatters.ts's formatIndianDate/daysUntilIST
 * already give due/expiry-style dates elsewhere in this app (hr/confirmation,
 * hr/onboarding, hr/transfer), so this never shifts by a day depending on
 * wall-clock time of day. `expiryDate` may be a bare "YYYY-MM-DD" string or a
 * full ISO timestamp (the first 10 characters are used either way) --
 * resilient to either shape the API happens to serialize a SQL `date` as.
 *
 *   daysUntilExpiry("2026-10-31", new Date("2026-10-01T00:00:00Z")) -> 30
 *   daysUntilExpiry("2026-09-30", new Date("2026-10-01T00:00:00Z")) -> -1
 */
export function daysUntilExpiry(expiryDate: string, now: Date = new Date()): number {
  const datePart = expiryDate.slice(0, 10);
  const [y, m, d] = datePart.split("-").map(Number);
  const expiryUtcMidnight = Date.UTC(y, m - 1, d);
  const nowUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((expiryUtcMidnight - nowUtcMidnight) / 86_400_000);
}

/**
 * Derives a certification's display status from its (possibly absent)
 * expiryDate. `now` is injectable so this is deterministically testable
 * (GAP-HR-CERTIFICATIONS-06) rather than depending on the real wall clock.
 *
 * "no_expiry" is a distinct, honest state from "valid": a row with no
 * expiryDate (no validity_months recorded against its training programme,
 * or no completed_date yet) has NO tracking data, which is different from
 * "confirmed currently valid" -- GAP-HR-CERTIFICATIONS-01 explicitly calls
 * out that such rows must not be silently counted as valid, nor as expired.
 *
 *   deriveCardStatus(null)                                           -> "no_expiry"
 *   deriveCardStatus(<today+30>, now)                                -> "expiring_soon"
 *   deriveCardStatus(<today+31>, now)                                -> "valid"
 *   deriveCardStatus(<today-1>, now)                                 -> "expired"
 */
export function deriveCardStatus(
  expiryDate: string | null | undefined,
  now: Date = new Date(),
): CertificationStatus {
  if (!expiryDate) return "no_expiry";
  const days = daysUntilExpiry(expiryDate, now);
  if (days < 0) return "expired";
  if (days <= EXPIRING_SOON_WINDOW_DAYS) return "expiring_soon";
  return "valid";
}
