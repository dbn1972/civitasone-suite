/**
 * P1-2: mask PII (email / phone) before it reaches logs.
 * Emails: keep first char of local part + domain TLD shape. Phones: keep last 2 digits.
 */
export function maskRecipient(recipient: string | null | undefined): string {
  if (!recipient) return "(none)";
  const value = String(recipient);
  const at = value.indexOf("@");
  if (at > 0) {
    const local = value.slice(0, at);
    const domain = value.slice(at + 1);
    const localMasked = local.length <= 1 ? "*" : `${local[0]}***`;
    const dot = domain.lastIndexOf(".");
    const domainMasked = dot > 0 ? `***${domain.slice(dot)}` : "***";
    return `${localMasked}@${domainMasked}`;
  }
  const digits = value.replace(/\D/g, "");
  if (digits.length >= 4) {
    return `***${digits.slice(-2)}`;
  }
  // Opaque identifier (e.g. UUID) — show only a short prefix.
  return value.length <= 6 ? "***" : `${value.slice(0, 4)}***`;
}
