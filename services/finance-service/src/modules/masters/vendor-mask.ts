/**
 * Display masks for vendor PII. The vendor read APIs return ONLY these forms;
 * the clear value is available solely through the audited reveal endpoint
 * (vendor-workflow.ts revealVendorFields).
 */

/** ABCDE1234F -> ABCDE****F ; anything that is not a 10-char PAN is fully masked. */
export function maskPan(pan: string | null | undefined): string {
  const v = (pan ?? "").trim();
  if (!v) return "";
  if (v.length !== 10) return "*".repeat(Math.min(v.length, 10));
  return `${v.slice(0, 5)}****${v.slice(9)}`;
}

/** 123456789012 -> ********9012 (last four only; <= 4 chars fully masked). */
export function maskAccountNo(acct: string | null | undefined): string {
  const v = (acct ?? "").trim();
  if (!v) return "";
  if (v.length <= 4) return "*".repeat(v.length);
  return `${"*".repeat(v.length - 4)}${v.slice(-4)}`;
}

/** 9876543210 -> ******3210. */
export function maskPhone(phone: string | null | undefined): string | null {
  const v = (phone ?? "").trim();
  if (!v) return null;
  if (v.length <= 4) return "*".repeat(v.length);
  return `${"*".repeat(v.length - 4)}${v.slice(-4)}`;
}

/** asha.verma@dept.gov.in -> a***@dept.gov.in (domain kept: it is not personal). */
export function maskEmail(email: string | null | undefined): string | null {
  const v = (email ?? "").trim();
  if (!v) return null;
  const at = v.lastIndexOf("@");
  if (at < 1) return "***";
  return `${v[0]}***${v.slice(at)}`;
}
