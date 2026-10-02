/**
 * Display masking for personal contact data (DPDP data minimisation).
 * Masking is for DISPLAY: do it before the value reaches the DOM or an export.
 */

/** "asha.verma@dept.gov.in" -> "a***@d***.in". Unparseable input becomes "***". */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "—";
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const host = dot > 0 ? domain.slice(0, dot) : domain;
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local[0]}***@${host[0] ?? ""}***${tld}`;
}
