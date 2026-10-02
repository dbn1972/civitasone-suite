/**
 * Last four characters of a bank account number, or null when the value is too
 * short to be an account number. The list route exposes only this
 * (GAP-FINANCE-TREASURY-CHEQUES-05), never the full number.
 */
export function lastFourDigits(accountNo: string | null | undefined): string | null {
  const s = String(accountNo ?? "").trim();
  return s.length >= 4 ? s.slice(-4) : null;
}
