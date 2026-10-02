/**
 * Server-side display masking for identifiers printed on employee-facing
 * documents (payslip HTML/PDF). Mirrors the web tier's shared helpers in
 * apps/web/src/app/_components/ds/Masked.tsx (maskLast4 / maskPan) so a
 * payslip and the slip-detail page show the same masked form. The web
 * helpers cannot be imported here (apps/web is not a dependency of this
 * service), hence this small equivalent.
 */

/** "123456789012" -> "•••• 9012"; fewer than 4 characters -> "••••". Empty -> "". */
export function maskLast4(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length < 4) return "••••";
  return `•••• ${v.slice(-4)}`;
}

/**
 * Indian PAN (5 letters + 4 digits + 1 letter): keep the first 5 and the last
 * 1, as the web's maskPan does ("ABCDE1234F" -> "ABCDE****F"). Anything that
 * is not 10 characters is masked in full rather than partially exposed.
 * Empty -> "".
 */
export function maskPan(value: string | null | undefined): string {
  const v = (value ?? "").trim();
  if (!v) return "";
  if (v.length !== 10) return "*".repeat(Math.min(v.length, 10));
  return `${v.slice(0, 5)}****${v.slice(9)}`;
}
