/**
 * Server-side display masks for applicant contact details (DPDP data minimisation,
 * GAP-RECRUITMENT-DETAIL-08). Masking happens BEFORE the value leaves the service, so the
 * full address / number never reaches a browser until an audited reveal
 * (pii-reveal-routes.ts). Mirrors apps/web's lib/maskPii.ts for email.
 */

/** "asha.verma@dept.gov.in" -> "a***@d***.in"; unparseable input -> "***"; absent -> null. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${email[0]}***@${host[0] ?? ""}***${tld}`;
}

/** "9876543210" -> "******3210"; fewer than 5 characters are masked in full; absent -> null. */
export function maskMobile(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  const digits = mobile.replace(/\s+/g, "");
  if (digits.length < 5) return "*".repeat(Math.max(digits.length, 4));
  return `${"*".repeat(digits.length - 4)}${digits.slice(-4)}`;
}
