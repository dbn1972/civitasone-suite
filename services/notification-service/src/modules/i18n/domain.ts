/**
 * I18N domain logic — locale resolution with fallback chain and BCP 47 validation.
 */

/**
 * BCP 47 regex: language subtag required, script/region/variant optional.
 * Covers common cases like "en", "en-US", "hi-IN", "zh-Hans-CN".
 */
const BCP47_REGEX = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?(?:-(?:[a-z\d]{5,8}|\d[a-z\d]{3}))*$/;

/**
 * Validate that a locale string conforms to BCP 47 format.
 */
export function validateBcp47(locale: string): boolean {
  if (!locale || locale.length === 0 || locale.length > 35) return false;
  return BCP47_REGEX.test(locale);
}

export type LocaleVariant = {
  locale: string;
  subject: string | null;
  body: string;
  status: string;
};

/**
 * Resolve the best matching locale variant using the fallback chain:
 * 1. Recipient's preferred locale (exact match)
 * 2. Tenant's default locale
 * 3. Base template (no locale variant — returns null to signal "use base")
 *
 * Only returns variants with status = "current" (not stale).
 */
export function resolveLocale(
  variants: LocaleVariant[],
  recipientLocale: string | null,
  tenantDefaultLocale: string | null,
): LocaleVariant | null {
  // Try recipient's preferred locale first
  if (recipientLocale) {
    const exact = variants.find(
      (v) => v.locale === recipientLocale && v.status === "current",
    );
    if (exact) return exact;

    // Try language-only fallback (e.g., "hi" from "hi-IN")
    const lang = recipientLocale.split("-")[0];
    if (lang && lang !== recipientLocale) {
      const langMatch = variants.find(
        (v) => v.locale === lang && v.status === "current",
      );
      if (langMatch) return langMatch;
    }
  }

  // Try tenant's default locale
  if (tenantDefaultLocale) {
    const tenantMatch = variants.find(
      (v) => v.locale === tenantDefaultLocale && v.status === "current",
    );
    if (tenantMatch) return tenantMatch;
  }

  // No matching variant — caller should use base template
  return null;
}

/**
 * Determine which variants need to be flagged as stale after a base template update.
 * Returns the locale strings that should be marked "needs_review".
 */
export function findStaleVariants(variants: LocaleVariant[]): string[] {
  return variants
    .filter((v) => v.status === "current")
    .map((v) => v.locale);
}
