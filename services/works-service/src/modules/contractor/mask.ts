/**
 * Display mask for a contractor's PAN (DPDP). Mirrors the web's maskPan (apps/web .../ds/Masked.tsx) and the vendor
 * masks in finance/payroll: ABCDE1234F -> ABCDE****F; anything that is not a 10-character PAN is masked in full.
 * The clear value is reachable only through the audited reveal endpoint (POST .../reveal-pan), or on the detail read
 * for the roles that are entitled to reveal it.
 */
export function maskPan(pan: string | null | undefined): string | null {
  const v = (pan ?? "").trim();
  if (!v) return null;
  if (v.length !== 10) return "*".repeat(Math.min(v.length, 10));
  return `${v.slice(0, 5)}****${v.slice(9)}`;
}

/** A contractor row with its PAN replaced by the masked form. Every other field is passed through untouched. */
export function withMaskedPan<T extends { pan?: string | null }>(row: T): T {
  return { ...row, pan: maskPan(row.pan) };
}
